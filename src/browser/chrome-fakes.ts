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
  /** Window state the fake Chrome reports. */
  windowState: 'normal' | 'minimized'
  /** Input that reached the page, in order. */
  input: string[]
  /** Set to make the next `goto` fail with this error. */
  gotoError: Error | null
  gotos: Array<{ url: string; timeout: number | undefined }>
  fronted: number
  shots: Array<unknown>
}

/** A page that behaves as far as the tests need: scripts answer from `answers`, input is recorded. */
export function fakePage(address = 'about:blank'): FakePage & Page {
  const emitter = new EventEmitter() as FakePage
  emitter.closed = false
  emitter.address = address
  emitter.answers = []
  emitter.scripts = []
  emitter.commands = []
  emitter.windowState = 'normal'
  emitter.input = []
  emitter.gotoError = null
  emitter.gotos = []
  emitter.fronted = 0
  emitter.shots = []

  const cdp = {
    send: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      emitter.commands.push({ method, params })
      if (method === 'Runtime.evaluate') {
        const expression = String(params?.expression ?? '')
        emitter.scripts.push(expression)
        const found = emitter.answers.find(([key]) => expression.includes(key))
        if (found && found[1] instanceof Error) return { result: {}, exceptionDetails: { text: 'failed', exception: { description: found[1].message } } }
        return { result: { value: found ? found[1] : null } }
      }
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
    mainFrame: () => 'main-frame',
    createCDPSession: async () => cdp as unknown as CDPSession,
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
      up: async () => void emitter.input.push('up')
    }
  })
  return page as unknown as FakePage & Page
}

export interface FakeBrowser extends EventEmitter {
  connected: boolean
  pageList: Array<FakePage & Page>
  newPages: number
  closeCalls: number
}

export function fakeBrowser(first: (FakePage & Page) | null = fakePage()): FakeBrowser & Browser {
  const emitter = new EventEmitter() as FakeBrowser
  emitter.connected = true
  emitter.pageList = first ? [first] : []
  emitter.newPages = 0
  emitter.closeCalls = 0
  return Object.assign(emitter, {
    pages: async () => emitter.pageList.filter((page) => !page.closed),
    newPage: async () => {
      const page = fakePage()
      emitter.newPages += 1
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

/** The Chrome going away on its own (the owner quit it, or it crashed). */
export function loseBrowser(browser: FakeBrowser): void {
  browser.connected = false
  browser.emit('disconnected')
}
