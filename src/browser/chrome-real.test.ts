// The Chrome back end against the REAL installed Google Chrome (DEC-025). Off unless PPD_REAL_CHROME=1: CI has no say about the owner's Chrome and a
// window opening is not something a plain `npm test` should do. It starts an own Chrome (an own profile folder in a temp folder, the mock keychain,
// a debugging pipe) and a local server on 127.0.0.1; nothing else on the network is touched and no real site is opened.
//
//   PPD_REAL_CHROME=1 npx vitest run src/browser/chrome-real.test.ts

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseSnapshot, snapshotScript, type PageSnapshot } from '../core/browser-agent/snapshot'
import { SessionChangedError, TakeoverError, type BrowserPage, type SendTicket } from '../core/ports'
import type { Account } from '../shared/types'
import { ChromeBrowserService } from './chrome-browser-service'
import { findChrome, profileDirFor } from './chrome-launcher'

const REAL = process.env.PPD_REAL_CHROME === '1'

const FORM = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Get started</title></head><body>
<h1>Get started on the Probe</h1>
<div id="result" role="alert"></div>
<input id="enterbox" aria-label="Press Enter here" autocomplete="off">
<form id="f" action="javascript:void(0)">
  <label>First name <input id="first" name="first" autocomplete="off"></label>
  <label>Mobile number or email <input id="mail" name="mail" type="email"></label>
  <label>Password <input id="pw" name="pw" type="password"></label>
  <label>Month <select id="month" name="month"><option value="">Month</option><option>Jan</option><option>May</option></select></label>
  <div id="day" role="combobox" tabindex="0" aria-label="Day" aria-expanded="false">Day</div>
  <ul id="days" role="listbox" hidden><li role="option" tabindex="-1">18</li><li role="option" tabindex="-1">19</li></ul>
  <label>Photo <input id="photo" type="file"></label>
  <button id="go" type="submit">Submit</button>
</form>
<p id="facts"></p>
<script>
  const day = document.getElementById('day'), days = document.getElementById('days')
  day.addEventListener('click', () => { days.hidden = !days.hidden; day.setAttribute('aria-expanded', String(!days.hidden)) })
  for (const o of days.querySelectorAll('[role=option]')) o.addEventListener('click', () => { day.textContent = o.textContent; days.hidden = true })
  document.getElementById('enterbox').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('result').textContent = 'Enter seen: ' + e.isTrusted })
  document.getElementById('go').addEventListener('click', async (e) => {
    const body = JSON.stringify({ first: first.value, mail: mail.value, month: month.value, day: day.textContent, photo: photo.files.length ? photo.files[0].name : '', trusted: e.isTrusted })
    const r = await fetch('/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    document.getElementById('result').textContent = 'Submit answered ' + r.status
  })
  document.getElementById('facts').textContent = 'webdriver=' + navigator.webdriver + ' ua=' + navigator.userAgent
</script></body></html>`

/**
 * The page the owner has in their own window. It does by itself what the owner does by hand, a moment after it loads: `?go=/logout` goes to a sign-out
 * address, `?fetch=/api/logout` asks for one in the background (a sign-out that is a fetch). Their effect on the browser is the same as the owner's click.
 */
const OWNER_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Owner window</title></head><body>
<h1>The owner's page</h1>
<input id="own" aria-label="Owner field" autocomplete="off">
<script>
  const q = new URLSearchParams(location.search)
  if (q.get('go')) setTimeout(() => { location.href = q.get('go') }, 600)
  if (q.get('fetch')) setTimeout(() => { fetch(q.get('fetch'), { method: 'POST' }).catch(() => undefined) }, 600)
</script></body></html>`

const SIGNED_OUT_PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed out</title></head><body><h1>You are signed out</h1></body></html>'

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function until(condition: () => boolean | Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (await condition()) return
    await pause(100)
  }
  throw new Error(`Timed out waiting for: ${what}`)
}

describe.skipIf(!REAL)('the Chrome back end on the real installed Chrome', () => {
  let dataDir: string
  let server: Server
  let base = ''
  const submits: Record<string, unknown>[] = []
  const events: string[] = []
  const notes: string[] = []
  let service: ChromeBrowserService
  const account: Account = {
    id: 'acct-probe',
    platform: 'facebook',
    label: 'Probe',
    identity: null,
    partition: 'persist:ppd-probe-1',
    status: 'active',
    createdAt: new Date().toISOString(),
    productId: null,
    role: null,
    loginName: null
  } as unknown as Account
  const env = { ...process.env, PPD_CHROME_MOCK_KEYCHAIN: '1' }
  const hosts = ['127.0.0.1']

  beforeAll(async () => {
    expect(findChrome(env), 'Google Chrome is installed').not.toBeNull()
    dataDir = await mkdtemp(join(tmpdir(), 'ppd-chrome-real-'))
    server = createServer((request, response) => {
      if (request.method === 'POST' && request.url === '/submit') {
        let text = ''
        request.on('data', (chunk) => (text += chunk))
        request.on('end', () => {
          submits.push(JSON.parse(text) as Record<string, unknown>)
          response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
        })
        return
      }
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path === '/owner') return void response.writeHead(200, { 'content-type': 'text/html' }).end(OWNER_PAGE)
      if (path === '/logout') return void response.writeHead(200, { 'content-type': 'text/html' }).end(SIGNED_OUT_PAGE)
      if (path.startsWith('/api/')) return void response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      response.writeHead(200, { 'content-type': 'text/html' }).end(FORM)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    service = new ChromeBrowserService({ assertValid: () => undefined }, { dataDir, diagnosticsDir: join(dataDir, 'diagnostics'), env })
    service.onUserWindowChange = (id, change) => void events.push(`${id}:${change}`)
    service.onPageNote = (_id, note) => void notes.push(note)
  }, 60_000)

  afterAll(async () => {
    await service?.forgetAccount(account).catch(() => undefined)
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    await rm(dataDir, { recursive: true, force: true })
  }, 60_000)

  const look = async (page: BrowserPage): Promise<PageSnapshot> => {
    const snapshot = parseSnapshot(await page.read(snapshotScript()))
    if (!snapshot) throw new Error('no snapshot')
    return snapshot
  }
  const ref = (snapshot: PageSnapshot, role: RegExp, name: RegExp): string => {
    const found = snapshot.elements.find((element) => role.test(element.role) && name.test(element.name))
    if (!found) throw new Error(`no element ${role} ${name} in ${snapshot.elements.map((e) => `${e.role}:${e.name}`).join(' | ')}`)
    return found.ref
  }
  const resultText = (page: BrowserPage): Promise<string> => page.read<string>("document.getElementById('result').textContent")

  it('opens a real page in a Chrome of its own, started as a normal browser', async () => {
    await service.session(account).withAgentControl('probe', async (page) => {
      await page.goto(`${base}/form`)
      expect(await page.url()).toBe(`${base}/form`)
      expect(await page.read<string>('document.title')).toBe('Get started')
    })
    const profile = profileDirFor(dataDir, account.partition)
    expect(existsSync(profile)).toBe(true)
    const command = execFileSync('ps', ['-axo', 'command=']).toString().split('\n').filter((line) => line.includes(profile) && !line.includes('Helper'))
    expect(command.length).toBeGreaterThan(0)
    for (const line of command) {
      expect(line).not.toMatch(/enable-automation|--headless|remote-debugging-port|--user-agent|disable-blink-features/)
      expect(line).toMatch(/--remote-debugging-pipe/)
    }
    console.log('what the page says about the browser:', await service.session(account).withAgentControl('probe', (page) => page.read<string>("document.getElementById('facts').textContent")))
  }, 90_000)

  it('does what the mission does: looks, types with real input, picks from a list and a drop-down that is not a list, uploads, presses Enter, clicks Submit', async () => {
    const photo = join(dataDir, 'photo.png')
    await writeFile(photo, 'png')
    await service.session(account).withAgentControl('probe', async (page) => {
      let snapshot = await look(page)
      const pageStep = (step: Parameters<BrowserPage['pageStep']>[0]) => page.pageStep(step, hosts)

      expect(await pageStep({ do: 'type', ref: ref(snapshot, /input/, /First name/), text: 'Boris' })).toMatchObject({ status: 'done' })
      expect(await page.read<string>("document.getElementById('first').value")).toBe('Boris')
      expect(await pageStep({ do: 'type', ref: ref(snapshot, /input/, /Press Enter here/), text: 'go' })).toMatchObject({ status: 'done' })
      expect(await pageStep({ do: 'key', key: 'Enter' })).toMatchObject({ status: 'done' })
      expect(await resultText(page)).toBe('Enter seen: true')

      expect(await pageStep({ do: 'type', ref: ref(snapshot, /input/, /Mobile number or email/), text: 'probe@example.com' })).toMatchObject({ status: 'done' })
      expect(await pageStep({ do: 'select', ref: ref(snapshot, /select/, /Month/), text: 'May' })).toMatchObject({ status: 'done' })
      expect(await page.read<string>("document.getElementById('month').value")).toBe('May')

      expect(await pageStep({ do: 'select', ref: ref(snapshot, /combobox/, /Day/), text: '19' })).toMatchObject({ status: 'done' })
      expect(await page.read<string>("document.getElementById('day').textContent")).toBe('19')

      snapshot = await look(page)
      expect(await pageStep({ do: 'upload', ref: ref(snapshot, /file|input/, /Photo/), path: photo })).toMatchObject({ status: 'done' })
      expect(await page.read<string>("document.getElementById('photo').files.length ? document.getElementById('photo').files[0].name : ''")).toBe('photo.png')

      const clicked = await pageStep({ do: 'click', ref: ref(snapshot, /button/, /Submit/) })
      expect(clicked.status).toBe('done')
      expect(clicked.detail).toContain('with a mouse click')
      await page.waitForSelector('#result')
      for (let i = 0; i < 20 && !(await resultText(page)).startsWith('Submit'); i++) await new Promise((r) => setTimeout(r, 150))
      expect(await resultText(page)).toBe('Submit answered 200')
    })
    expect(submits).toHaveLength(1)
    expect(submits[0]).toEqual({ first: 'Boris', mail: 'probe@example.com', month: 'May', day: '19', photo: 'photo.png', trusted: true })
  }, 90_000)

  it('refuses a page that is not the platform\'s, before any input', async () => {
    await service.session(account).withAgentControl('probe', async (page) => {
      const result = await page.pageStep({ do: 'key', key: 'Enter' }, ['facebook.com'])
      expect(result.status).toBe('wrong_host')
    })
  })

  it('shows and minimises the window, and says what the page shows and did', async () => {
    service.showAgentBrowser(account, false)
    await new Promise((r) => setTimeout(r, 800))
    const report = await service.pageReport(account)
    expect(report).not.toBeNull()
    expect(report?.where).toBe('app_page')
    expect(report?.title).toBe('Get started')
    expect(report?.address).toBe(`127.0.0.1:${new URL(base).port}/form`)
    expect(report?.alerts.join(' ')).toContain('Submit answered 200')
    expect(report?.requests.some((request) => request.method === 'POST' && request.target.endsWith('/submit') && request.status === 200)).toBe(true)
    expect(report?.screenshot?.startsWith('data:image/png;base64,')).toBe(true)
    expect(report?.savedAs).not.toBeNull()
    expect(JSON.stringify(report)).not.toContain('probe@example.com')
  }, 60_000)

  const aiTitle = (): Promise<string> => service.session(account).withAgentControl('probe', async (page) => page.read<string>('document.title'))
  const ownerTitle = async (): Promise<string | undefined> => (await service.ownerPage(account))?.title
  const ticket = {} as SendTicket

  it('keeps the AI\'s page and the owner\'s window side by side on one session: a window for the owner takes nothing from the AI (DEC-038)', async () => {
    const before = events.length
    const opened = await service.openForUser(account, `${base}/owner`)
    expect(opened.tabId).toBe('account-acct-probe')
    expect(events.slice(before)).toEqual(['acct-probe:opened'])
    expect(service.hasUserWindow(account)).toBe(true)
    expect(service.session(account).control()).toEqual({ holder: 'none', owner: null })
    await until(async () => (await ownerTitle()) === 'Owner window', 'the owner window shows its page')

    // The AI's page is its own: it still shows the form, and the owner's window is another page.
    expect(await aiTitle()).toBe('Get started')
    expect(await service.ownerPage(account)).toEqual({ url: `${base}/owner`, title: 'Owner window' })
    // What the diagnostic page report reads is the owner's window while one is open, and the AI's page otherwise.
    expect((await service.pageReport(account))?.where).toBe('owner_window')

    // The AI works in its own page, behind the owner's window: it types with real input and clicks with a real mouse click, and it never touches the owner's page.
    const submitsBefore = submits.length
    await service.session(account).withAgentControl('probe', async (page) => {
      await page.goto(`${base}/form`)
      const snapshot = await look(page)
      const step = (input: Parameters<BrowserPage['pageStep']>[0]) => page.pageStep(input, hosts)
      expect(await step({ do: 'type', ref: ref(snapshot, /input/, /First name/), text: 'Beside the owner' })).toMatchObject({ status: 'done' })
      const clicked = await step({ do: 'click', ref: ref(snapshot, /button/, /Submit/) })
      expect(clicked.status).toBe('done')
      expect(clicked.detail).toContain('with a mouse click')
      for (let i = 0; i < 30 && !(await resultText(page)).startsWith('Submit'); i++) await pause(150)
      expect(await resultText(page)).toBe('Submit answered 200')
    })
    expect(submits.length).toBe(submitsBefore + 1)
    expect(submits.at(-1)).toMatchObject({ first: 'Beside the owner', trusted: true })
    expect(await ownerTitle()).toBe('Owner window')
    expect((await service.pageReport(account))?.text).toContain("The owner's page")

    // Opening the same address again brings the window to the front instead of opening another one.
    await service.openForUser(account, `${base}/owner`)
    expect(events.slice(before)).toEqual(['acct-probe:opened'])
    expect(service.showUserWindow(account)).toBe(true)
  }, 120_000)

  it('does not interrupt a turn in progress when the owner opens a window and moves around in it', async () => {
    service.closeUserWindow(account)
    await until(() => !service.hasUserWindow(account), 'the owner windows are closed')
    const results = await service.session(account).withAgentControl('probe', async (page) => {
      await page.goto(`${base}/form`)
      const seen: string[] = []
      seen.push(await page.read<string>('document.title'))
      await service.openForUser(account, `${base}/owner`)
      seen.push(await page.read<string>('document.title'))
      await service.openForUser(account, `${base}/owner?second=1`)
      seen.push(await page.read<string>('document.title'))
      seen.push(await page.url())
      return seen
    })
    expect(results).toEqual(['Get started', 'Get started', 'Get started', `${base}/form`])
    expect(service.session(account).control().holder).toBe('none')
    expect(service.hasUserWindow(account)).toBe(true)
  }, 120_000)

  it('reads the page the owner is on: one window gives its page, several give the one that shows, and a doubt says how many there are', async () => {
    // Two windows of the owner's are open now (the previous test opened them). Chrome tells which one shows and has the focus; when it cannot, the core is told "several".
    const page = await service.ownerPage(account)
    console.log('with two owner windows the page of the owner is:', JSON.stringify(page))
    expect(page).not.toBeNull()
    if (page && page.url) expect([`${base}/owner`, `${base}/owner?second=1`]).toContain(page.url)
    else expect(page).toMatchObject({ url: '', title: '', tabs: 2 })
    service.closeUserWindow(account)
    await until(() => !service.hasUserWindow(account), 'the owner windows are closed')
    await service.openForUser(account, `${base}/owner`)
    await until(async () => (await ownerTitle()) === 'Owner window', 'one owner window shows its page')
    expect(await service.ownerPage(account)).toEqual({ url: `${base}/owner`, title: 'Owner window' })
  }, 120_000)

  it('notices when the owner\'s window goes to a sign-out address, by a page change or by a request, and not what the AI itself does', async () => {
    const session = service.session(account)
    const quiet = session.identityEpoch()
    // The AI's own page may go anywhere, a sign-out address among them: that is its mission, not the owner's doing.
    await session.withAgentControl('probe', async (page) => {
      await page.goto(`${base}/logout`)
      await page.goto(`${base}/form`)
    })
    expect(session.identityEpoch()).toBe(quiet)

    // The owner's window goes to a sign-out page by itself a moment after it loads (the same events as the owner's click).
    service.closeUserWindow(account)
    await until(() => !service.hasUserWindow(account), 'the owner windows are closed')
    const before = session.identityEpoch()
    await service.openForUser(account, `${base}/owner?go=/logout`)
    await until(() => session.identityEpoch() > before, 'the sign-out page was noticed', 15_000)
    await until(async () => (await ownerTitle()) === 'Signed out', 'the owner window shows the sign-out page')

    // A sign-out that is a request in the background.
    service.closeUserWindow(account)
    await until(() => !service.hasUserWindow(account), 'the owner windows are closed')
    const beforeFetch = session.identityEpoch()
    await service.openForUser(account, `${base}/owner?fetch=/api/accounts/logout/`)
    await until(() => session.identityEpoch() > beforeFetch, 'the background sign-out was noticed', 15_000)
  }, 120_000)

  it('refuses a write of a turn that began before the owner\'s window used a sign-out page, before anything reaches the AI\'s page', async () => {
    const session = service.session(account)
    service.closeUserWindow(account)
    await until(() => !service.hasUserWindow(account), 'the owner windows are closed')
    const submitsBefore = submits.length
    const turn = session.withAgentControl('probe', async (page) => {
      await page.goto(`${base}/form`)
      await service.openForUser(account, `${base}/owner?go=/logout`)
      const epoch = session.identityEpoch()
      await until(() => session.identityEpoch() > epoch, 'the sign-out page was noticed', 15_000)
      // The page is read as before; a write is refused.
      expect(await page.read<string>('document.title')).toBe('Get started')
      await page.fill('#first', 'must not be typed', ticket)
    })
    await expect(turn).rejects.toBeInstanceOf(SessionChangedError)
    expect(submits.length).toBe(submitsBefore)
    await session.withAgentControl('probe', async (page) => expect(await page.read<string>("document.getElementById('first').value")).not.toBe('must not be typed'))
    // The next turn is a new one and can write again (the mission itself decides, from the sign-in it reads, whether it may).
    await session.withAgentControl('probe', async (page) => {
      await page.fill('#first', 'typed in a new turn', ticket)
      expect(await page.read<string>("document.getElementById('first').value")).toBe('typed in a new turn')
    })
  }, 120_000)

  it('keeps the explicit take-over for the AI\'s own page: it stops the AI at once, brings the AI\'s page to the front, and the AI works again when it is given back', async () => {
    service.closeUserWindow(account)
    await until(() => !service.hasUserWindow(account), 'the owner windows are closed')
    const session = service.session(account)
    session.takeControl()
    await expect(session.withAgentControl('probe', async () => 'ran')).rejects.toBeInstanceOf(TakeoverError)
    service.showAgentBrowser(account, true)
    await pause(500)
    expect((await service.pageReport(account))?.where).toBe('app_page')
    session.releaseControl()
    expect(session.control().holder).toBe('none')
    await expect(aiTitle()).resolves.toBe('Get started')
  }, 90_000)

  it('closes only the owner\'s window when the app closes it, says so once, and leaves the AI\'s page working', async () => {
    const before = events.length
    await service.openForUser(account, `${base}/owner`)
    expect(events.slice(before)).toEqual(['acct-probe:opened'])
    service.closeUserWindow(account)
    await until(() => events.slice(before).includes('acct-probe:closed'), 'the closed event')
    expect(service.hasUserWindow(account)).toBe(false)
    expect(service.showUserWindow(account)).toBe(false)
    await expect(aiTitle()).resolves.toBe('Get started')
  }, 90_000)

  it('starts a new Chrome when the owner quit the old one, and keeps the same profile', async () => {
    const profile = profileDirFor(dataDir, account.partition)
    const before = execFileSync('ps', ['-axo', 'pid=,command=']).toString().split('\n').filter((line) => line.includes(`--user-data-dir=${profile}`) && !line.includes('Helper'))
    expect(before.length).toBe(1)
    const pid = Number(before[0].trim().split(/\s+/)[0])
    process.kill(pid, 'SIGTERM')
    await new Promise((r) => setTimeout(r, 1500))
    await expect(service.session(account).withAgentControl('probe', async (page) => page.goto(`${base}/form`).then(() => page.read<string>('document.title')))).resolves.toBe('Get started')
    expect(existsSync(profile)).toBe(true)
  }, 90_000)

  it('forgets an account: closes its Chrome and removes its profile folder, and nothing else', async () => {
    const profile = profileDirFor(dataDir, account.partition)
    const sibling = join(dataDir, 'chrome-profiles', 'someone-else')
    await writeFile(join(dataDir, 'ppd.sqlite'), 'db')
    await service.forgetAccount(account)
    expect(existsSync(profile)).toBe(false)
    expect(existsSync(join(dataDir, 'ppd.sqlite'))).toBe(true)
    expect(existsSync(sibling)).toBe(false)
    await new Promise((r) => setTimeout(r, 800))
    const left = execFileSync('ps', ['-axo', 'command=']).toString().split('\n').filter((line) => line.includes(`--user-data-dir=${profile}`))
    expect(left).toEqual([])
    expect(notes.filter((note) => /could not/i.test(note))).toEqual([])
  }, 60_000)
})
