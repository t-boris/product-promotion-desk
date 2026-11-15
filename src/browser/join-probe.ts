// A probe of the join mission (DEC-029) on a REAL browser back end: the application's own toolbox, driven by a script instead of an AI, on a
// local community page with a real Join button and every decoy a real page has. It checks what the policy promises: one press, of the
// community's own Join button, with a real mouse click, and nothing else reaches the site. Used by the opt-in real-browser test
// (join-real.test.ts, Chrome) and by a probe script under Electron. Never opens a site that is not on 127.0.0.1. Not imported by production code.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BrowserToolbox } from '../core/browser-agent/toolbox'
import { JOIN_CLICK_ONLY, JOIN_PRESSED } from '../core/browser-agent/join'
import type { BrowserService } from '../core/ports'
import type { Account } from '../shared/types'

/** The page of a community. The page of another community has the same layout, so the same labels: only the community check can tell them apart. */
const communityPage = (name: string, joinPath: string, extras = ''): string => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>r/${name}</title></head><body>
<h1>r/${name}</h1>
<p id="state">A community for the probe.</p>
<form id="news" action="javascript:void(0)"><label>Email <input id="email" name="e" type="email" autocomplete="off"></label><button id="newsletter" type="submit">Join</button></form>
<button id="join" type="button">Join</button>
<button id="leave" type="button">Leave</button>
<button id="follow" type="button">Follow</button>
<button id="lure" type="button">Join the conversation</button>
<button id="other" type="button">Join r/other</button>
<button id="create" type="button">Create post</button>
<a id="signup" href="/signup">Join Reddit</a>
${extras}
<script>
  const send = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  document.getElementById('join').addEventListener('click', async (e) => {
    await send('${joinPath}', { trusted: e.isTrusted })
    document.getElementById('join').textContent = 'Joined'
    document.getElementById('state').textContent = 'You are a member.'
  })
  document.getElementById('news').addEventListener('submit', () => send('/newsletter'))
  document.getElementById('newsletter').addEventListener('click', () => send('/newsletter-click'))
  document.getElementById('other').addEventListener('click', () => send('/join-other'))
  document.getElementById('leave').addEventListener('click', () => send('/leave'))
  document.getElementById('follow').addEventListener('click', () => send('/follow'))
  document.getElementById('lure').addEventListener('click', () => send('/lure'))
  document.getElementById('create').addEventListener('click', () => { location.href = '/submit' })
</script></body></html>`

export interface Community {
  server: Server
  base: string
  /** Every request the site saw, as "METHOD path", in order. */
  hits: string[]
  /** What the pressed Join button told the site (`trusted`: a real input event, not a script's). */
  joined: { trusted?: boolean }[]
  close(): Promise<void>
}

export async function startCommunity(): Promise<Community> {
  const hits: string[] = []
  const joined: { trusted?: boolean }[] = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => (text += chunk))
    request.on('end', () => {
      const path = (request.url ?? '').split('?')[0] ?? ''
      hits.push(`${request.method} ${path}`)
      if (request.method === 'POST' && path === '/join') joined.push(JSON.parse(text || '{}') as { trusted?: boolean })
      if (request.method === 'POST') return void response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      const sidebar = '<aside><button id="side" type="button" onclick="fetch(\'/join-sidebar\', {method: \'POST\'})">Join</button></aside>'
      const named = '<aside><button id="named" type="button" onclick="fetch(\'/join-named\', {method: \'POST\'})">Join r/named</button></aside>'
      const page = path.startsWith('/r/twin/') ? communityPage('twin', '/join-twin', sidebar) : path.startsWith('/r/named/') ? communityPage('named', '/join-header', `${sidebar}${named}`) : path.startsWith('/r/probe/') ? communityPage('probe', '/join') : path.startsWith('/r/other/') ? communityPage('other', '/join-elsewhere') : `<!doctype html><title>${path}</title><h1>${path}</h1>`
      response.writeHead(200, { 'content-type': 'text/html' }).end(page)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, base, hits, joined, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

export interface ProbeCheck {
  name: string
  ok: boolean
  detail: string
}

/**
 * Runs the join mission's tools on the account's browser, against the community. The caller owns the back end and the community.
 * `realClick`: the back end must press with a real input event (Chrome). The internal browser may fall back to a script click in a tab that
 * is not drawn (an existing behaviour of every mission), so there it is only reported.
 */
export async function exerciseJoin(service: Pick<BrowserService, 'session'>, account: Account, community: Community, options: { realClick: boolean }): Promise<ProbeCheck[]> {
  const checks: ProbeCheck[] = []
  const check = (name: string, ok: boolean, detail = ''): void => void checks.push({ name, ok, detail })
  const { base, hits } = community
  const hosts = ['127.0.0.1']
  const reports: string[] = []
  const make = (name = 'probe'): BrowserToolbox =>
    new BrowserToolbox({
      withPage: (work) => service.session(account).withAgentControl('join', work),
      hosts,
      values: {},
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      say: () => undefined,
      ask: async () => 'done',
      note: () => undefined,
      report: (result) => void reports.push(result.status),
      askWaitMs: 50,
      join: { community: name, destination: `${base}/r/${name}/`, minGapMs: 250 }
    })
  const refOf = (snapshot: string, name: string, nth = 0): string => {
    const found = [...snapshot.matchAll(/^\[(e\d+)\] (\S+) "([^"]*)"/gm)].filter((m) => m[3] === name)[nth]
    if (!found) throw new Error(`no "${name}" #${nth} in the snapshot:\n${snapshot}`)
    return found[1] as string
  }

  const tools = make()
  check('the mission has seven tools', tools.tools.map((t) => t.name).join(',') === 'browser_snapshot,browser_navigate,browser_click,browser_scroll,browser_wait_for,ask_owner,report_result', tools.tools.map((t) => t.name).join(','))

  // where it may go
  for (const [what, url] of [
    ['another community', `${base}/r/other/`],
    ['the log-out page', `${base}/logout`],
    ['the submit page', `${base}/submit`],
    ['a look-alike path', `${base}/r/probes/`],
    ['another host', `http://localhost:${new URL(base).port}/r/probe/`],
    ['a script address', 'javascript:alert(1)'],
    ['a local file', 'file:///etc/hosts']
  ] as const) {
    const result = await tools.call('browser_navigate', { url })
    check(`it may not open ${what}`, result.isError === true, result.text.slice(0, 100))
  }
  check('...and the site saw none of it', hits.length === 0, hits.join(', '))
  const opened = await tools.call('browser_navigate', { url: `${base}/r/probe/` })
  check('it opens the community page', opened.isError !== true, opened.text.slice(0, 100))

  // what it may press
  const snapshot = (await tools.call('browser_snapshot', {})).text
  const names = ['Join', 'Leave', 'Follow', 'Join the conversation', 'Join r/other', 'Create post', 'Join Reddit']
  check('the page lists the Join buttons and the decoys', names.every((n) => snapshot.includes(`"${n}"`)), snapshot.slice(0, 600))
  for (const [what, name, nth] of [
    ['the newsletter\'s Join, which submits a form', 'Join', 0],
    ['Leave', 'Leave', 0],
    ['Follow', 'Follow', 0],
    ['Join the conversation', 'Join the conversation', 0],
    ['Join of another community', 'Join r/other', 0],
    ['Create post', 'Create post', 0],
    ['the link Join Reddit', 'Join Reddit', 0]
  ] as const) {
    const result = await tools.call('browser_click', { ref: refOf(snapshot, name, nth) })
    check(`it may not press ${what}`, result.isError === true && result.text === JOIN_CLICK_ONLY, result.text.slice(0, 100))
  }
  check('...and the site saw no press of any of them', !hits.some((h) => h.startsWith('POST') || h.includes('/signup') || h.includes('/submit')), hits.join(', '))
  const typed = await tools.call('browser_type', { ref: refOf(snapshot, 'Email'), text: 'a@b.c' })
  check('it cannot type', typed.isError === true, typed.text.slice(0, 100))

  // the one press
  const press = await tools.call('browser_click', { ref: refOf(snapshot, 'Join', 1) })
  check('it presses the community\'s own Join button', press.isError !== true, press.text.slice(0, 120))
  for (let i = 0; i < 30 && community.joined.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100))
  check(options.realClick ? 'the site saw one press, with a real input event' : 'the site saw one press', community.joined.length === 1 && (!options.realClick || community.joined[0]?.trusted === true), `${JSON.stringify(community.joined)} ${press.text.slice(0, 60)}`)
  const state = await service.session(account).withAgentControl('probe', (page) => page.read<string>("document.getElementById('join').textContent + '|' + document.getElementById('state').textContent"))
  check('the page shows the account as a member', state === 'Joined|You are a member.', state)

  // and nothing after it
  const again = await tools.call('browser_click', { ref: refOf(snapshot, 'Join', 1) })
  check('a second press is refused', again.isError === true && again.text === JOIN_PRESSED, again.text.slice(0, 100))
  const leave = await tools.call('browser_click', { ref: refOf(snapshot, 'Leave') })
  check('nothing else is pressed afterwards', leave.isError === true && leave.text === JOIN_PRESSED, leave.text.slice(0, 100))
  const away = await tools.call('browser_navigate', { url: `${base}/r/probe/about` })
  check('it opens nothing afterwards', away.isError === true && away.text === JOIN_PRESSED, away.text.slice(0, 100))
  const looked = await tools.call('browser_snapshot', {})
  check('it may still look', looked.isError !== true, looked.text.slice(0, 80))
  const wrote = hits.filter((h) => h.startsWith('POST'))
  check('the site saw exactly one write: the Join', wrote.length === 1 && wrote[0] === 'POST /join', wrote.join(', '))

  // a page that is not the community's: nothing is pressed on it, even a Join the AI was shown on the right page
  const fresh = make()
  await fresh.call('browser_navigate', { url: `${base}/r/probe/` })
  const before = (await fresh.call('browser_snapshot', {})).text
  await service.session(account).withAgentControl('probe', (page) => page.goto(`${base}/r/other/`))
  const wrong = await fresh.call('browser_click', { ref: refOf(before, 'Join', 1) })
  check('on another community\'s page it presses nothing', wrong.isError === true && /not the page of probe/.test(wrong.text), wrong.text.slice(0, 120))
  check('...and the site saw no Join of that page', !hits.includes('POST /join-elsewhere') && hits.filter((h) => h === 'POST /join').length === 1, hits.join(', '))

  // a page with a second bare Join (a sidebar's, for another community): nothing is pressed on a guess
  const twin = make('twin')
  await twin.call('browser_navigate', { url: `${base}/r/twin/` })
  const twinSnapshot = (await twin.call('browser_snapshot', {})).text
  const bare = [...twinSnapshot.matchAll(/^\[(e\d+)\] button "Join"$/gm)].map((m) => m[1] as string)
  check('a page with two bare Join buttons lists both', bare.length >= 3, twinSnapshot.slice(0, 400))
  const results = []
  for (const ref of bare) results.push(await twin.call('browser_click', { ref }))
  check('...and none of them is pressed (the two that are not the newsletter\'s are refused for being two)', results.every((r) => r.isError === true) && results.filter((r) => /More than one control/.test(r.text)).length >= 2 && !hits.some((h) => h.startsWith('POST /join-twin') || h === 'POST /join-sidebar'), hits.slice(-4).join(', '))

  // ...unless one is named after the community: that one, and not the sidebar's bare Join
  const named = make('named')
  await named.call('browser_navigate', { url: `${base}/r/named/` })
  const namedSnapshot = (await named.call('browser_snapshot', {})).text
  const sideRefs = [...namedSnapshot.matchAll(/^\[(e\d+)\] button "Join"$/gm)].map((m) => m[1] as string)
  const sidePress = await named.call('browser_click', { ref: sideRefs[sideRefs.length - 1] as string })
  check('with one named Join, a bare Join is refused', sidePress.isError === true && !hits.includes('POST /join-sidebar'), sidePress.text.slice(0, 80))
  const namedPress = await named.call('browser_click', { ref: refOf(namedSnapshot, 'Join r/named') })
  for (let i = 0; i < 30 && !hits.includes('POST /join-named'); i++) await new Promise((resolve) => setTimeout(resolve, 100))
  check('...and the one named after the community is pressed', namedPress.isError !== true && hits.includes('POST /join-named'), namedPress.text.slice(0, 80))
  return checks
}
