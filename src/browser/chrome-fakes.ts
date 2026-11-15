// Stand-ins for a puppeteer Browser and Page, enough for the tests of the Chrome back end: what the code under test touches, nothing more.
// Not part of the application: only the tests import this file.

import { EventEmitter } from 'node:events'
import type { Browser, CDPSession, Page } from 'puppeteer-core'

export interface FakePage extends EventEmitter {
  closed: boolean
  address: string
  /** What the page's scripts answer, by a part of the script text; the first key found in the script wins. */
  answers: Array<[string, unknown]>
  /** What a script was asked, in order. */
  scripts: string[]
  /** Every DevTools command the page was sent. */
  commands: Array<{ method: string; params?: unknown }>
  /** The title Chrome records for the tab (tests set it). */
  tabTitle: string
  /** Window state the fake Chrome reports. */
  windowState: 'normal' | 'minimized'
  /** Input that reached the page, in order. */
  input: string[]
  /** Set to make the next `goto` fail with this error. */
  gotoError: Error | null
  gotos: Array<{ url: string; timeout: number | undefined }>
  fronted: number
  shots: Array<unknown>
  /** The page that opened this one (a pop-up, a link in a new tab), or null for a page nobody opened. */
  openedBy: FakePage | null
  /** The DevTools sessions that were opened and closed again on the page. */
  sessionsOpened: number
  sessionsClosed: number
}

/** A page that behaves as far as the tests need: scripts answer from `answers`, input is recorded. */
export function fakePage(address = 'about:blank'): FakePage & Page {
  const emitter = new EventEmitter() as FakePage
  emitter.closed = false
  emitter.address = address
  emitter.answers = []
  emitter.scripts = []
  emitter.commands = []
  emitter.tabTitle = ''
  emitter.windowState = 'normal'
  emitter.input = []
  emitter.gotoError = null
  emitter.gotos = []
  emitter.fronted = 0
  emitter.shots = []
  emitter.openedBy = null
  emitter.sessionsOpened = 0
  emitter.sessionsClosed = 0

  const frame = { url: () => emitter.address }
  const cdp = {
    detach: async () => void (emitter.sessionsClosed += 1),
    send: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      emitter.commands.push({ method, params })
      if (method === 'Runtime.evaluate') {
        const expression = String(params?.expression ?? '')
        emitter.scripts.push(expression)
        const found = emitter.answers.find(([key]) => expression.includes(key))
        if (found && found[1] instanceof Error) return { result: {}, exceptionDetails: { text: 'failed', exception: { description: found[1].message } } }
        return { result: { value: found ? found[1] : null } }
      }
      if (method === 'Target.getTargetInfo') return { targetInfo: { title: emitter.tabTitle, url: emitter.address } }
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 }
      if (method === 'Browser.getWindowBounds') return { bounds: { windowState: emitter.windowState } }
      if (method === 'Browser.setWindowBounds') {
        emitter.windowState = (params as { bounds: { windowState: 'normal' | 'minimized' } }).bounds.windowState
        return {}
      }
      return {}
    }
  }

  const page = Object.assign(emitter, {
    url: () => emitter.address,
    isClosed: () => emitter.closed,
    mainFrame: () => frame,
    createCDPSession: async () => {
      emitter.sessionsOpened += 1
      return cdp as unknown as CDPSession
    },
    target: () => ({ type: () => 'page', opener: () => (emitter.openedBy ? (emitter.openedBy as unknown as Page).target() : undefined), page: async () => page }),
    goto: async (url: string, options?: { timeout?: number }) => {
      emitter.gotos.push({ url, timeout: options?.timeout })
      if (emitter.gotoError) {
        const error = emitter.gotoError
        emitter.gotoError = null
        throw error
      }
      emitter.address = url
      return null
    },
    bringToFront: async () => void (emitter.fronted += 1),
    close: async () => {
      emitter.closed = true
      emitter.emit('close')
    },
    screenshot: async (options?: unknown) => {
      emitter.shots.push(options)
      return new Uint8Array([137, 80, 78, 71])
    },
    evaluateHandle: async () => ({ asElement: () => ({ uploadFile: async (...paths: string[]) => void emitter.input.push(`file:${paths.join(',')}`) }), dispose: async () => undefined }),
    keyboard: {
      press: async (key: string) => void emitter.input.push(`key:${key}`),
      sendCharacter: async (text: string) => void emitter.input.push(`text:${text}`)
    },
    mouse: {
      move: async (x: number, y: number) => void emitter.input.push(`move:${x},${y}`),
      down: async () => void emitter.input.push('down'),
      up: async () => void emitter.input.push('up'),
      wheel: async (options: { deltaY?: number }) => void emitter.input.push(`wheel:${options.deltaY ?? 0}`)
    }
  })
  return page as unknown as FakePage & Page
}

/** What the page's main frame is, as a `framenavigated` event carries it. */
export const mainFrameOf = (page: FakePage & Page): unknown => page.mainFrame()

/** The owner (or a page) goes to an address in a page: the address changes and the browser says the main frame navigated. */
export function navigate(page: FakePage & Page, address: string): void {
  page.address = address
  page.emit('framenavigated', page.mainFrame())
}

/** A page asks for something in the background. */
export function request(page: FakePage & Page, url: string, resourceType = 'fetch'): void {
  page.emit('request', { url: () => url, method: () => 'POST', resourceType: () => resourceType, frame: () => page.mainFrame() })
}

export interface FakeBrowser extends EventEmitter {
  connected: boolean
  pageList: Array<FakePage & Page>
  newPages: number
  closeCalls: number
  /** What each `newPage` was asked for. */
  newPageOptions: Array<{ type?: string; background?: boolean } | undefined>
  /** The next page made fails its first `goto` with this error (a slow or unreachable site). */
  nextGotoError: Error | null
}

export function fakeBrowser(first: (FakePage & Page) | null = fakePage()): FakeBrowser & Browser {
  const emitter = new EventEmitter() as FakeBrowser
  emitter.connected = true
  emitter.pageList = first ? [first] : []
  emitter.newPages = 0
  emitter.closeCalls = 0
  emitter.newPageOptions = []
  emitter.nextGotoError = null
  return Object.assign(emitter, {
    pages: async () => emitter.pageList.filter((page) => !page.closed),
    newPage: async (options?: { type?: string; background?: boolean }) => {
      const page = fakePage()
      page.gotoError = emitter.nextGotoError
      emitter.nextGotoError = null
      emitter.newPages += 1
      emitter.newPageOptions.push(options)
      emitter.pageList.push(page)
      return page
    },
    close: async () => {
      emitter.closeCalls += 1
      emitter.connected = false
      emitter.emit('disconnected')
    }
  }) as unknown as FakeBrowser & Browser
}

/**
 * A page that Chrome made without the application asking: the owner opened a tab (or a link of one of their pages did), or the AI's page opened
 * a pop-up. The browser says a target was created.
 */
export function pageAppears(browser: FakeBrowser, openedBy: (FakePage & Page) | null = null, address = 'about:blank', options: { announced?: boolean } = {}): FakePage & Page {
  const page = fakePage(address)
  page.openedBy = openedBy
  browser.pageList.push(page)
  browser.emit('targetcreated', page.target())
  // `announced: false`: the opening page does not say it opened this one (it may say so later, or not at all): only the opener of the target tells.
  if (openedBy && options.announced !== false) openedBy.emit('popup', page)
  return page
}

/** The Chrome going away on its own (the owner quit it, or it crashed). */
export function loseBrowser(browser: FakeBrowser): void {
  browser.connected = false
  browser.emit('disconnected')
}
