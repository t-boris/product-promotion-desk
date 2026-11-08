// Runs the service's own logic against a fake 'electron' module (see fake-electron.ts). It verifies how the
// service uses sessions, windows and control; it cannot prove that Electron behaves as assumed.

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  createdAt: '2026-11-08T00:00:00.000Z'
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
    expect(decodeURIComponent(bar.webContents.loaded[0])).toContain('Give control back to the app')
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
