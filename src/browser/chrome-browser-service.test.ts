import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Account } from '../shared/types'
import { ChromeBrowserService, chooseOwnerPage, consoleLevel, OWNER_TAB_PROBE, requestKind } from './chrome-browser-service'
import { fakeBrowser, fakePage, loseBrowser, navigate, pageAppears, request, type FakeBrowser, type FakePage } from './chrome-fakes'
import { profileDirFor } from './chrome-launcher'
import type { Browser, Page } from 'puppeteer-core'

const account = (id: string, partition = `persist:ppd-${id}`): Account => ({ id, platform: 'facebook', browser: 'chrome', access: 'browser', signsInVia: null, label: id, identity: null, partition, status: 'login_required', createdAt: '2026-01-01T00:00:00.000Z', productId: null, role: null, loginName: null, email: null, mailboxId: null, profileId: null }) as Account

let dataDir: string
let launches: Array<{ executable: string; args: string[]; browser: FakeBrowser & Browser }>
let chrome: string | null

function make(options: { diagnostics?: boolean; launchGate?: Promise<void> } = {}) {
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
        await options.launchGate
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
    // The first call used the page Chrome started with and closed it; the second call opened a window of its own, and closed it too.
    expect(launches[0].browser.newPages).toBe(1)
    expect(launches[0].browser.pageList.every((page) => page.closed)).toBe(true)
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
    const task = service.session(fb).task('t')
    await task.withAgentControl(async (page) => page.url())
    expect(pageOf().windowState).toBe('normal') // no one asked to hide it: the window of a fresh Chrome is left as Chrome made it
    service.showAgentBrowser(fb, false)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pageOf().windowState).toBe('normal')
    expect(pageOf().fronted).toBe(0)
    service.showAgentBrowser(fb, true)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pageOf().fronted).toBe(1)
    await task.close()
    expect(pageOf().closed).toBe(true) // the window goes with the task
  })

  it('gives every call a page of its own and closes it when the call ends', async () => {
    const { service } = make()
    const fb = account('a')
    const seen: string[] = []
    await service.session(fb).withAgentControl('monitor:one', async (page) => {
      await page.goto('https://www.facebook.com/groups/one/')
      seen.push(await page.url())
    })
    await service.session(fb).withAgentControl('monitor:two', async (page) => {
      seen.push(await page.url()) // a fresh page: it is not on the first channel's address
      await page.goto('https://www.facebook.com/groups/two/')
      seen.push(await page.url())
    })
    expect(seen).toEqual(['https://www.facebook.com/groups/one/', 'about:blank', 'https://www.facebook.com/groups/two/'])
    expect(launches[0].browser.pageList.every((page) => page.closed)).toBe(true)
  })

  describe('the owner\'s windows (DEC-038)', () => {
    it('opens a window of its own for the owner, in front, without stopping the AI or taking anything from it, and says so once', async () => {
      const { service, events } = make()
      const fb = account('a')
      const task = service.session(fb).task('t')
      await task.withAgentControl(async (page) => page.goto('https://www.facebook.com/'))
      const agentPage = pageOf()
      const opened = await service.openForUser(fb, 'https://www.facebook.com/r.php')
      expect(opened).toEqual({ tabId: 'account-a' })
      expect(events).toEqual(['a:opened'])
      expect(service.hasUserWindow(fb)).toBe(true)
      expect(service.session(fb).control()).toEqual({ holder: 'none', owner: null })
      const [ownerPage] = launches[0].browser.pageList.filter((page) => page !== agentPage)
      expect(ownerPage.address).toBe('https://www.facebook.com/r.php')
      expect(ownerPage.fronted).toBeGreaterThan(0)
      expect(launches[0].browser.newPageOptions).toEqual([{ type: 'window' }])
      // The AI keeps working in its own page, which was not touched.
      expect(agentPage.address).toBe('https://www.facebook.com/')
      await expect(task.withAgentControl(async (page) => page.url())).resolves.toBe('https://www.facebook.com/')
      await task.close()
    })

    it('does not interrupt a turn of the AI in progress when the owner opens a window, and the AI page is never the owner\'s', async () => {
      const { service } = make()
      const fb = account('a')
      const turn = service.session(fb).withAgentControl('mission', async (page) => {
        await page.goto('https://www.facebook.com/groups/1/')
        await service.openForUser(fb, 'https://www.facebook.com/groups/discover/')
        await page.goto('https://www.facebook.com/groups/1/about')
        return page.url()
      })
      await expect(turn).resolves.toBe('https://www.facebook.com/groups/1/about')
      const owners = launches[0].browser.pageList.filter((page) => page.address === 'https://www.facebook.com/groups/discover/')
      expect(owners).toHaveLength(1)
      expect(owners[0].gotos.map((goto) => goto.url)).toEqual(['https://www.facebook.com/groups/discover/'])
    })

    it('gives the AI a window of its own, behind the owner\'s, when the owner opened the first page; it never takes the owner\'s', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/r.php')
      expect(events).toEqual(['a:opened'])
      const ownerPage = pageOf()
      expect(ownerPage.address).toBe('https://www.facebook.com/r.php') // Chrome\'s first page is the owner\'s: nothing blank is left behind
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/groups/1/'))
      expect(launches[0].browser.newPageOptions).toEqual([{ type: 'window', background: true }])
      expect(ownerPage.address).toBe('https://www.facebook.com/r.php')
      expect(ownerPage.gotos).toHaveLength(1)
    })

    it('brings a window that already shows the address to the front instead of opening another, and opens one more for another address', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/r.php')
      const first = pageOf()
      first.fronted = 0
      await service.openForUser(fb, 'https://www.facebook.com/r.php')
      expect(first.fronted).toBe(1)
      expect(launches[0].browser.pageList).toHaveLength(1)
      await service.openForUser(fb, 'https://www.facebook.com/groups/discover/')
      expect(launches[0].browser.pageList).toHaveLength(2)
      expect(events).toEqual(['a:opened']) // the second window is not a second "opened"
    })

    it('says "closed" when the last window of the owner\'s is gone, however it went, and not before', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/r.php')
      await service.openForUser(fb, 'https://www.facebook.com/groups/discover/')
      const [one, two] = launches[0].browser.pageList
      await one.close()
      expect(events).toEqual(['a:opened'])
      expect(service.hasUserWindow(fb)).toBe(true)
      await two.close()
      expect(events).toEqual(['a:opened', 'a:closed'])
      expect(service.hasUserWindow(fb)).toBe(false)
      expect(service.showUserWindow(fb)).toBe(false)
    })

    it('closes every window of the owner\'s for the app, once, and leaves the AI\'s page alone', async () => {
      const { service, events } = make()
      const fb = account('a')
      const task = service.session(fb).task('t')
      await task.withAgentControl(async (page) => page.goto('https://www.facebook.com/'))
      const agentPage = pageOf()
      await service.openForUser(fb, 'https://www.facebook.com/a')
      await service.openForUser(fb, 'https://www.facebook.com/b')
      service.closeUserWindow(fb)
      service.closeUserWindow(fb)
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(events).toEqual(['a:opened', 'a:closed'])
      expect(agentPage.closed).toBe(false)
      await expect(task.withAgentControl(async (page) => page.url())).resolves.toBe('https://www.facebook.com/')
      await task.close()
    })

    it('treats the owner closing the AI\'s own window as nothing for them: the AI opens a new page, the owner\'s windows stay, and nothing is announced', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      await service.openForUser(fb, 'https://www.facebook.com/r.php')
      const agentPage = launches[0].browser.pageList.find((page) => page.address === 'https://www.facebook.com/') as FakePage & Page
      await agentPage.close()
      expect(events).toEqual(['a:opened'])
      expect(service.hasUserWindow(fb)).toBe(true)
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/again'))
      expect(launches[0].browser.newPageOptions.at(-1)).toEqual({ type: 'window', background: true })
    })

    it('treats the owner quitting Chrome as their windows being gone, and starts a new Chrome for the next use', async () => {
      const { service, events } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/')
      loseBrowser(launches[0].browser)
      expect(events).toEqual(['a:opened', 'a:closed'])
      expect(service.hasUserWindow(fb)).toBe(false)
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      expect(launches).toHaveLength(2)
      expect(launches[1].args).toEqual(launches[0].args)
    })

    it('says why, and announces nothing, when no window can be opened', async () => {
      const { service, events } = make()
      chrome = null
      await expect(service.openForUser(account('a'), 'https://www.facebook.com/')).rejects.toThrow('Google Chrome was not found')
      expect(service.session(account('a')).control().holder).toBe('none')
      expect(service.hasUserWindow(account('a'))).toBe(false)
      expect(events).toEqual([])
    })

    it('does not fail to open because the page is slow: the owner sees it in the window', async () => {
      const { service, notes } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.url())
      await expect(service.openForUser(fb, 'https://www.facebook.com/')).resolves.toEqual({ tabId: 'account-a' })
      expect(notes).toEqual([])
      launches[0].browser.nextGotoError = new Error('Navigation timeout of 30000 ms exceeded')
      await expect(service.openForUser(fb, 'https://www.facebook.com/slow')).resolves.toEqual({ tabId: 'account-a' })
      expect(notes.some((note) => note.includes('could not load the page'))).toBe(true)
    })

    it('starts Chrome once when the AI and the owner need it together', async () => {
      let open!: () => void
      const launchGate = new Promise<void>((resolve) => (open = resolve))
      const { service } = make({ launchGate })
      const fb = account('a')
      const turn = service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      const opening = service.openForUser(fb, 'https://www.facebook.com/r.php')
      for (let waited = 0; launches.length === 0 && waited < 100; waited += 1) await new Promise((resolve) => setTimeout(resolve, 2))
      open()
      await Promise.all([turn, opening])
      expect(launches).toHaveLength(1)
      // Chrome\'s first page went to one of them, and the other has a window of its own.
      expect(launches[0].browser.pageList).toHaveLength(2)
    })
  })

  describe('whose page is whose (DEC-038)', () => {
    it('adopts a tab the owner opened themselves as theirs, and a pop-up of the AI\'s page as the AI\'s', async () => {
      const { service, events } = make()
      const fb = account('a')
      const task = service.session(fb).task('t')
      await task.withAgentControl(async (page) => page.goto('https://www.facebook.com/'))
      const agentPage = pageOf()
      expect(service.hasUserWindow(fb)).toBe(false)
      const popup = pageAppears(launches[0].browser, agentPage, 'https://www.facebook.com/dialog/oauth')
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(service.hasUserWindow(fb)).toBe(false) // the AI\'s own pop-up is not the owner\'s
      // The browser may announce the new page before the page says it was a pop-up: its opener tells whose it is.
      const late = pageAppears(launches[0].browser, agentPage, 'https://www.facebook.com/dialog/oauth/late', { announced: false })
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(service.hasUserWindow(fb)).toBe(false)
      navigate(late, 'https://www.facebook.com/logout')
      expect(service.session(fb).identityEpoch()).toBe(0) // and what the AI\'s pop-up does is not the owner\'s doing
      pageAppears(launches[0].browser, null, 'https://news.example/')
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(service.hasUserWindow(fb)).toBe(true)
      expect(events).not.toContain('a:opened') // a tab the owner opened by hand is theirs; "opened" is for the window the app opened for them
      popup.address = 'https://www.facebook.com/dialog/oauth2'
      await task.close()
    })

    it('never drives a page it did not create: the AI\'s turn reads its own page, whatever the owner has open', async () => {
      const { service } = make()
      const fb = account('a')
      const task = service.session(fb).task('t')
      await task.withAgentControl(async (page) => page.goto('https://www.facebook.com/groups/1/'))
      await service.openForUser(fb, 'https://www.facebook.com/')
      pageAppears(launches[0].browser, null, 'https://news.example/')
      await new Promise((resolve) => setTimeout(resolve, 5))
      await expect(task.withAgentControl(async (page) => page.url())).resolves.toBe('https://www.facebook.com/groups/1/')
      const owners = launches[0].browser.pageList.filter((page) => page.address !== 'https://www.facebook.com/groups/1/')
      for (const owner of owners) expect(owner.input).toEqual([])
      expect(owners.every((owner) => owner.scripts.length === 0)).toBe(true)
      await task.close()
    })
  })

  describe('a sign-in or sign-out page used in an owner\'s window moves the session (DEC-038)', () => {
    async function withOwnerWindow() {
      const made = make()
      const fb = account('a')
      await made.service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      await made.service.openForUser(fb, 'https://www.facebook.com/groups/discover/')
      const agentPage = pageOf()
      const ownerPage = launches[0].browser.pageList.find((page) => page !== agentPage) as FakePage & Page
      return { ...made, fb, agentPage, ownerPage, session: made.service.session(fb) }
    }

    it('counts a navigation of an owner page to a sign-out, sign-in or account-switch address', async () => {
      const { session, ownerPage } = await withOwnerWindow()
      const before = session.identityEpoch()
      navigate(ownerPage, 'https://www.facebook.com/groups/1/')
      expect(session.identityEpoch()).toBe(before)
      navigate(ownerPage, 'https://www.facebook.com/logout.php?h=1')
      expect(session.identityEpoch()).toBe(before + 1)
      navigate(ownerPage, 'https://www.facebook.com/login/')
      expect(session.identityEpoch()).toBe(before + 2)
    })

    it('counts a background request of an owner page to such an address (a sign-out that is a fetch), and not an image or a script', async () => {
      const { session, ownerPage } = await withOwnerWindow()
      const before = session.identityEpoch()
      request(ownerPage, 'https://www.facebook.com/logout', 'image') // an <img> whose address is a sign-out page is not a sign-out
      request(ownerPage, 'https://www.facebook.com/logout', 'script')
      request(ownerPage, 'https://www.facebook.com/api/feed', 'fetch')
      expect(session.identityEpoch()).toBe(before)
      request(ownerPage, 'https://www.facebook.com/api/accounts/logout/', 'fetch')
      expect(session.identityEpoch()).toBe(before + 1)
    })

    it('counts the address the owner asked for the moment the window is asked to open on it, before the page has loaded', async () => {
      const { service, session, fb } = await withOwnerWindow()
      const before = session.identityEpoch()
      await service.openForUser(fb, 'https://www.facebook.com/login/')
      expect(session.identityEpoch()).toBe(before + 1)
    })

    it('counts a page that was already on such an address when it was adopted', async () => {
      const { session, service, fb } = await withOwnerWindow()
      const before = session.identityEpoch()
      pageAppears(launches[0].browser, null, 'https://www.facebook.com/logout')
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(service.hasUserWindow(fb)).toBe(true)
      expect(session.identityEpoch()).toBe(before + 1)
    })

    it('does not count what the AI\'s own page does: it may sign in and out as its missions say', async () => {
      const { service, fb, session, agentPage } = await withOwnerWindow()
      const before = session.identityEpoch()
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/login/'))
      navigate(agentPage, 'https://www.facebook.com/logout')
      request(agentPage, 'https://www.facebook.com/api/accounts/logout/')
      expect(session.identityEpoch()).toBe(before)
    })

    it('counts a pop-up of an owner page, and a tab the owner opened by hand, the same way', async () => {
      const { session, ownerPage } = await withOwnerWindow()
      const before = session.identityEpoch()
      const popup = pageAppears(launches[0].browser, ownerPage, 'https://www.facebook.com/')
      navigate(popup, 'https://accounts.google.com/o/oauth2/v2/auth')
      expect(session.identityEpoch()).toBe(before + 1)
      const tab = pageAppears(launches[0].browser, null, 'https://www.facebook.com/')
      await new Promise((resolve) => setTimeout(resolve, 5))
      navigate(tab, 'https://www.facebook.com/logout')
      expect(session.identityEpoch()).toBe(before + 2)
    })

    it('a mission that checked the sign-in before the owner\'s window used a sign-out page sees that its check is out of date', async () => {
      const { session, ownerPage } = await withOwnerWindow()
      const checkedAt = session.identityEpoch()
      navigate(ownerPage, 'https://www.facebook.com/logout')
      expect(session.identityEpoch()).not.toBe(checkedAt)
    })

    it('a write of the AI\'s turn in progress is refused once the owner\'s window used such a page, and nothing reaches the AI\'s page', async () => {
      const { service, fb, ownerPage, agentPage } = await withOwnerWindow()
      const ticket = { actionId: 'a', contentHash: 'h', accountId: 'a', destination: 'd', signature: 's', expiresAt: 0 } as never
      const turn = service.session(fb).withAgentControl('mission', async (page) => {
        navigate(ownerPage, 'https://www.facebook.com/logout')
        await page.click('#post', ticket)
      })
      await expect(turn).rejects.toMatchObject({ name: 'SessionChangedError' })
      expect(agentPage.input).toEqual([])
    })
  })

  describe('the page of the owner (DEC-028, DEC-038)', () => {
    it('is known only while the owner has a window open: its address and the title Chrome records, no script run in the page', async () => {
      const { service } = make()
      const fb = account('a')
      expect(await service.ownerPage(fb)).toBeNull()
      expect(launches).toEqual([]) // asking never starts Chrome
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/groups/discover/'))
      expect(await service.ownerPage(fb)).toBeNull() // the page of the app is not the owner's
      await service.openForUser(fb, 'https://www.facebook.com/groups/discover/')
      const page = launches[0].browser.pageList[1]
      page.tabTitle = 'Discover groups'
      page.address = 'https://www.facebook.com/groups/yourgroup/?ref=x'
      const scriptsBefore = page.scripts.length
      expect(await service.ownerPage(fb)).toEqual({ url: 'https://www.facebook.com/groups/yourgroup/?ref=x', title: 'Discover groups' })
      expect(page.scripts.length).toBe(scriptsBefore)
      expect(page.sessionsClosed).toBe(page.sessionsOpened) // the DevTools session used for the title is closed again
      service.closeUserWindow(fb)
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(await service.ownerPage(fb)).toBeNull()
    })

    it('with several pages open asks each, once, whether it is showing and has the focus, and answers with the one that is', async () => {
      const { service } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      await service.openForUser(fb, 'https://www.facebook.com/groups/one/')
      await service.openForUser(fb, 'https://www.facebook.com/groups/two/')
      const [, one, two] = launches[0].browser.pageList
      one.answers.push(['document.visibilityState', { visible: false, focused: false }])
      two.answers.push(['document.visibilityState', { visible: true, focused: false }])
      one.tabTitle = 'One'
      two.tabTitle = 'Two'
      expect(await service.ownerPage(fb)).toEqual({ url: 'https://www.facebook.com/groups/two/', title: 'Two' })
      expect(one.scripts).toEqual([OWNER_TAB_PROBE])
      expect(two.scripts).toEqual([OWNER_TAB_PROBE])
    })

    it('says how many pages there are, and gives no address, when the browser cannot tell which one the owner is on', async () => {
      const { service } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      await service.openForUser(fb, 'https://www.facebook.com/groups/one/')
      await service.openForUser(fb, 'https://www.facebook.com/groups/two/')
      const [, one, two] = launches[0].browser.pageList
      one.answers.push(['document.visibilityState', { visible: true, focused: false }])
      two.answers.push(['document.visibilityState', { visible: true, focused: false }])
      expect(await service.ownerPage(fb)).toEqual({ url: '', title: '', tabs: 2 })
    })

    it('says how many pages there are when a page cannot be asked', async () => {
      const { service } = make()
      const fb = account('a')
      await service.openForUser(fb, 'https://www.facebook.com/groups/one/')
      await service.openForUser(fb, 'https://www.facebook.com/groups/two/')
      const [one, two] = launches[0].browser.pageList
      one.answers.push(['document.visibilityState', new Error('gone')])
      two.answers.push(['document.visibilityState', { visible: true, focused: true }])
      expect(await service.ownerPage(fb)).toMatchObject({ url: 'https://www.facebook.com/groups/two/' })
      two.answers.length = 0
      two.answers.push(['document.visibilityState', new Error('gone')])
      expect(await service.ownerPage(fb)).toEqual({ url: '', title: '', tabs: 2 })
    })

    it('finds a tab the owner opened by hand, even when it appeared while the app was creating a page of its own', async () => {
      const { service } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.goto('https://www.facebook.com/'))
      launches[0].browser.pageList.push(fakePage('https://news.example/')) // appeared without a "target created" the service could use
      expect((await service.ownerPage(fb))?.url).toBe('https://news.example/')
    })
  })

  describe('which page of several is the owner\'s (pure)', () => {
    const seen = (...answers: Array<[boolean, boolean]>) => answers.map(([visible, focused], index) => ({ page: `p${index}`, visible, focused }))
    it('is the one that is showing, when only one is', () => {
      expect(chooseOwnerPage(seen([false, false], [true, false], [false, false]))).toBe('p1')
    })
    it('is the one that has the keyboard focus, when several are showing', () => {
      expect(chooseOwnerPage(seen([true, false], [true, true]))).toBe('p1')
    })
    it('is nobody when several are showing and none or several have the focus, or none is showing', () => {
      expect(chooseOwnerPage(seen([true, false], [true, false]))).toBeNull()
      expect(chooseOwnerPage(seen([true, true], [true, true]))).toBeNull()
      expect(chooseOwnerPage(seen([false, false], [false, false]))).toBeNull()
    })
  })

  describe('what is written about a page that did not load', () => {
    it('keeps the host and the path of an address in the message, not its query or fragment', async () => {
      const { service, notes } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.url())
      launches[0].browser.nextGotoError = new Error('net::ERR_NAME_NOT_RESOLVED at https://www.facebook.com/groups/yours?token=SECRET#frag')
      await service.openForUser(fb, 'https://www.facebook.com/groups/yours?token=SECRET')
      const note = notes.find((line) => line.includes('could not load the page')) ?? ''
      expect(note).toContain('www.facebook.com/groups/yours')
      expect(note).not.toContain('SECRET')
      expect(note).not.toContain('frag')
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
      const task = service.session(fb).task('t')
      await task.withAgentControl(async (page) => page.goto('https://www.facebook.com/r.php?token=secret'))
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

      await service.openForUser(fb, 'https://www.facebook.com/groups/discover/')
      const owner = launches[0].browser.pageList[1]
      owner.answers.push(['page-reading', { title: 'Discover', text: 'Groups', alerts: [] }])
      expect(await service.pageReport(fb)).toMatchObject({ where: 'owner_window', title: 'Discover' })
      await task.close()
    })

    it('keeps the report when the picture cannot be taken', async () => {
      const { service } = make()
      const fb = account('a')
      const task = service.session(fb).task('t')
      await task.withAgentControl(async (page) => page.goto('https://www.facebook.com/'))
      pageOf().screenshot = async () => {
        throw new Error('no picture')
      }
      const report = await service.pageReport(fb)
      expect(report).not.toBeNull()
      expect(report?.screenshot).toBeNull()
      await task.close()
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

  describe('releaseAccount and chromeFound', () => {
    it('closes the Chrome of the account and keeps its profile folder, then starts a new Chrome on the next use', async () => {
      const { service } = make()
      const fb = account('a')
      await service.session(fb).withAgentControl('t', async (page) => page.url())
      const profile = profileDirFor(dataDir, fb.partition)
      await mkdir(profile, { recursive: true })
      await writeFile(join(profile, 'Cookies'), 'x')
      await service.releaseAccount(fb)
      expect(launches[0].browser.closeCalls).toBe(1)
      expect(existsSync(join(profile, 'Cookies'))).toBe(true)
      await service.session(fb).withAgentControl('t', async (page) => page.url())
      expect(launches).toHaveLength(2)
    })

    it('never starts Chrome again for a session that was kept from before the account was let go of', async () => {
      const { service } = make()
      const fb = account('a')
      const kept = service.session(fb)
      await kept.withAgentControl('t', async (page) => page.url())
      await service.releaseAccount(fb)
      await expect(kept.withAgentControl('t', async (page) => page.url())).rejects.toThrow('was changed')
      expect(launches).toHaveLength(1)
      // the account in its new life (back in Chrome later) gets a session of its own
      await service.session(fb).withAgentControl('t', async (page) => page.url())
      expect(launches).toHaveLength(2)
    })

    it('closes a Chrome that was still starting when the account was let go of, and the page that wanted it fails', async () => {
      let open!: () => void
      const launchGate = new Promise<void>((resolve) => (open = resolve))
      const { service } = make({ launchGate })
      const fb = account('a')
      const pending = service.session(fb).withAgentControl('t', async (page) => page.url()).then(() => 'opened', (error: Error) => error.message)
      // Wait for the launch itself, not for a fixed moment: how many turns of the loop it takes to start is not what is under test.
      for (let waited = 0; launches.length === 0 && waited < 200; waited += 1) await new Promise((resolve) => setTimeout(resolve, 5))
      expect(launches).toHaveLength(1)
      const releasing = service.releaseAccount(fb)
      open()
      await releasing
      expect(await pending).toContain('was changed')
      expect(launches[0].browser.closeCalls).toBe(1)
      expect(launches[0].browser.connected).toBe(false)
    })

    it('does nothing for an account that was never used', async () => {
      const { service } = make()
      await expect(service.releaseAccount(account('never'))).resolves.toBeUndefined()
      expect(launches).toEqual([])
    })

    it('says whether Chrome is installed', () => {
      const { service } = make()
      expect(service.chromeFound()).toBe(true)
      chrome = null
      expect(service.chromeFound()).toBe(false)
    })
  })

  it('makes a page of its own, in a window behind the owner\'s, when only the page was closed, in the Chrome that is running', async () => {
    const { service } = make()
    const fb = account('a')
    await service.session(fb).withAgentControl('t', async (page) => page.url())
    await pageOf().close()
    await service.session(fb).withAgentControl('t', async (page) => page.url())
    expect(launches).toHaveLength(1)
    expect(launches[0].browser.newPages).toBe(1)
    expect(launches[0].browser.newPageOptions).toEqual([{ type: 'window', background: true }])
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
