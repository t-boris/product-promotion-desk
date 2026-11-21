// The agent's page in the owner's installed Chrome (DEC-025): the same raw operations as the built-in page (agent-page.ts), on a puppeteer page.
// Authorization and the hand-over to the owner are enforced by ControlledSession (src/core/browser-session.ts); this class only performs
// the page operations. Scripts are run through a DevTools session of their own, never through puppeteer's evaluate, because that marks a
// script as a user's gesture and a read must never look like one to the page.

import type { CDPSession, Page } from 'puppeteer-core'
import type { PageStep, PageStepResult } from '../core/ports'
import { fileInputScript } from './page-scripts'
import { pollUntil, withTimeout } from './poll'
import { ScriptedPage } from './script-page'
import { holdMs, pacing, putFile, runPageStep, type StepDriver } from './step-runner'
import { isAbortedNavigation, normalizeBrowserUrl } from './targets'

const DEFAULT_LOAD_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 45_000
/** After a navigation was superseded (a redirect), how long the page that took over may take to finish loading. */
const SETTLE_AFTER_ABORT_MS = 10_000

/** The agent's page and whatever hosts it (the Chrome of one account); `dispose` releases the page, and the Chrome when it is the last. */
export interface ChromeHandle {
  page: Page
  /** A DevTools session on the page: scripts run through it. */
  cdp: CDPSession
  /** False once the page was closed or Chrome went away. */
  isAlive(): boolean
  dispose(): Promise<void>
  /** Shows the window of the page, un-minimised; `focus` also puts it in front of the owner's windows (the owner has to act in it). */
  showWindow(focus: boolean): Promise<void>
  /**
   * Un-minimises the window when the owner minimised it, without putting it in front. A page in a minimised window is hidden to the site and
   * Chrome drops its keyboard input, so the AI cannot work in it.
   */
  ensureShown(): Promise<void>
}

interface RuntimeResult {
  result: { value?: unknown }
  exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } }
}

export class ChromeRawPage extends ScriptedPage {
  private handle: ChromeHandle | null = null
  private creating: Promise<ChromeHandle> | null = null

  /**
   * `create` opens the page (starting Chrome when it is not running); it is called again if the page was closed or Chrome went away. `onDispose`
   * is told when the page is let go of for good, so whoever tracks it can forget it.
   */
  constructor(
    private readonly create: () => Promise<ChromeHandle>,
    private readonly onDispose?: () => void
  ) {
    super()
  }

  private async live(): Promise<ChromeHandle> {
    if (this.handle?.isAlive()) return this.handle
    // Two callers that arrive while the page is being opened share the one opening: a second Chrome on the same profile would hand over
    // to the first and exit.
    this.creating ??= (async () => {
      const old = this.handle
      this.handle = null
      await old?.dispose().catch(() => undefined)
      const fresh = await this.create()
      this.handle = fresh
      return fresh
    })().finally(() => {
      this.creating = null
    })
    return this.creating
  }

  /** Shows the window of the page (opening the page if there is none yet). */
  async reveal(focus: boolean): Promise<void> {
    await (await this.live()).showWindow(focus)
  }

  /** URL currently loaded, without opening a page. Used to offer the same address to the owner. */
  currentUrl(): string | null {
    const url = this.handle?.isAlive() ? this.handle.page.url() : ''
    return url && url !== 'about:blank' ? url : null
  }

  /** The page when it exists, without opening one: for looking at the page, never for acting on it. */
  existing(): ChromeHandle | null {
    return this.handle?.isAlive() ? this.handle : null
  }

  async dispose(): Promise<void> {
    // A page that is being opened right now would otherwise be opened after this and live on: wait for it, then let go of whatever there is.
    await this.creating?.catch(() => undefined)
    const handle = this.handle
    this.handle = null
    this.onDispose?.()
    await handle?.dispose().catch(() => undefined)
  }

  async goto(url: string, options?: { timeoutMs?: number }): Promise<void> {
    const target = normalizeBrowserUrl(url)
    const { page, cdp } = await this.live()
    const timeoutMs = options?.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    try {
      await page.goto(target, { timeout: timeoutMs, waitUntil: 'load' })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        await cdp.send('Page.stopLoading').catch(() => undefined)
        throw new Error(`Timed out loading ${new URL(target).host}`, { cause: error })
      }
      // A redirect can reject the original navigation although the final page loaded fine.
      if (isAbortedNavigation(error) && page.url() !== '' && page.url() !== 'about:blank') {
        const done = await pollUntil(async () => (await this.evaluate(cdp, 'document.readyState').catch(() => 'loading')) === 'complete', { timeoutMs: SETTLE_AFTER_ABORT_MS, intervalMs: 250 })
        if (done) return
      }
      throw error
    }
  }

  async url(): Promise<string> {
    return (await this.live()).page.url()
  }

  async read<T>(script: string): Promise<T> {
    const { cdp } = await this.live()
    return withTimeout(this.evaluate(cdp, script) as Promise<T>, READ_TIMEOUT_MS, 'The page did not answer in time')
  }

  /** A script as the page's own code, not as a user's gesture (userGesture=false). A thrown error is rethrown with the page's description. */
  private async evaluate(cdp: CDPSession, expression: string): Promise<unknown> {
    const reply = (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false })) as RuntimeResult
    if (reply.exceptionDetails) {
      const details = reply.exceptionDetails
      throw new Error(details.exception?.description ?? (typeof details.exception?.value === 'string' ? details.exception.value : undefined) ?? details.text ?? 'The page script failed')
    }
    return reply.result.value
  }

  /**
   * One step of the browser agent (DEC-017): the logic is in step-runner.ts, shared with every other back end; this page only says how
   * a mouse press, a key, text and a file reach a Chrome page. All of it is Chrome's own input (trusted events).
   */
  async pageStep(step: PageStep, hosts: string[], alive?: () => void): Promise<PageStepResult> {
    return runPageStep(this.driver(await this.live()), step, hosts, alive)
  }

  private driver(handle: ChromeHandle): StepDriver {
    const { page } = handle
    return {
      currentUrl: () => page.url(),
      read: (script) => this.read(script),
      // The page's own scripts focus the element they work on, and Chrome's input reaches a page whose window is behind others: nothing is
      // pushed in front of the owner's windows (that is `reveal`, asked for on purpose). Only a minimised window is brought back: there the
      // page is hidden to the site and takes no keys.
      focus: () => handle.ensureShown(),
      pressKey: (key) => page.keyboard.press(key),
      mouseMove: async (x, y) => page.mouse.move(x, y),
      mouseClick: async (x, y) => {
        // The press is at the point just read, whatever the pointer did since (the Electron driver presses at the point it is given).
        await page.mouse.move(x, y)
        await page.mouse.down()
        await pacing.sleep(holdMs())
        await page.mouse.up()
      },
      wheel: async (x, y, dy) => {
        await page.mouse.move(x, y)
        await page.mouse.wheel({ deltaY: dy })
      },
      insertText: (text) => page.keyboard.sendCharacter(text),
      attachFile: async (expression, paths, what) => {
        const found = await page.evaluateHandle(expression)
        try {
          const element = found.asElement()
          if (!element) throw new Error(`Could not upload: no file input matches "${what}".`)
          await (element as unknown as { uploadFile(...paths: string[]): Promise<void> }).uploadFile(...paths)
        } finally {
          await found.dispose().catch(() => undefined)
        }
      }
    }
  }

  /** Sets the files of an <input type=file> through the DevTools protocol (a script cannot do this). */
  async uploadFile(selector: string, path: string): Promise<void> {
    await putFile(this.driver(await this.live()), fileInputScript(selector), path, selector)
  }
}
