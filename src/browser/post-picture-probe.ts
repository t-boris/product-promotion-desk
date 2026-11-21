// A probe of the post mission with pictures (DEC-031) on a REAL browser back end: the application's own toolbox, driven by a script instead of
// an AI, on a local site that behaves like the sites that take pictures: a Create button that opens a dialog, a hidden file input behind a
// "Select from computer" button that opens the system's chooser, a Next step, a caption step with a Post button, and the decoys of such a
// wizard. It checks what the policy promises: the approved files reach the site byte for byte through the file input and no chooser opens,
// nothing else is clicked after the first picture but a step forward, the application types the caption and presses Post once, under a
// ticket, and no other page of the site is opened. Used by the opt-in real-browser test (post-picture-real.test.ts, Chrome) and by a probe
// script under Electron. Never opens a site that is not on 127.0.0.1. Not imported by production code.

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TestAuthority } from '../core/browser-agent/post-test-helpers'
import type { ApprovedContent, ApprovedFile } from '../core/browser-agent/post-submit'
import { BrowserToolbox } from '../core/browser-agent/toolbox'
import type { BrowserService } from '../core/ports'
import { FakeClock } from '../core/testing/fakes'
import { TicketAuthority } from '../core/tickets'
import type { Account } from '../shared/types'

/** The page: the same at "/" and at the profile, as on the sites that open the new-post form over their own pages. */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Brand</title></head><body>
<h1>Brand</h1>
<nav><a id="logout" href="/logout">Log out</a> <a id="settings" href="/settings">Settings</a> <a id="other" href="/other/">Other profile</a></nav>
<button id="edit-profile" type="button">Edit profile</button>
<button id="avatar" type="button">Change profile photo</button>
<p id="state">Nothing posted.</p>
<p id="input-state">wheels: 0, moves: 0, cursor: no, scroll: 0</p>
<!-- a profile page is long: what a person wants (Create) is below the first screen -->
<div style="height: 2600px">A long profile.</div>
<button id="create" type="button">Create</button>
<button id="follow" type="button">Follow</button>
<div id="dialog" hidden>
  <div id="step-pick">
    <button id="pick" type="button">Select from computer</button>
    <input id="files" type="file" accept="image/png,image/jpeg" multiple hidden aria-label="Select pictures">
    <input id="single" type="file" accept="image/png" hidden aria-label="Select one picture">
  </div>
  <div id="step-edit" hidden>
    <img id="preview" alt="" width="40">
    <button id="next" type="button">Next</button>
    <button id="discard" type="button">Discard post</button>
    <button id="crop" type="button">Crop</button>
  </div>
  <section id="avatar-box" aria-label="Profile photo" hidden>
    <h2>Change profile photo</h2>
    <form id="avatar-form" onsubmit="return false"><input id="avatar-file" name="profile_pic" type="file" accept="image/png" hidden></form>
  </section>
  <div id="step-caption" hidden>
    <textarea id="caption" aria-label="Write a caption"></textarea>
    <button id="location" type="button">Add location</button>
    <button id="tag" type="button">Tag people</button>
    <button id="back" type="button">Back</button>
    <button id="share" type="button">Post</button>
  </div>
</div>
<script>
  const send = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
  const hex = async (buffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const taken = []
  // What the page can tell of the hands that work it: real (trusted) wheel turns and mouse moves, how far it scrolled, and whether a cursor dot is drawn.
  const input = { wheels: 0, moves: 0 }
  const report = () => { document.getElementById('input-state').textContent = 'wheels: ' + input.wheels + ', moves: ' + input.moves + ', cursor: ' + (document.getElementById('__ppd-cursor') ? 'yes' : 'no') + ', scroll: ' + Math.round(window.scrollY) }
  addEventListener('wheel', (e) => { if (e.isTrusted) { input.wheels++; report() } }, { capture: true, passive: true })
  addEventListener('mousemove', (e) => { if (e.isTrusted) { input.moves++; if (input.moves % 4 === 0) report() } }, true)
  addEventListener('scroll', report, { passive: true })
  setInterval(report, 200)
  document.getElementById('edit-profile').addEventListener('click', () => send('/edit-profile'))
  document.getElementById('avatar').addEventListener('click', () => send('/avatar'))
  document.getElementById('avatar-file').addEventListener('change', () => send('/avatar-file'))
  const show = (id) => { for (const step of ['step-pick', 'step-edit', 'step-caption']) document.getElementById(step).hidden = step !== id }
  document.getElementById('create').addEventListener('click', () => { document.getElementById('dialog').hidden = false; document.getElementById('avatar-box').hidden = false; show('step-pick') })
  document.getElementById('pick').addEventListener('click', () => { send('/chooser'); document.getElementById('files').click() })
  document.getElementById('files').addEventListener('change', async (e) => {
    // the input holds the files of its last step, and the wizard takes what it holds each time
    taken.length = 0
    for (const file of e.target.files) taken.push({ name: file.name, type: file.type, size: file.size, sha256: await hex(await file.arrayBuffer()) })
    await send('/attached', { files: taken })
    show('step-edit')
  })
  document.getElementById('next').addEventListener('click', () => { send('/next'); show('step-caption') })
  for (const id of ['discard', 'crop', 'follow', 'location', 'tag', 'back']) document.getElementById(id).addEventListener('click', () => send('/' + id))
  document.getElementById('share').addEventListener('click', async (e) => {
    await send('/share', { trusted: e.isTrusted, caption: document.getElementById('caption').value, files: taken })
    document.getElementById('state').textContent = 'Posted.'
  })
</script></body></html>`

export interface PictureSite {
  server: Server
  base: string
  /** Every request the site saw, as "METHOD path", in order. */
  hits: string[]
  /** What the file input told the site: the files, by what the page itself read of them. */
  attached: { files: { name: string; type: string; size: number; sha256: string }[] }[]
  /** What the pressed Share told the site: the caption in the box, the files, and whether the press was a real input event. */
  shared: { trusted?: boolean; caption: string; files: { sha256: string }[] }[]
  close(): Promise<void>
}

export async function startPictureSite(): Promise<PictureSite> {
  const hits: string[] = []
  const attached: PictureSite['attached'] = []
  const shared: PictureSite['shared'] = []
  const server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk) => (text += chunk))
    request.on('end', () => {
      const path = (request.url ?? '').split('?')[0] ?? ''
      hits.push(`${request.method} ${path}`)
      if (request.method === 'POST') {
        if (path === '/attached') attached.push(JSON.parse(text || '{}') as PictureSite['attached'][number])
        if (path === '/share') shared.push(JSON.parse(text || '{}') as PictureSite['shared'][number])
        return void response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      }
      response.writeHead(200, { 'content-type': 'text/html' }).end(path === '/' || path.startsWith('/brand/') ? PAGE : `<!doctype html><title>${path}</title><p>Another page: ${path}</p>`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, base, hits, attached, shared, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

export interface ProbeCheck {
  name: string
  ok: boolean
  detail: string
}

/** Two small valid PNGs, differing in their bytes, written where the application keeps approved pictures (a temp folder here). */
function makePictures(folder: string): ApprovedFile[] {
  const png = (tag: string): Buffer => {
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    return Buffer.concat([header, Buffer.alloc(16), Buffer.from(tag)])
  }
  return ['first', 'second'].map((tag, index) => {
    const bytes = png(tag)
    const path = join(folder, `${tag}.png`)
    writeFileSync(path, bytes)
    return { name: `picture-${index + 1}.png`, path, sha256: createHash('sha256').update(bytes).digest('hex') }
  })
}

/**
 * Runs the post mission's tools on the account's browser, against the site. The caller owns the back end and the site. `realClick`: the back
 * end must press with a real input event (Chrome); the internal browser may fall back to a script click in a tab that is not drawn, so
 * there it is only reported.
 */
export async function exercisePictures(service: Pick<BrowserService, 'session'>, tickets: TicketAuthority, account: Account, site: PictureSite, options: { realClick: boolean }): Promise<ProbeCheck[]> {
  const checks: ProbeCheck[] = []
  const check = (name: string, ok: boolean, detail = ''): void => void checks.push({ name, ok, detail })
  const { base, hits } = site
  const folder = mkdtempSync(join(tmpdir(), 'ppd-post-picture-'))
  // One page for the whole probe, as a mission has one.
  const ai = service.session(account).task('post')
  try {
    const files = makePictures(folder)
    // The caption as the application hands it over when the draft had a link and the platform no field for it (DEC-036): the link is the last paragraph.
    const caption = 'A caption the owner approved,\nwith a second line.\n\nhttps://example.test/product'
    const content: ApprovedContent = { kind: 'post', title: null, text: caption, link: null, destination: `${base}/brand/`, attachments: files }
    const authority = new TestAuthority(tickets, content, account.id)
    const reports: string[] = []
    const toolbox = new BrowserToolbox({
      withPage: (work) => ai.withAgentControl(work),
      hosts: ['127.0.0.1'],
      values: {},
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      say: () => undefined,
      ask: async () => 'done',
      note: () => undefined,
      report: (result) => void reports.push(result.status),
      askWaitMs: 50,
      post: { authority, minGapMs: 250 }
    })
    const refOf = (snapshot: string, name: string): string => {
      const found = [...snapshot.matchAll(/^\[(e\d+)\] (\S+) "([^"]*)"/gm)].find((m) => m[3] === name)
      if (!found) throw new Error(`no "${name}" in the snapshot:\n${snapshot}`)
      return found[1] as string
    }
    const fileInputRef = (snapshot: string): string => {
      const found = [...snapshot.matchAll(/^\[(e\d+)\] input:file "Select pictures"/gm)][0]
      if (!found) throw new Error(`no file input in the snapshot:\n${snapshot}`)
      return found[1] as string
    }
    const counter = (snapshot: string, what: 'wheels' | 'moves' | 'scroll'): number => Number(new RegExp(`${what}: (\\d+)`).exec(snapshot)?.[1] ?? -1)
    const look = async (): Promise<string> => (await toolbox.call('browser_snapshot', {})).text

    check('the mission has the tool that puts approved pictures in, and none that types, uploads or runs a script', toolbox.tools.some((t) => t.name === 'browser_attach') && !toolbox.tools.some((t) => /type|upload|evaluate|press_key/.test(t.name)), toolbox.tools.map((t) => t.name).join(','))

    // where it may go
    for (const [what, url] of [
      ['the log-out page', `${base}/logout`],
      ['the settings page', `${base}/settings`],
      ['another profile', `${base}/other/`],
      ['another host', `http://localhost:${new URL(base).port}/brand/`],
      ['a script address', 'javascript:alert(1)'],
      ['a local file', 'file:///etc/hosts']
    ] as const) {
      const result = await toolbox.call('browser_navigate', { url })
      check(`it may not open ${what}`, result.isError === true, result.text.slice(0, 100))
    }
    check('...and the site saw none of it', hits.length === 0, hits.join(', '))
    const opened = await toolbox.call('browser_navigate', { url: `${base}/brand/` })
    check('it opens the profile page, where the dialog opens', opened.isError !== true, opened.text.slice(0, 100))

    // the page is long, and what the AI is shown is what is on the screen first
    let snapshot = await look()
    check('the first look says the screen is at the top of a long page, and lists the profile controls on it', /at the top of the page.*scroll down/.test(snapshot) && snapshot.includes('"Edit profile"') && snapshot.includes('"Change profile photo"'), snapshot.slice(0, 200))
    check('...and marks Create, which is below the first screen, as off the screen', /"Create"[^\n]*\(off screen\)/.test(snapshot) && !/"Edit profile"[^\n]*\(off screen\)/.test(snapshot), snapshot.split('\n').filter((l) => /Create|Edit profile/.test(l)).join(' | '))

    // the profile is the account's own, and a post does not touch it: not by a press, not by a file
    for (const name of ['Edit profile', 'Change profile photo']) {
      const result = await toolbox.call('browser_click', { ref: refOf(snapshot, name) })
      check(`it may not click "${name}"`, result.isError === true && /own profile/.test(result.text), result.text.slice(0, 120))
    }
    const settingsLink = await toolbox.call('browser_click', { ref: refOf(snapshot, 'Settings') })
    check('...nor the link to the settings', settingsLink.isError === true && /own profile/.test(settingsLink.text), settingsLink.text.slice(0, 100))
    check('...and the site saw none of it', !hits.some((h) => ['POST /edit-profile', 'POST /avatar', 'GET /settings'].includes(h)), hits.join(', '))

    // scrolling with the wheel, as a person does
    let scrolled = ''
    for (let i = 0; i < 8 && /"Create"[^\n]*\(off screen\)/.test(snapshot); i++) {
      scrolled = (await toolbox.call('browser_scroll', { direction: 'down' })).text
      snapshot = await look()
    }
    check('it scrolls down until Create is on the screen, and is told where the page is', /Scrolled down\. It is now \d+% of the way down/.test(scrolled) && !/"Create"[^\n]*\(off screen\)/.test(snapshot), scrolled.slice(0, 160))
    check('...the page moved', counter(snapshot, 'scroll') > 200, `scroll ${counter(snapshot, 'scroll')}`)
    // what the page itself counted of the hands: real (trusted) wheel turns and mouse moves, and whether a cursor dot is drawn over it
    const hands = snapshot.split('\n').find((l) => l.includes('wheels:')) ?? ''
    check('...with real wheel turns, a notch at a time', counter(snapshot, 'wheels') >= 8, `wheels ${counter(snapshot, 'wheels')}`)
    check('...and the owner sees a cursor dot, which moved over the page with real mouse moves', /cursor: yes/.test(snapshot) && counter(snapshot, 'moves') >= 10, hands)
    const up = await toolbox.call('browser_scroll', { direction: 'up', amount: 'half' })
    check('it can scroll up too, by half a screen', up.isError !== true && /Scrolled up/.test(up.text), up.text.slice(0, 120))

    // a click on what is below the screen scrolls to it by itself, the way a person does
    await toolbox.call('browser_navigate', { url: `${base}/brand/` })
    snapshot = await look()
    check('after a new look at the page it is at the top again, with Create off the screen', /at the top of the page/.test(snapshot) && /"Create"[^\n]*\(off screen\)/.test(snapshot) && counter(snapshot, 'wheels') === 0, snapshot.slice(0, 100))
    const create = await toolbox.call('browser_click', { ref: refOf(snapshot, 'Create') })
    check('it opens the Create dialog by clicking Create where it is off the screen (the form is empty, so a click is free)', create.isError !== true, create.text.slice(0, 100))
    snapshot = await look()
    check('...the page was scrolled with the wheel to reach it, and the pointer moved to it', counter(snapshot, 'scroll') > 200 && counter(snapshot, 'wheels') >= 5 && counter(snapshot, 'moves') >= 10, snapshot.split('\n').find((l) => l.includes('wheels:')) ?? '')
    check('the page lists the hidden file input, the button that opens the chooser and a decoy', snapshot.includes('input:file') && ['Select from computer', 'Follow'].every((n) => snapshot.includes(`"${n}"`)), snapshot.slice(0, 700))
    const inputRef = fileInputRef(snapshot)
    // the profile photo's own file input is on the page too, and a picture of a post never goes into it
    const avatarInput = [...snapshot.matchAll(/^\[(e\d+)\] input:file "[^"]*" in "[^"]*Change profile photo[^"]*"/gm)][0]?.[1]
    check('the page lists the profile photo\'s file input, with what stands around it', avatarInput !== undefined, snapshot.split('\n').filter((l) => l.includes('input:file')).join(' | '))
    if (avatarInput) {
      const intoAvatar = await toolbox.call('browser_attach', { ref: avatarInput })
      check('it may not put the approved pictures into the profile photo\'s input', intoAvatar.isError === true && /own profile/.test(intoAvatar.text), intoAvatar.text.slice(0, 120))
      check('...and the site saw no file there', !hits.includes('POST /avatar-file'), hits.join(', '))
    }

    // what it may not do before a picture is in
    const chooser = await toolbox.call('browser_click', { ref: refOf(snapshot, 'Select from computer') })
    check('it does not click the button that opens the system\'s file chooser', chooser.isError === true && /file chooser/.test(chooser.text), chooser.text.slice(0, 100))
    const inputClick = await toolbox.call('browser_click', { ref: inputRef })
    check('...nor the file input itself', inputClick.isError === true && /file chooser/.test(inputClick.text), inputClick.text.slice(0, 100))
    check('...and no chooser opened on the site', !hits.includes('POST /chooser'), hits.join(', '))
    // the caption step is not on the page yet: labels the page never showed, which is not what is refused first
    const early = await toolbox.call('browser_submit', { text_ref: 'e90', submit_ref: 'e91' })
    check('it may not publish before the approved pictures are in the form', early.isError === true && /not in the form of this page yet/.test(early.text), early.text.slice(0, 120))
    const asked = await toolbox.call('browser_attach', { ref: refOf(snapshot, 'Follow'), file: '../../etc/passwd', path: '/etc/passwd' })
    check('it cannot name a file of its own: there is no such argument, and a button takes none', asked.isError === true && !site.attached.length, asked.text.slice(0, 100))
    const notInput = await toolbox.call('browser_attach', { ref: refOf(snapshot, 'Create') })
    check('it may not attach into a button', notInput.isError === true && /not a file input/.test(notInput.text), notInput.text.slice(0, 100))
    check('...and the site saw no file', site.attached.length === 0 && !hits.includes('POST /attached'), hits.join(', '))

    // a file that changed since the owner approved it
    const original = files[0] as ApprovedFile
    writeFileSync(original.path, 'something else on disk')
    const changed = await toolbox.call('browser_attach', { ref: inputRef })
    check('it does not attach a file that changed on disk since the approval', changed.isError === true && /not the picture that was approved/.test(changed.text), changed.text.slice(0, 120))
    check('...and the site saw no file', site.attached.length === 0, JSON.stringify(site.attached))
    writeFileSync(original.path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16), Buffer.from('first')]))

    // the pictures: all of them, in one step
    const attach = await toolbox.call('browser_attach', { ref: inputRef })
    check('it puts the approved pictures into the file input, together', attach.isError !== true, attach.text.slice(0, 140))
    for (let i = 0; i < 40 && site.attached.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100))
    const got = site.attached[0]?.files ?? []
    check('the site read both files byte for byte (type, size and hash as approved)', got.length === 2 && got.every((f, i) => f.type === 'image/png' && f.sha256 === (files[i] as ApprovedFile).sha256), JSON.stringify(got))
    const again = await toolbox.call('browser_attach', { ref: inputRef })
    check('they do not go in twice', again.isError === true && /in the form already/.test(again.text), again.text.slice(0, 100))
    const sameInputAgain = await toolbox.call('browser_attach', { ref: refOf(snapshot, 'Select one picture') })
    check('...nor into another input (which would replace what the first took)', sameInputAgain.isError === true, sameInputAgain.text.slice(0, 100))

    // after the pictures: only a step forward
    snapshot = await look()
    for (const name of ['Discard post', 'Crop', 'Follow']) {
      const result = await toolbox.call('browser_click', { ref: refOf(snapshot, name) })
      check(`after the pictures it may not click "${name}"`, result.isError === true, result.text.slice(0, 100))
    }
    const next = await toolbox.call('browser_click', { ref: refOf(snapshot, 'Next') })
    check('it goes on with Next', next.isError !== true, next.text.slice(0, 100))

    // the caption step
    snapshot = await look()
    for (const name of ['Add location', 'Tag people', 'Back']) {
      const result = await toolbox.call('browser_click', { ref: refOf(snapshot, name) })
      check(`it may not click "${name}"`, result.isError === true, result.text.slice(0, 100))
    }
    const share = await toolbox.call('browser_click', { ref: refOf(snapshot, 'Post') })
    check('it may not press Post itself', share.isError === true && /publish/.test(share.text), share.text.slice(0, 100))
    check('...and the site saw no Post and no other press', !hits.some((h) => ['POST /share', 'POST /discard', 'POST /crop', 'POST /follow', 'POST /location', 'POST /tag', 'POST /back'].includes(h)), hits.join(', '))

    // the one publication
    const submit = await toolbox.call('browser_submit', { text_ref: refOf(snapshot, 'Write a caption'), submit_ref: refOf(snapshot, 'Post') })
    check('the application types the approved caption and presses Post', submit.isError !== true, submit.text.slice(0, 160))
    for (let i = 0; i < 40 && site.shared.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 100))
    const posted = site.shared[0]
    check('the site saw exactly one Post', site.shared.length === 1, JSON.stringify(site.shared))
    check('...with the approved caption, letter for letter', posted?.caption === caption, JSON.stringify(posted?.caption))
    check('...and both approved pictures', posted?.files.length === 2 && posted.files.every((f, i) => f.sha256 === (files[i] as ApprovedFile).sha256), JSON.stringify(posted?.files))
    check(options.realClick ? '...pressed with a real input event' : '...pressed (a real input event is expected on Chrome only)', !options.realClick || posted?.trusted === true, String(posted?.trusted))
    check('the authority took the press as the point of no return, once, with one ticket', authority.committed && authority.leases === 1, `${authority.committed} ${authority.leases}`)

    // and nothing after it
    const afterClick = await toolbox.call('browser_click', { ref: refOf(snapshot, 'Back') })
    check('nothing is clicked afterwards', afterClick.isError === true, afterClick.text.slice(0, 100))
    const afterSubmit = await toolbox.call('browser_submit', { text_ref: refOf(snapshot, 'Write a caption'), submit_ref: refOf(snapshot, 'Post') })
    check('a second submit is refused', afterSubmit.isError === true, afterSubmit.text.slice(0, 100))
    const afterAttach = await toolbox.call('browser_attach', { ref: inputRef })
    check('...and so is another picture', afterAttach.isError === true, afterAttach.text.slice(0, 100))
    const looked = await toolbox.call('browser_snapshot', {})
    check('it may still look', looked.isError !== true, looked.text.slice(0, 80))
    const wrote = hits.filter((h) => h.startsWith('POST') && h !== 'POST /attached' && h !== 'POST /next')
    check('the site saw exactly one write besides the pictures and the step: the Post', wrote.length === 1 && wrote[0] === 'POST /share', wrote.join(', '))
    const opened2 = hits.filter((h) => h.startsWith('GET') && !['GET /brand/', 'GET /favicon.ico'].includes(h))
    check('the site saw no page of it but the profile page', opened2.length === 0, opened2.join(', '))
    return checks
  } finally {
    await ai.close()
    rmSync(folder, { recursive: true, force: true })
  }
}

/** A ticket authority on a clock of its own: the probe needs real signatures, not the real time. */
export const newProbeTickets = (): TicketAuthority => new TicketAuthority(new FakeClock())
