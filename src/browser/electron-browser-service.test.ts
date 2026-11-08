// Runs the service's own logic against a fake 'electron' module (see fake-electron.ts). It verifies how the
// service uses sessions, windows and control; it cannot prove that Electron behaves as assumed.

import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => await import('./fake-electron'))

import type { Account } from '../shared/types'
import { TakeoverError, TicketError } from '../core/ports'
import { FakeClock } from '../core/testing/fakes'
import { TicketAuthority } from '../core/tickets'
import { created, type FakeWebContents } from './fake-electron'
import { ElectronBrowserService } from './electron-browser-service'
import { TOOLBAR_COMMAND_ORIGIN } from './toolbar-state'

const account = (id: string, partition = `persist:ppd-${id}`): Account => ({
  id,
  platform: 'reddit',
  label: `Account ${id}`,
  identity: 'natal_bot',
  partition,
  status: 'ready',
  createdAt: '2026-11-08T00:00:00.000Z',
  productId: null,
  role: null,
  loginName: null, email: null, mailboxId: null
})

function setup() {
  const clock = new FakeClock()
  const tickets = new TicketAuthority(clock)
  return { service: new ElectronBrowserService(tickets), tickets }
}

const agentContents = (): FakeWebContents => {
  const view = created.views[0]
  if (!view) throw new Error('no view created')
  return view.webContents
}

beforeEach(() => created.reset())

describe('sessions per account (REQ-004: shared accounts cannot get concurrent control)', () => {
  it('returns the same controlled session for the same account and a different one for another account', () => {
    const { service } = setup()
    const a = service.session(account('a'))
    expect(service.session(account('a'))).toBe(a)
    expect(service.session(account('b'))).not.toBe(a)
  })

  it('serializes agent runs of two channels that share the account', async () => {
    const { service } = setup()
    const order: string[] = []
    const run = (name: string, ms: number) =>
      service.session(account('shared')).withAgentControl(name, async () => {
        order.push(`start ${name}`)
        await new Promise((r) => setTimeout(r, ms))
        order.push(`end ${name}`)
      })
    await Promise.all([run('channel-1', 25), run('channel-2', 1)])
    expect(order).toEqual(['start channel-1', 'end channel-1', 'start channel-2', 'end channel-2'])
  })

  it('uses the persistent partition consistently, with or without the prefix', async () => {
    const { service } = setup()
    await service.session(account('p1', 'ppd-p1')).withAgentControl('t', async (page) => page.goto('https://www.reddit.com/'))
    await service.session(account('p2', 'persist:ppd-p2')).withAgentControl('t', async (page) => page.goto('https://www.reddit.com/'))
    expect([...created.sessions.keys()].sort()).toEqual(['persist:ppd-p1', 'persist:ppd-p2'])
    expect(created.views.map((v) => v.options.webPreferences?.partition)).toEqual(['persist:ppd-p1', 'persist:ppd-p2'])
  })

  it('refuses an account whose partition name is not safe', () => {
    const { service } = setup()
    expect(() => service.session(account('x', 'persist:../../escape'))).toThrow(/Invalid browser partition/)
  })
})

describe('agent page', () => {
  it('works in a hidden window with a real viewport and restricted capabilities', async () => {
    const { service } = setup()
    await service.session(account('a')).withAgentControl('t', async (page) => page.goto('https://www.reddit.com/r/test/'))
    expect(created.windows).toHaveLength(1)
    expect(created.windows[0].visible).toBe(false)
    expect(created.windows[0].options).toMatchObject({ show: false, width: 1280, height: 900 })
    expect(created.views[0].bounds).toEqual({ x: 0, y: 0, width: 1280, height: 900 })
    expect(agentContents().loaded).toEqual(['https://www.reddit.com/r/test/'])
    expect(agentContents().muted).toBe(true)
    expect(created.views[0].options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false })
    expect(agentContents().windowOpenHandler?.({ url: 'https://popup.example/' })).toEqual({ action: 'deny' })
  })

  it('recreates the page after it crashed or was destroyed, and releases the old window', async () => {
    const { service } = setup()
    const session = service.session(account('a'))
    await session.withAgentControl('t', async (page) => page.goto('https://a.test/'))
    const firstView = created.views[0]
    firstView.webContents.emit('render-process-gone')
    expect(firstView.webContents.destroyed).toBe(true)
    expect(created.windows[0].destroyed).toBe(true)
    await session.withAgentControl('t', async (page) => page.goto('https://b.test/'))
    expect(created.views).toHaveLength(2)
    expect(created.views[1].webContents.loaded).toEqual(['https://b.test/'])
    expect(created.windows[1].destroyed).toBe(false)
  })

  it('configures the session once: no permissions, no downloads, plain Chromium user agent', async () => {
    const { service } = setup()
    await service.session(account('a')).withAgentControl('t', async (page) => page.goto('https://www.reddit.com/'))
    const ses = created.sessions.get('persist:ppd-a')!
    const granted: boolean[] = []
    ses.permissionRequest?.({}, 'geolocation', (ok) => granted.push(ok))
    expect(granted).toEqual([false])
    expect(ses.permissionCheck?.()).toBe(false)
    ses.emitDownload()
    expect(ses.downloadPrevented).toBe(true)
    expect(ses.userAgent).not.toMatch(/Electron|product-promotion-desk/)
    expect(ses.userAgent).toMatch(/Chrome\/140/)
  })

  it('refuses to navigate to non-web addresses', async () => {
    const { service } = setup()
    await expect(service.session(account('a')).withAgentControl('t', async (page) => page.goto('file:///etc/passwd'))).rejects.toThrow(/http and https/)
    expect(created.views).toHaveLength(0)
  })

  it('times out a page that never finishes loading and stops it', async () => {
    const { service } = setup()
    const session = service.session(account('a'))
    await session.withAgentControl('warmup', async (page) => page.goto('https://a.test/'))
    agentContents().loadResult = new Promise(() => undefined)
    await expect(session.withAgentControl('t', async (page) => page.goto('https://slow.test/', { timeoutMs: 20 }))).rejects.toThrow(/Timed out/)
    expect(agentContents().stopped).toBe(1)
  })

  it('treats ERR_ABORTED caused by a redirect as success once the page has loaded', async () => {
    const { service } = setup()
    const session = service.session(account('a'))
    await session.withAgentControl('warmup', async (page) => page.goto('https://a.test/'))
    agentContents().loadResult = Promise.reject(new Error("ERR_ABORTED (-3) loading 'https://b.test/'"))
    await expect(session.withAgentControl('t', async (page) => page.goto('https://b.test/'))).resolves.toBeUndefined()
  })

  it('reads through executeJavaScript without a user gesture and polls for selectors', async () => {
    const { service } = setup()
    const session = service.session(account('a'))
    await session.withAgentControl('warmup', async (page) => page.goto('https://a.test/'))
    agentContents().results = [{ value: 1 }]
    expect(await session.withAgentControl('t', async (page) => page.read<{ value: number }>('1+1'))).toEqual({ value: 1 })
    agentContents().results = [false, true]
    expect(await session.withAgentControl('t', async (page) => page.waitForSelector('#x', 2000))).toBe(true)
  })

  it('requires a ticket for fill and click, and reports a missing element', async () => {
    const { service, tickets } = setup()
    const session = service.session(account('a'))
    await session.withAgentControl('warmup', async (page) => page.goto('https://a.test/'))
    agentContents().results = [{ ok: false, reason: 'not_found' }]
    await expect(session.withAgentControl('t', async (page) => page.fill('#x', 'text', undefined as never))).rejects.toBeInstanceOf(TicketError)
    const ticket = tickets.issue({ actionId: 'a', contentHash: 'h', accountId: 'a', destination: 'd' })
    await expect(session.withAgentControl('t', async (page) => page.fill('#x', 'text', ticket))).rejects.toThrow(/Could not fill "#x": the element was not found/)
    agentContents().results = [{ ok: true }]
    await expect(session.withAgentControl('t', async (page) => page.click('#x', ticket))).resolves.toBeUndefined()
  })
})

describe('sign-in form that the page draws late (Reddit builds it from web components)', () => {
  const form = { username: 'natal_bot', password: 'S3cret-Pa$$w0rd!', hosts: ['reddit.com'] }
  /** Opens the login page, lets the page answer with `results` to successive looks for the form, and signs in. */
  const signIn = (service: ElectronBrowserService, results: unknown[], prepare?: (contents: FakeWebContents) => void) =>
    service.session(account('a')).withAgentControl('sign-in', async (page) => {
      await page.goto('https://www.reddit.com/login/')
      agentContents().results = results
      prepare?.(agentContents())
      return page.signIn(form)
    })

  it('asks again while there is no form, and answers once the form is there', async () => {
    vi.useFakeTimers()
    try {
      const { service } = setup()
      const done = signIn(service, [{ status: 'no_form' }, { status: 'no_form' }, { status: 'no_form' }, { status: 'submitted' }])
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(done).resolves.toEqual({ status: 'submitted' })
      expect(agentContents().scripts.length).toBe(4) // the form was sent once, on the fourth look
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up with "no_form" after the wait when the form never appears', async () => {
    vi.useFakeTimers()
    try {
      const { service } = setup()
      const done = signIn(service, [{ status: 'no_form' }])
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(done).resolves.toEqual({ status: 'no_form' })
      expect(agentContents().scripts.length).toBeGreaterThan(5)
      expect(agentContents().scripts.length).toBeLessThanOrEqual(35)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['submitted', 'next_step', 'captcha', 'wrong_host'] as const)('does not ask again after "%s"', async (answer) => {
    const { service } = setup()
    await expect(signIn(service, [{ status: answer }])).resolves.toEqual({ status: answer })
    expect(agentContents().scripts.length).toBe(1)
  })

  it('does not ask again when the page fails to answer, and the error cannot contain the password', async () => {
    const { service } = setup()
    const error = await signIn(service, [], (contents) => {
      contents.executeJavaScript = async (script: string) => {
        contents.scripts.push(script)
        throw new Error(`boom ${form.password}`)
      }
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('The sign-in page did not answer.')
    expect(agentContents().scripts.length).toBe(1)
  })
})

describe('user takeover and login hand-off', () => {
  it('takes control before showing the window, so the agent stops at once', async () => {
    const { service } = setup()
    const acc = account('a')
    const session = service.session(acc)
    const inFlight = session.withAgentControl('assess', async (page) => {
      await page.goto('https://www.reddit.com/')
      await service.openForUser(acc, 'https://www.reddit.com/login/')
      await page.goto('https://www.reddit.com/other')
    })
    await expect(inFlight).rejects.toBeInstanceOf(TakeoverError)
    expect(session.control().holder).toBe('user')
    expect(agentContents().loaded).toEqual(['https://www.reddit.com/'])
  })

  it('opens one window in the account partition with the toolbar, showing the login page', async () => {
    const { service } = setup()
    const result = await service.openForUser(account('a'), 'https://www.reddit.com/login/')
    expect(result.tabId).toBe('account-a')
    expect(created.windows).toHaveLength(1)
    const [site, bar] = created.views
    expect(site.options.webPreferences).toMatchObject({ partition: 'persist:ppd-a', sandbox: true, nodeIntegration: false })
    expect(bar.options.webPreferences?.partition).toBe('ppd-toolbar') // not persistent, not shared with any site
    expect(site.webContents.loaded).toEqual(['https://www.reddit.com/login/'])
    expect(bar.webContents.loaded[0]).toMatch(/^data:text\/html/)
    expect(decodeURIComponent(bar.webContents.loaded[0])).toContain('Done, close this window')
    expect(created.windows[0].children).toEqual([site, bar])
  })

  it('reuses the open window for the same account instead of opening another', async () => {
    const { service } = setup()
    await service.openForUser(account('a'), 'https://www.reddit.com/login/')
    await service.openForUser(account('a'), 'https://www.reddit.com/settings/')
    expect(created.windows).toHaveLength(1)
    expect(created.windows[0].focused).toBe(1)
    expect(created.views[0].webContents.loaded).toEqual(['https://www.reddit.com/login/', 'https://www.reddit.com/settings/'])
  })

  it('gives control back when the toolbar button is pressed, and closes the window', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    const bar = created.views[1].webContents
    expect(bar.windowOpenHandler?.({ url: `${TOOLBAR_COMMAND_ORIGIN}/release` })).toEqual({ action: 'deny' })
    expect(created.windows[0].destroyed).toBe(true)
    const session = service.session(acc)
    expect(session.control().holder).toBe('none')
    await expect(session.withAgentControl('monitor', async () => 'resumed')).resolves.toBe('resumed')
  })

  it('tells whether the account window is open, so the app does not release control behind it', async () => {
    const { service } = setup()
    const acc = account('a')
    expect(service.hasUserWindow(acc)).toBe(false)
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    expect(service.hasUserWindow(acc)).toBe(true)
    expect(service.hasUserWindow(account('other'))).toBe(false)
    created.windows[0].close()
    expect(service.hasUserWindow(acc)).toBe(false)
  })

  it('brings the open window above the application window, without loading anything', async () => {
    const { service } = setup()
    const acc = account('a')
    expect(service.showUserWindow(acc)).toBe(false)
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    const loaded = [...created.views[0].webContents.loaded]
    expect(service.showUserWindow(acc)).toBe(true)
    expect(created.windows[0].raised).toBe(1)
    expect(created.windows[0].focused).toBe(1)
    expect(created.views[0].webContents.loaded).toEqual(loaded)
    created.windows[0].close()
    expect(service.showUserWindow(acc)).toBe(false)
  })

  it('closes the window for the app and gives the browser back once', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    expect(service.session(acc).control().holder).toBe('user')
    service.closeUserWindow(acc)
    expect(created.windows[0].destroyed).toBe(true)
    expect(service.hasUserWindow(acc)).toBe(false)
    expect(service.session(acc).control().holder).toBe('none')
    service.closeUserWindow(acc) // nothing is open any more: no error
  })

  it('tells the core when the window opens and when it closes, however it was closed', async () => {
    const { service } = setup()
    const changes: string[] = []
    service.onUserWindowChange = (id, change) => changes.push(`${id}:${change}`)
    const acc = account('a')
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    await service.openForUser(acc, 'https://www.reddit.com/settings/') // the same window: not a second "opened"
    expect(changes).toEqual(['a:opened'])
    created.windows[0].close()
    expect(changes).toEqual(['a:opened', 'a:closed'])
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    service.closeUserWindow(acc)
    expect(changes).toEqual(['a:opened', 'a:closed', 'a:opened', 'a:closed'])
  })

  it('gives control back when the user simply closes the window', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    created.windows[0].close()
    expect(service.session(acc).control().holder).toBe('none')
    expect(created.views.every((v) => v.webContents.destroyed)).toBe(true)
  })

  it('a late close event of an old window does not release a newer window\'s control', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    const first = created.windows[0]
    created.views[1].webContents.windowOpenHandler?.({ url: `${TOOLBAR_COMMAND_ORIGIN}/release` })
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    expect(created.windows).toHaveLength(2)
    first.emit('closed') // duplicate/late event from the first window
    expect(service.session(acc).control().holder).toBe('user')
  })

  it('handles toolbar back and reload, and ignores unknown commands', async () => {
    const { service } = setup()
    await service.openForUser(account('a'), 'https://www.reddit.com/login/')
    const [site, bar] = created.views.map((v) => v.webContents)
    site.canGoBack = true
    bar.windowOpenHandler?.({ url: `${TOOLBAR_COMMAND_ORIGIN}/back` })
    bar.windowOpenHandler?.({ url: `${TOOLBAR_COMMAND_ORIGIN}/reload` })
    bar.windowOpenHandler?.({ url: `${TOOLBAR_COMMAND_ORIGIN}/format-disk` })
    bar.windowOpenHandler?.({ url: 'https://evil.example/release' })
    expect([site.wentBack, site.reloaded]).toEqual([1, 1])
    expect(created.windows[0].destroyed).toBe(false)
  })

  it('shows the account label and identity in the toolbar once it has loaded', async () => {
    const { service } = setup()
    await service.openForUser(account('a'), 'https://www.reddit.com/login/')
    const bar = created.views[1].webContents
    bar.emit('did-finish-load')
    const update = bar.scripts.at(-1) ?? ''
    expect(update).toContain('window.ppdUpdate(')
    expect(update).toContain('Account a')
    expect(update).toContain('signed in as natal_bot')
  })

  it('refuses a credential-bearing address without taking control or opening a window', async () => {
    const { service } = setup()
    const acc = account('a')
    await expect(service.openForUser(acc, 'https://me:secret@www.reddit.com/')).rejects.toThrow(/credentials/)
    expect(created.windows).toHaveLength(0)
    expect(service.session(acc).control().holder).toBe('none')
  })

  it('needs an address when the agent has not loaded anything yet', async () => {
    const { service } = setup()
    await expect(service.openForUser(account('a'))).rejects.toThrow(/No address/)
  })

  it('does not touch the page content of the user window (no scripts run in the site)', async () => {
    const { service } = setup()
    await service.openForUser(account('a'), 'https://www.reddit.com/login/')
    expect(created.views[0].webContents.scripts).toEqual([])
  })
})

describe('removing an account', () => {
  it('closes its windows, stops the agent and wipes the stored session', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.session(acc).withAgentControl('t', async (page) => page.goto('https://www.reddit.com/'))
    await service.openForUser(acc, 'https://www.reddit.com/login/')
    await service.forgetAccount(acc)
    expect(created.windows.every((w) => w.destroyed)).toBe(true)
    expect(created.views.every((v) => v.webContents.destroyed)).toBe(true)
    const ses = created.sessions.get('persist:ppd-a')!
    expect([ses.cleared, ses.cacheCleared]).toEqual([1, 1])
  })
})

describe('what the account\'s page shows and did (DEC-016)', () => {
  const dirs: string[] = []
  afterEach(async () => {
    while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
  })
  const reading = { title: 'Facebook', text: 'Get started', alerts: ['We could not create your account'] }

  it('has nothing to report while no page is open', async () => {
    const { service } = setup()
    expect(await service.pageReport(account('a'))).toBeNull()
    service.session(account('a'))
    expect(await service.pageReport(account('a'))).toBeNull()
  })

  it('reports the owner\'s window: its messages, a screenshot, the requests and the console errors; the query is dropped', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.openForUser(acc, 'https://www.facebook.com/r.php?token=secret')
    const site = created.views[0].webContents
    site.results = [reading]
    created.sessions.get('persist:ppd-a')!.emitRequest({ method: 'POST', url: 'https://www.facebook.com/reg/submit/?x=1', statusCode: 200 })
    site.emit('console-message', { level: 'error', message: 'Uncaught TypeError' })

    const report = await service.pageReport(acc)
    expect(report).toMatchObject({
      where: 'owner_window',
      address: 'www.facebook.com/r.php',
      title: 'Facebook',
      alerts: ['We could not create your account'],
      requests: [{ method: 'POST', target: 'www.facebook.com/reg/submit/', status: 200 }],
      consoleErrors: ['Uncaught TypeError'],
      screenshot: 'data:image/png;base64,cG5nLWJ5dGVz',
      savedAs: null
    })
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('runs a script in the owner\'s window only when asked, and only the reading script', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.openForUser(acc, 'https://www.facebook.com/r.php')
    const site = created.views[0].webContents
    site.results = [reading]
    created.sessions.get('persist:ppd-a')!.emitRequest({ method: 'POST', url: 'https://www.facebook.com/ajax/bz', statusCode: 500 })
    site.emit('console-message', { level: 'error', message: 'x' })
    expect(site.scripts).toEqual([]) // watching the network and the console runs nothing in the page
    await service.pageReport(acc)
    expect(site.scripts).toHaveLength(1)
    expect(site.scripts[0]).toContain('page-reading')
  })

  it('reports the page the app works in when the owner has no window, and says so', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.session(acc).withAgentControl('t', async (page) => page.goto('https://www.reddit.com/'))
    agentContents().results = [reading]
    expect((await service.pageReport(acc))?.where).toBe('app_page')
  })

  it('still reports when the page could not be drawn or read', async () => {
    const { service } = setup()
    const acc = account('a')
    await service.openForUser(acc, 'https://www.facebook.com/r.php')
    const site = created.views[0].webContents
    site.picture = null
    site.executeJavaScript = async () => {
      throw new Error('page crashed')
    }
    expect(await service.pageReport(acc)).toMatchObject({ title: '', alerts: [], screenshot: null })
  })

  it('tells the core when the site refuses a request of the page, once, without the query', async () => {
    const { service } = setup()
    const notes: string[] = []
    service.onPageNote = (_id, note) => notes.push(note)
    const acc = account('a')
    await service.openForUser(acc, 'https://www.facebook.com/r.php')
    created.sessions.get('persist:ppd-a')!.emitRequest({ method: 'POST', url: 'https://www.facebook.com/reg/submit/?x=1', statusCode: 400 })
    created.sessions.get('persist:ppd-a')!.emitRequest({ method: 'POST', url: 'https://tracker.example.net/p', statusCode: 500 })
    expect(notes).toEqual(['POST www.facebook.com/reg/submit/ answered 400 (xhr)'])
  })

  it('saves the report to the diagnostics folder and removes it with the account', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ppd-diag-'))
    dirs.push(dir)
    const service = new ElectronBrowserService(new TicketAuthority(new FakeClock()), { diagnosticsDir: dir })
    const acc = account('a')
    await service.openForUser(acc, 'https://www.facebook.com/r.php')
    created.views[0].webContents.results = [reading]
    const report = await service.pageReport(acc)
    expect(report?.savedAs?.startsWith(join(dir, 'a'))).toBe(true)
    expect((await readdir(join(dir, 'a'))).sort()).toHaveLength(2)
    await service.forgetAccount(acc)
    expect(await readdir(dir)).toEqual([])
  })
})

describe('page steps of the browser agent (DEC-017): real input first, a script only as the fallback', () => {
  const hosts = ['facebook.com']
  /** Opens a Facebook page, then carries out one step; `results` are the answers of the page's scripts, in order. */
  const step = async (service: ElectronBrowserService, results: unknown[], page: Parameters<Parameters<ReturnType<ElectronBrowserService['session']>['withAgentControl']>[1]>[0] extends infer P ? (p: P) => Promise<unknown> : never) => {
    const session = service.session(account('a'))
    return session.withAgentControl('step', async (raw) => {
      await raw.goto('https://www.facebook.com/r.php')
      agentContents().results = results
      return page(raw)
    })
  }

  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout'] }))
  afterEach(() => vi.useRealTimers())
  const settled = async <T>(pending: Promise<T>): Promise<T> => {
    await vi.advanceTimersByTimeAsync(2_000)
    return pending
  }

  it('clicks with a real mouse click at the centre of the element', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: true, x: 120, y: 340, hit: true, tag: 'button' }, { ok: true }, { ok: true }], (page) => page.pageStep({ do: 'click', ref: 'e3' }, hosts))
    await expect(settled(done)).resolves.toEqual({ status: 'done', detail: 'Clicked e3 with a mouse click.' })
    expect(agentContents().inputEvents.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
    expect(agentContents().inputEvents[1]).toMatchObject({ x: 120, y: 340, button: 'left', clickCount: 1 })
  })

  it('clicks by script when the real click did not reach the tab (it is not drawn), and says so', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: true, x: 120, y: 340, hit: true }, { ok: true }, { ok: false }, { ok: true }], (page) => page.pageStep({ do: 'click', ref: 'e5' }, hosts))
    const result = (await settled(done)) as { status: string; detail: string }
    expect(result.status).toBe('done')
    expect(result.detail).toMatch(/by script \(a real click does not reach a tab that is not drawn/)
    expect(agentContents().inputEvents.map((e) => e.type)).toEqual(['mouseMove', 'mouseDown', 'mouseUp'])
    expect(agentContents().scripts.some((s) => s.includes("'pointerdown'"))).toBe(true)
  })

  it('clicks by script when something covers the element, and says so', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: true, x: 1, y: 1, hit: false }, { ok: true }], (page) => page.pageStep({ do: 'click', ref: 'e3' }, hosts))
    const result = (await settled(done)) as { status: string; detail: string }
    expect(result.status).toBe('done')
    expect(result.detail).toMatch(/by script/)
    expect(agentContents().inputEvents).toEqual([])
  })

  it('refuses a disabled button without clicking', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: true, x: 1, y: 1, hit: true, disabled: true }], (page) => page.pageStep({ do: 'click', ref: 'e3' }, hosts))
    await expect(settled(done)).resolves.toEqual({ status: 'refused', detail: 'e3 is disabled.' })
    expect(agentContents().inputEvents).toEqual([])
  })

  it('types with real input: the field is focused and selected first, then the text is inserted, then it is checked', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: true, x: 5, y: 5, hit: true }, { ok: true }, { ok: true }], (page) => page.pageStep({ do: 'type', ref: 'e1', text: 'Natal' }, hosts))
    await expect(settled(done)).resolves.toEqual({ status: 'done', detail: 'Typed into e1.' })
    expect(agentContents().inserted).toEqual(['Natal'])
    expect(agentContents().focused).toBeGreaterThan(0)
    expect(agentContents().scripts.some((s) => s.includes('el.select()'))).toBe(true)
  })

  it('falls back to a script when the typed text did not land, and says so', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: true, x: 5, y: 5, hit: true }, { ok: true }, { ok: false }, { ok: true }], (page) => page.pageStep({ do: 'type', ref: 'e1', text: 'Natal' }, hosts))
    const result = (await settled(done)) as { status: string; detail: string }
    expect(result).toMatchObject({ status: 'done' })
    expect(result.detail).toMatch(/by script \(real typing did not take\)/)
  })

  it('does not put a password anywhere in its answer, and never in an error', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: true, x: 5, y: 5, hit: true }, { ok: true }, { ok: false }, { ok: false, reason: 'disabled' }], (page) => page.pageStep({ do: 'type', ref: 'e2', text: 'S3cret-Pa$$w0rd!' }, hosts))
    const result = await settled(done)
    expect(JSON.stringify(result)).not.toContain('S3cret')
    expect(result).toMatchObject({ status: 'refused' })
  })

  it('chooses an option of a plain list', async () => {
    const { service } = setup()
    const chosen = step(service, [{ ok: true, x: 5, y: 5, hit: true }, { ok: true }], (page) => page.pageStep({ do: 'select', ref: 'e4', text: 'March' }, hosts))
    await expect(settled(chosen)).resolves.toEqual({ status: 'done', detail: 'Chose an option in e4.' })
  })

  const located = { ok: true, x: 5, y: 5, hit: true }
  const notAList = { ok: false, reason: 'not_a_list' }

  it('opens a drop-down that is not a plain list, finds the option with that text and clicks it', async () => {
    const { service } = setup()
    // locate the drop-down, "not a list", click it (the click arrives), find the option, locate it, click it (arrives).
    const done = step(service, [located, notAList, { ok: true }, { ok: true }, { ok: true, ref: 'e41' }, located, { ok: true }, { ok: true }], (page) => page.pageStep({ do: 'select', ref: 'e5', text: 'March' }, hosts))
    await expect(settled(done)).resolves.toEqual({ status: 'done', detail: 'Chose an option in e5.' })
    expect(agentContents().inputEvents.filter((e) => e.type === 'mouseDown')).toHaveLength(2)
    expect(agentContents().scripts.some((s) => s.includes('aria-controls') && s.includes('"March"'))).toBe(true)
  })

  it('clicks the drop-down and its option by script when real clicks do not reach the tab', async () => {
    const { service } = setup()
    const done = step(service, [located, notAList, { ok: true }, { ok: false }, { ok: true }, { ok: true, ref: 'e41' }, located, { ok: true }, { ok: false }, { ok: true }], (page) => page.pageStep({ do: 'select', ref: 'e5', text: 'March' }, hosts))
    await expect(settled(done)).resolves.toEqual({ status: 'done', detail: 'Chose an option in e5.' })
  })

  it('says what a drop-down offers when it has no option like that, and when it showed none', async () => {
    const { service } = setup()
    const missing = step(service, [located, notAList, { ok: true }, { ok: true }, { ok: false, reason: 'no_such_option', options: ['January', 'February'] }], (page) => page.pageStep({ do: 'select', ref: 'e5', text: 'Smarch' }, hosts))
    expect(await settled(missing)).toMatchObject({ status: 'refused', detail: 'e5 has no option like that. It offers: January, February.' })
  })

  it('says so when a drop-down showed no options after it was opened', async () => {
    const { service } = setup()
    const none = step(service, [located, notAList, { ok: true }, { ok: true }, { ok: false, reason: 'no_options' }], (page) => page.pageStep({ do: 'select', ref: 'e5', text: 'March' }, hosts))
    expect(await settled(none)).toMatchObject({ status: 'refused', detail: 'e5 showed no options after it was opened.' })
  })

  it('presses keys with real key events', async () => {
    const { service } = setup()
    const done = step(service, [], (page) => page.pageStep({ do: 'key', key: 'Enter' }, hosts))
    await expect(settled(done)).resolves.toEqual({ status: 'done', detail: 'Pressed Enter.' })
    expect(agentContents().inputEvents.map((e) => `${e.type}:${e.keyCode}`)).toEqual(['keyDown:Enter', 'char:\r', 'keyUp:Enter'])
  })

  it('says "not_found" when the element is gone', async () => {
    const { service } = setup()
    const done = step(service, [{ ok: false, reason: 'not_found' }], (page) => page.pageStep({ do: 'click', ref: 'e9' }, hosts))
    expect(await settled(done)).toMatchObject({ status: 'not_found' })
  })

  it('does nothing on a page outside the hosts of the task', async () => {
    const { service } = setup()
    const session = service.session(account('a'))
    const result = await session.withAgentControl('step', async (raw) => {
      await raw.goto('https://evil.example.net/login')
      return raw.pageStep({ do: 'click', ref: 'e1' }, hosts)
    })
    expect(result).toMatchObject({ status: 'wrong_host', detail: expect.stringContaining('evil.example.net') })
    expect(agentContents().scripts).toEqual([])
    expect(agentContents().inputEvents).toEqual([])
  })
})
