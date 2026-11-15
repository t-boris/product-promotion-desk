import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TakeoverError } from '../core/ports'
import type { Account } from '../shared/types'
import { ChromeBrowserService, consoleLevel, requestKind } from './chrome-browser-service'
import { fakeBrowser, fakePage, loseBrowser, type FakeBrowser, type FakePage } from './chrome-fakes'
import { profileDirFor } from './chrome-launcher'
import type { Browser, Page } from 'puppeteer-core'

const account = (id: string, partition = `persist:ppd-${id}`): Account => ({ id, platform: 'facebook', label: id, identity: null, partition, status: 'login_required', createdAt: '2026-01-01T00:00:00.000Z', productId: null, role: null, loginName: null, email: null, mailboxId: null, profileId: null }) as Account

let dataDir: string
let launches: Array<{ executable: string; args: string[]; browser: FakeBrowser & Browser }>
let chrome: string | null

function make(options: { diagnostics?: boolean } = {}) {
  const events: string[] = []
  const notes: string[] = []
  const service = new ChromeBrowserService(
    { assertValid: () => undefined },
    {
      dataDir,
      diagnosticsDir: options.diagnostics ? join(dataDir, 'diagnostics') : undefined,
      find: () => chrome,
      launch: async (executable, args) => {
        const browser = fakeBrowser()
        launches.push({ executable, args, browser })
        return browser
      },
      env: {}
    }
  )
  service.onUserWindowChange = (id, change) => void events.push(`${id}:${change}`)
  service.onPageNote = (id, note) => void notes.push(`${id}:${note}`)
  return { service, events, notes }
}

const pageOf = (index = 0): FakePage & Page => launches[index].browser.pageList[0]

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'ppd-chrome-service-'))
  launches = []
  chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
})
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('words for the recorder', () => {
  it('names a request by what it is', () => {
    expect(requestKind('document', true)).toBe('mainFrame')
    expect(requestKind('document', false)).toBe('subFrame')
    expect(requestKind('fetch', true)).toBe('xhr')
    expect(requestKind('xhr', false)).toBe('xhr')
    expect(requestKind('image', true)).toBe('image')
  })
  it('names a console level the way the recorder knows it', () => {
    expect(consoleLevel('warn')).toBe('warning')
    expect(consoleLevel('error')).toBe('error')
  })
})

describe('ChromeBrowserService', () => {
  it('gives one session to an account, however often it is asked, and another to another account', () => {
    const { service } = make()
    expect(service.session(account('a'))).toBe(service.session(account('a')))
    expect(service.session(account('a'))).not.toBe(service.session(account('b')))
  })

  it('says so, and starts nothing, when Chrome is not on the Mac', async () => {
    chrome = null
    const { service } = make()
    await expect(service.session(account('a')).withAgentControl('t', async (page) => page.url())).rejects.toThrow('Google Chrome was not found')
    expect(launches).toEqual([])
  })

  it('starts Chrome on first use, with a profile folder of its own inside the data folder, and reuses it', async () => {
    const { service } = make()
    const fb = account('a')
    await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
    await service.session(fb).withAgentControl('t', async (page) => page.url())
    expect(launches).toHaveLength(1)
    expect(launches[0].executable).toBe(chrome)
    expect(launches[0].args).toContain(`--user-data-dir=${profileDirFor(dataDir, fb.partition)}`)
    expect(existsSync(join(dataDir, 'chrome-profiles'))).toBe(true)
    expect(launches[0].browser.newPages).toBe(0)
  })

  it('starts a Chrome for each account, never two on one profile', async () => {
    const { service } = make()
    await Promise.all([service.session(account('a')).withAgentControl('t', async (p) => p.url()), service.session(account('b')).withAgentControl('t', async (p) => p.url())])
    expect(launches).toHaveLength(2)
    expect(new Set(launches.map((launch) => launch.args.find((arg) => arg.startsWith('--user-data-dir='))))).toHaveProperty('size', 2)
  })

  it('opens the window minimised when the AI works and nobody asked to see it, and shows it when asked', async () => {
    const { service } = make()
    const fb = account('a')
    await service.session(fb).withAgentControl('t', async (page) => page.url())
    expect(pageOf().windowState).toBe('normal') // no one asked to hide it: the window of a fresh Chrome is left as Chrome made it
    service.showAgentBrowser(fb, false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pageOf().windowState).toBe('normal')
    expect(pageOf().fronted).toBe(0)
    service.showAgentBrowser(fb, true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pageOf().fronted).toBe(1)
  })

  describe('the owner takes the browser', () => {
    it('stops the AI at once, says so once, and shows the window in front', async () => {
      const { service, events } = make()
      const fb = account('a')
      const opened = await service.openForUser(fb, 'https://www.facebook.com/r.php')
      expect(opened).toEqual({ tabId: 'account-a' })
      expect(events).toEqual(['a:opened'])
      expect(service.hasUserWindow(fb)).toBe(true)
      expect(service.session(fb).control().holder).toBe('user')
      expect(pageOf().fronted).toBeGreaterThan(0)
      await expect(service.session(fb).withAgentControl('t', async () => 'ran')).rejects.toBeInstanceOf(TakeoverError)
      await service.openForUser(fb)
      expect(events).toEqual(['a:opened'])
    })

    it('opens the page asked for, and keeps the one that is open when none is asked for', async () => {
      const { service } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/r.php')
      expect(pageOf().address).toBe('https://www.facebook.com/r.php')
      await service.openForUser(fb)
      expect(pageOf().gotos).toHaveLength(1)
    })

    it('returns control when the owner is done, once, and lets the AI work again', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/')
      service.closeUserWindow(fb)
      service.closeUserWindow(fb)
      expect(events).toEqual(['a:opened', 'a:closed'])
      expect(service.hasUserWindow(fb)).toBe(false)
      expect(service.session(fb).control().holder).toBe('none')
      await expect(service.session(fb).withAgentControl('t', async (page) => page.url())).resolves.toBe('https://www.facebook.com/')
      expect(service.showUserWindow(fb)).toBe(false)
    })

    it('treats closing the window as being done', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/')
      await pageOf().close()
      expect(events).toEqual(['a:opened', 'a:closed'])
      expect(service.session(fb).control().holder).toBe('none')
    })

    it('treats the owner quitting Chrome as being done, and starts a new Chrome for the next use', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/')
      loseBrowser(launches[0].browser)
      expect(events).toEqual(['a:opened', 'a:closed'])
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      expect(launches).toHaveLength(2)
      expect(launches[1].args).toEqual(launches[0].args)
    })

    it('hands control back, and says why, when the window cannot be shown', async () => {
      const { service, events } = make()
      chrome = null
      await expect(service.openForUser(account('a'), 'https://www.facebook.com/')).rejects.toThrow('Google Chrome was not found')
      expect(service.session(account('a')).control().holder).toBe('none')
      expect(events).toEqual([])
    })

    it('does not fail to open because the page is slow: the owner sees it in the window', async () => {
      const { service, notes } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.url())
      pageOf().gotoError = new Error('Navigation timeout of 30000 ms exceeded')
      await expect(service.openForUser(fb, 'https://www.facebook.com/')).resolves.toEqual({ tabId: 'account-a' })
      expect(notes.some((note) => note.includes('could not load the page'))).toBe(true)
    })
  })

  describe('the page report', () => {
    it('is null while no page is open, and never starts Chrome', async () => {
      const { service } = make()
      expect(await service.pageReport(account('a'))).toBeNull()
      expect(launches).toEqual([])
    })

    it('says what the page shows and did, without a query string, and whose window it is', async () => {
      const { service } = make({ diagnostics: true })
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/r.php?token=secret'))
      const page = pageOf()
      page.answers.push(['page-reading', { title: 'Sign up', text: 'Create a new account', alerts: ['An error occurred during your registration.'] }], ['window.innerWidth', [1280, 900]])
      page.emit('response', { request: () => ({ method: () => 'POST', resourceType: () => 'xhr', frame: () => 'main-frame' }), url: () => 'https://www.facebook.com/reg/submit/?token=secret', status: () => 400 })
      page.emit('requestfailed', { method: () => 'GET', resourceType: () => 'document', frame: () => 'main-frame', url: () => 'https://www.facebook.com/x', failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET' }) })
      page.emit('console', { type: () => 'error', text: () => 'Uncaught TypeError at https://www.facebook.com/' })
      const report = await service.pageReport(fb)
      expect(report).toMatchObject({ where: 'app_page', address: 'www.facebook.com/r.php', title: 'Sign up', alerts: ['An error occurred during your registration.'] })
      expect(JSON.stringify(report)).not.toContain('secret')
      expect(report?.requests.map((request) => request.target)).toContain('www.facebook.com/reg/submit/')
      expect(report?.consoleErrors).toHaveLength(1)
      expect(report?.screenshot?.startsWith('data:image/png;base64,')).toBe(true)
      expect(report?.savedAs).not.toBeNull()
      expect(page.shots.length).toBeGreaterThan(0)

      await service.openForUser(fb)
      expect((await service.pageReport(fb))?.where).toBe('owner_window')
    })

    it('keeps the report when the picture cannot be taken', async () => {
      const { service } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      pageOf().screenshot = async () => {
        throw new Error('no picture')
      }
      const report = await service.pageReport(fb)
      expect(report).not.toBeNull()
      expect(report?.screenshot).toBeNull()
    })
  })

  describe('forgetAccount', () => {
    it('closes its Chrome, removes its profile folder, and leaves everything else', async () => {
      const { service } = make({ diagnostics: true })
      const fb = account('a')
      const other = account('b')
      await service.session(fb).withAgentControl('t', async (page) => page.url())
      await service.session(other).withAgentControl('t', async (page) => page.url())
      const profile = profileDirFor(dataDir, fb.partition)
      const otherProfile = profileDirFor(dataDir, other.partition)
      await mkdir(profile, { recursive: true })
      await mkdir(otherProfile, { recursive: true })
      await writeFile(join(profile, 'Cookies'), 'x')
      await writeFile(join(dataDir, 'ppd.sqlite'), 'db')
      await service.forgetAccount(fb)
      expect(launches[0].browser.closeCalls).toBe(1)
      expect(existsSync(profile)).toBe(false)
      expect(existsSync(otherProfile)).toBe(true)
      expect(existsSync(join(dataDir, 'ppd.sqlite'))).toBe(true)
      expect(launches[1].browser.closeCalls).toBe(0)
      expect(await readdir(join(dataDir, 'chrome-profiles'))).toHaveLength(1)
    })

    it('stops the AI on the account before it is erased', async () => {
      const { service } = make()
      const fb = account('a')
      const session = service.session(fb)
      await service.forgetAccount(fb)
      expect(session.control().holder).toBe('user')
    })

    it('is harmless for an account that never had a page', async () => {
      const { service } = make()
      await expect(service.forgetAccount(account('never'))).resolves.toBeUndefined()
    })

    it('refuses to erase anything for a partition that does not name a profile folder', async () => {
      const { service } = make()
      await writeFile(join(dataDir, 'ppd.sqlite'), 'db')
      await expect(service.forgetAccount(account('x', 'persist:'))).rejects.toThrow('Invalid browser profile name')
      expect(existsSync(join(dataDir, 'ppd.sqlite'))).toBe(true)
    })
  })

  it('makes a page when only the page was closed, in the Chrome that is running', async () => {
    const { service } = make()
    const fb = account('a')
    await service.session(fb).withAgentControl('t', async (page) => page.url())
    await pageOf().close()
    await service.session(fb).withAgentControl('t', async (page) => page.url())
    expect(launches).toHaveLength(1)
    expect(launches[0].browser.newPages).toBe(1)
  })

  it('uses the first page Chrome opened, instead of leaving an empty tab behind', async () => {
    const { service } = make()
    const page = fakePage('about:blank')
    const fb = account('a')
    await service.session(fb).withAgentControl('t', async (p) => p.url())
    expect(launches[0].browser.pageList[0]).not.toBe(page)
    expect(launches[0].browser.pageList).toHaveLength(1)
  })
})
