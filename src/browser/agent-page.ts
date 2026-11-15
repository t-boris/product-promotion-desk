// The agent's page: raw operations on a WebContents. Authorization and the hand-over to the user are enforced by
// ControlledSession (src/core/browser-session.ts); this class only performs the page operations.

import type { WebContents } from 'electron'
import type { PageStep, PageStepResult } from '../core/ports'
import { withTimeout } from './poll'
import { fileInputScript } from './page-scripts'
import { ScriptedPage } from './script-page'
import { putFile, runPageStep, type StepDriver } from './step-runner'
import { isAbortedNavigation, normalizeBrowserUrl } from './targets'

const DEFAULT_LOAD_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 45_000

/** The agent's page and whatever hosts it; `dispose` releases both. */
export interface AgentSurface {
  contents: WebContents
  dispose(): void
  /** Shows the window the page lives in, so the owner watches the AI work in it (DEC-018); `focus` also puts it in front of the owner's windows. */
  reveal?(focus: boolean): void
  /** Hides that window again; the page goes on. */
  conceal?(): void
  isRevealed?(): boolean
}

export class ElectronRawPage extends ScriptedPage {
  private surface: AgentSurface | null = null

  /** `create` builds the hidden page; it is called again if the previous one was destroyed or crashed. */
  constructor(private readonly create: () => AgentSurface) {
    super()
  }

  private live(): WebContents {
    if (!this.surface || this.surface.contents.isDestroyed()) {
      this.surface?.dispose()
      this.surface = this.create()
    }
    return this.surface.contents
  }

  /** Shows the window of the page (creating the page if there is none yet). */
  reveal(focus: boolean): void {
    this.live()
    this.surface?.reveal?.(focus)
  }

  /** Hides the window of the page; true when it was shown. */
  conceal(): boolean {
    const was = this.surface?.isRevealed?.() ?? false
    this.surface?.conceal?.()
    return was
  }

  /** URL currently loaded, without creating a page. Used to offer the same address to the user. */
  currentUrl(): string | null {
    const contents = this.surface?.contents
    return contents && !contents.isDestroyed() ? contents.getURL() || null : null
  }

  /** The page's contents when it exists, without creating one: for looking at the page, never for acting on it. */
  existingContents(): WebContents | null {
    const contents = this.surface?.contents
    return contents && !contents.isDestroyed() ? contents : null
  }

  dispose(): void {
    this.surface?.dispose()
    this.surface = null
  }

  async goto(url: string, options?: { timeoutMs?: number }): Promise<void> {
    const target = normalizeBrowserUrl(url)
    const contents = this.live()
    const timeoutMs = options?.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS
    try {
      await withTimeout(contents.loadURL(target), timeoutMs, `Timed out loading ${new URL(target).host}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Timed out')) contents.stop()
      // A redirect can reject the original navigation although the final page loaded fine.
      else if (isAbortedNavigation(error) && !contents.isDestroyed() && !contents.isLoading() && contents.getURL() !== '') return
      throw error
    }
  }

  async url(): Promise<string> {
    return this.live().getURL()
  }

  async read<T>(script: string): Promise<T> {
    // userGesture=false: reading must never look like a user action to the page.
    return withTimeout(this.live().executeJavaScript(script, false) as Promise<T>, READ_TIMEOUT_MS, 'The page did not answer in time')
  }

  /**
   * One step of the browser agent (DEC-017): the logic is in step-runner.ts, shared with every other back end; this page only says how
   * a mouse press, a key, text and a file reach a WebContents.
   */
  async pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult> {
    return runPageStep(this.driver(this.live()), step, hosts)
  }

  private driver(contents: WebContents): StepDriver {
    return {
      currentUrl: () => contents.getURL(),
      read: (script) => this.read(script),
      focus: async () => contents.focus(),
      pressKey: async (key) => {
        const spec = KEYS[key]
        contents.sendInputEvent({ type: 'keyDown', keyCode: spec.keyCode })
        if (spec.char) contents.sendInputEvent({ type: 'char', keyCode: spec.char })
        contents.sendInputEvent({ type: 'keyUp', keyCode: spec.keyCode })
      },
      mouseClick: async (x, y) => {
        contents.sendInputEvent({ type: 'mouseMove', x, y })
        contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      },
      insertText: (text) => contents.insertText(text).then(() => undefined),
      attachFile: (expression, path, what) => this.attach(contents, expression, path, what)
    }
  }

  /** Sets the files of an <input type=file> through the DevTools protocol (a script cannot do this). */
  async uploadFile(selector: string, path: string): Promise<void> {
    await putFile(this.driver(this.live()), fileInputScript(selector), path, selector)
  }

  private async attach(contents: WebContents, expression: string, path: string, what: string): Promise<void> {
    const debuggerApi = contents.debugger
    const attachedHere = !debuggerApi.isAttached()
    if (attachedHere) debuggerApi.attach('1.3')
    try {
      const evaluated = (await debuggerApi.sendCommand('Runtime.evaluate', { expression, returnByValue: false })) as {
        result?: { objectId?: string }
      }
      const objectId = evaluated.result?.objectId
      if (!objectId) throw new Error(`Could not upload: no file input matches "${what}".`)
      await debuggerApi.sendCommand('DOM.setFileInputFiles', { files: [path], objectId })
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
    }
  }
}

const KEYS: Record<'Enter' | 'Tab' | 'Escape', { keyCode: string; char?: string }> = {
  Enter: { keyCode: 'Enter', char: '\r' },
  Tab: { keyCode: 'Tab' },
  Escape: { keyCode: 'Escape' }
}
