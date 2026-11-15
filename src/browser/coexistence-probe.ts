// A probe of the owner's windows next to the AI's page on ONE session (DEC-038), for a REAL browser back end (the owner's Google Chrome, or the
// built-in browser under Electron). A local site on 127.0.0.1 gives every browser session a cookie of its own, so a page can show which session
// it belongs to, and it sees every request. The probe opens a window for the owner while the AI has a page of its own, and checks what the decision
// promises: the two are two pages of ONE session, neither takes control from the other, a turn of the AI in progress is not interrupted by the
// owner's window or by what the owner does in it, an owner's window that goes to a sign-out address (as a page or as a request in the background)
// is noticed, a write of a turn that began before that is refused before it reaches the site, and the AI's own page going to a sign-out address
// is not taken for the owner's doing. Used by the opt-in real-browser test (coexistence-real.test.ts, Chrome) and by a probe script under Electron.
// Never opens a site that is not on 127.0.0.1. Not imported by production code.

import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SessionChangedError, TakeoverError, type BrowserService } from '../core/ports'
import type { TicketAuthority } from '../core/tickets'
import type { Account } from '../shared/types'
import type { ProbeCheck } from './post-picture-probe'

/** The title carries the session the page belongs to: the site gives each browser session one id, in a cookie. */
const page = (title: string, extra: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${extra}</body></html>`

const AI_BODY = `<input id="work" aria-label="Work field" autocomplete="off"><button id="send" type="button">Send</button><p id="result"></p>
<script>
  document.getElementById('send').addEventListener('click', async () => {
    const r = await fetch('/api/work', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: document.getElementById('work').value }) })
    document.getElementById('result').textContent = 'Sent ' + r.status
  })
</script>`

/** The owner's page does by itself, a moment after it loads, what the owner does by hand: `?go=` changes the page, `?fetch=` asks for an address in the background. */
const OWNER_BODY = `<input id="own" aria-label="Owner field" autocomplete="off">
<script>
  const q = new URLSearchParams(location.search)
  if (q.get('go')) setTimeout(() => { location.href = q.get('go') }, 500)
  if (q.get('fetch')) setTimeout(() => { fetch(q.get('fetch'), { method: 'POST' }).catch(() => undefined) }, 500)
</script>`

export interface CoexistenceSite {
  server: Server
  base: string
  /** Every request the site saw: "METHOD path" and the session id it came with. */
  hits: { line: string; session: string }[]
  /** What the AI's page sent with its Send button. */
  work: { value: string; session: string }[]
  close(): Promise<void>
}

export async function startCoexistenceSite(): Promise<CoexistenceSite> {
  const hits: CoexistenceSite['hits'] = []
  const work: CoexistenceSite['work'] = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => (text += chunk))
    request.on('end', () => {
      const path = (request.url ?? '').split('?')[0] ?? ''
      const sent = /(?:^|;\s*)probe_sid=([0-9a-f]+)/.exec(request.headers.cookie ?? '')?.[1]
      const session = sent ?? randomBytes(4).toString('hex')
      hits.push({ line: `${request.method} ${path}`, session })
      const headers: Record<string, string> = { 'content-type': path.startsWith('/api/') ? 'application/json' : 'text/html' }
      if (!sent) headers['set-cookie'] = `probe_sid=${session}; Path=/`
      if (request.method === 'POST' && path === '/api/work') work.push({ value: (JSON.parse(text || '{}') as { value?: string }).value ?? '', session })
      if (path.startsWith('/api/')) return void response.writeHead(200, headers).end('{}')
      if (path === '/ai') return void response.writeHead(200, headers).end(page(`AI page ${session}`, AI_BODY))
      if (path === '/logout') return void response.writeHead(200, headers).end(page(`Signed out ${session}`, ''))
      return void response.writeHead(200, headers).end(page(`Owner window ${session}`, OWNER_BODY))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, base, hits, work, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

/** What the probe uses of a back end: the port, and what both back ends have besides it. */
export type ProbeService = BrowserService & { hasUserWindow(account: Account): boolean; closeUserWindow(account: Account): void; showUserWindow(account: Account): boolean }

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function until(condition: () => boolean | Promise<boolean>, ms = 15_000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (await condition()) return true
    await pause(100)
  }
  return false
}

const sessionOf = (title: string | undefined): string => /([0-9a-f]{8})$/.exec(title ?? '')?.[1] ?? ''

export async function exerciseCoexistence(service: ProbeService, tickets: TicketAuthority, account: Account, site: CoexistenceSite): Promise<ProbeCheck[]> {
  const checks: ProbeCheck[] = []
  const check = (name: string, ok: boolean, detail = ''): void => void checks.push({ name, ok, detail })
  const { base } = site
  const events: string[] = []
  const previous = service.onUserWindowChange
  service.onUserWindowChange = (id, change) => void events.push(`${id}:${change}`)
  const session = service.session(account)
  const ticket = (): ReturnType<TicketAuthority['issue']> => tickets.issue({ actionId: `probe-${Math.random()}`, contentHash: 'probe', accountId: account.id, destination: `${base}/ai` })
  const closeOwner = async (): Promise<void> => {
    service.closeUserWindow(account)
    await until(() => !service.hasUserWindow(account))
  }
  try {
    // 1. The AI has a page of its own, and the site gave the session an id.
    const ai = await session.withAgentControl('probe', async (p) => {
      await p.goto(`${base}/ai`)
      return { title: await p.read<string>('document.title'), url: await p.url() }
    })
    const sid = sessionOf(ai.title)
    check('the AI works in a page of its own, which carries the session the site gave it', sid.length === 8 && ai.url === `${base}/ai`, ai.title)

    // 2. A window for the owner: one more window, nothing taken.
    const opened = await service.openForUser(account, `${base}/owner`)
    check('a window opens for the owner', typeof opened.tabId === 'string' && opened.tabId !== '' && service.hasUserWindow(account), opened.tabId)
    check('...and says so once', events.join() === `${account.id}:opened`, events.join())
    check('...and nobody holds the browser: the AI was not stopped and the owner took nothing', session.control().holder === 'none', JSON.stringify(session.control()))
    const shown = await until(async () => sessionOf((await service.ownerPage?.(account))?.title) !== '')
    const owner = await service.ownerPage?.(account)
    check('the owner window shows its page', shown && owner?.url === `${base}/owner`, JSON.stringify(owner))
    check('the owner window and the AI\'s page are two pages of ONE session (the same cookie)', sessionOf(owner?.title) === sid && sid !== '', `${sessionOf(owner?.title)} vs ${sid}`)

    // 3. The AI keeps working in its own page, behind the owner's window.
    const typed = await session.withAgentControl('probe', async (p) => {
      const title = await p.read<string>('document.title')
      await p.fill('#work', 'typed beside the owner', ticket())
      await p.click('#send', ticket())
      let result = ''
      for (let i = 0; i < 40 && !result.startsWith('Sent'); i++) {
        result = await p.read<string>("document.getElementById('result').textContent")
        if (!result.startsWith('Sent')) await pause(150)
      }
      return { title, result, url: await p.url() }
    })
    check('the AI types and sends in its own page while the owner\'s window is open', typed.result === 'Sent 200' && typed.url === `${base}/ai`, JSON.stringify(typed))
    check('...and the site saw it under the same session', site.work.at(-1)?.value === 'typed beside the owner' && site.work.at(-1)?.session === sid, JSON.stringify(site.work.at(-1)))
    check('...and the owner\'s window is where it was', (await service.ownerPage?.(account))?.url === `${base}/owner`)

    // 4. Pressing "Open browser" again for the same address brings that window forward and opens nothing more.
    await service.openForUser(account, `${base}/owner`)
    check('opening the same address again opens no second window and says "opened" no second time', events.join() === `${account.id}:opened`, events.join())
    check('...and the window can be brought to the front', service.showUserWindow(account))

    // 5. The owner moves around in their window: the AI is not disturbed and nothing is noticed that does not touch who is signed in.
    await closeOwner()
    const quiet = session.identityEpoch()
    await service.openForUser(account, `${base}/owner?go=/owner/next`)
    const moved = await until(async () => (await service.ownerPage?.(account))?.url === `${base}/owner/next`)
    check('the owner goes to another page in their window', moved, JSON.stringify(await service.ownerPage?.(account)))
    const title2 = await session.withAgentControl('probe', (p) => p.read<string>('document.title'))
    check('...the AI still reads its own page', title2.startsWith('AI page'), title2)
    check('...and an ordinary page is not taken for a change of who is signed in', session.identityEpoch() === quiet, String(session.identityEpoch() - quiet))

    // 6. The AI's own page may go to a sign-out address: that is its mission, not the owner's doing.
    await session.withAgentControl('probe', async (p) => {
      await p.goto(`${base}/logout`)
      await p.goto(`${base}/ai`)
    })
    check('the AI\'s own page going to a sign-out address is not counted', session.identityEpoch() === quiet, String(session.identityEpoch() - quiet))

    // 7. A turn is in progress and the owner opens a window and moves around in it: the turn is not interrupted.
    await closeOwner()
    const inTurn = await session.withAgentControl('probe', async (p) => {
      const seen: string[] = []
      await p.goto(`${base}/ai`)
      seen.push((await p.read<string>('document.title')).split(' ')[0] ?? '')
      await service.openForUser(account, `${base}/owner?go=/owner/elsewhere`)
      await pause(1500)
      seen.push((await p.read<string>('document.title')).split(' ')[0] ?? '')
      seen.push(await p.url())
      return seen
    })
    check('a turn of the AI goes on while the owner opens a window and goes to another page in it', inTurn.join() === `AI,AI,${base}/ai`, inTurn.join())

    // 8. The owner's window goes to a sign-out address.
    await closeOwner()
    const beforeOut = session.identityEpoch()
    await service.openForUser(account, `${base}/owner?go=/logout`)
    const sawOut = await until(() => session.identityEpoch() > beforeOut)
    check('the owner\'s window going to a sign-out page is noticed', sawOut, String(session.identityEpoch() - beforeOut))
    const aiAfter = await session.withAgentControl('probe', (p) => p.read<string>('document.title'))
    check('...and the AI\'s page is not touched by it', aiAfter.startsWith('AI page') && sessionOf(aiAfter) === sid, aiAfter)

    // 9. A sign-out that is a request in the background.
    await closeOwner()
    const beforeFetch = session.identityEpoch()
    await service.openForUser(account, `${base}/owner?fetch=/api/accounts/logout/`)
    const sawFetch = await until(() => session.identityEpoch() > beforeFetch)
    check('the owner\'s window asking for a sign-out address in the background is noticed', sawFetch, String(session.identityEpoch() - beforeFetch))

    // 10. A write of a turn that began before the owner's window used a sign-out page is refused, and nothing reaches the site.
    await closeOwner()
    const workBefore = site.work.length
    let refused: unknown = null
    try {
      await session.withAgentControl('probe', async (p) => {
        await p.goto(`${base}/ai`)
        const epoch = session.identityEpoch()
        await service.openForUser(account, `${base}/owner?go=/logout`)
        await until(() => session.identityEpoch() > epoch)
        await p.fill('#work', 'must not be typed', ticket())
        await p.click('#send', ticket())
      })
    } catch (error) {
      refused = error
    }
    check('a write of a turn that began before the owner\'s window used a sign-out page is refused', refused instanceof SessionChangedError, refused instanceof Error ? refused.name : String(refused))
    check('...and nothing was sent to the site', site.work.length === workBefore, `${site.work.length - workBefore} sent`)
    const typedInPage = await session.withAgentControl('probe', (p) => p.read<string>("document.getElementById('work').value"))
    check('...and nothing was typed in the page', typedInPage !== 'must not be typed', JSON.stringify(typedInPage))
    // The next turn is a new one: the mission itself decides, from the sign-in it reads, whether it may write.
    const next = await session.withAgentControl('probe', async (p) => {
      await p.fill('#work', 'a new turn', ticket())
      return p.read<string>("document.getElementById('work').value")
    })
    check('the next turn can write again', next === 'a new turn', next)

    // 11. The app closes the owner's windows: "closed" once, the AI goes on.
    const closedBefore = events.filter((event) => event.endsWith(':closed')).length
    await closeOwner()
    await pause(300)
    check('the owner\'s window is closed and the screen is told once', !service.hasUserWindow(account) && events.filter((event) => event.endsWith(':closed')).length === closedBefore + 1, events.join())
    check('...and there is no window to bring to the front', service.showUserWindow(account) === false)
    const stillAi = await session.withAgentControl('probe', (p) => p.read<string>('document.title'))
    check('...and the AI still works in its own page', stillAi.startsWith('AI page'), stillAi)

    // 12. The explicit take-over of the AI's own page keeps its lock.
    session.takeControl()
    let blocked: unknown = null
    try {
      await session.withAgentControl('probe', async () => 'ran')
    } catch (error) {
      blocked = error
    }
    check('while the owner has taken the AI\'s own page, the AI is stopped', blocked instanceof TakeoverError, blocked instanceof Error ? blocked.name : String(blocked))
    session.releaseControl()
    const resumed = await session.withAgentControl('probe', (p) => p.read<string>('document.title')).catch((error: Error) => error.message)
    check('...and works again when it is given back', resumed.startsWith('AI page'), resumed)
  } finally {
    service.onUserWindowChange = previous
    service.closeUserWindow(account)
  }
  return checks
}
