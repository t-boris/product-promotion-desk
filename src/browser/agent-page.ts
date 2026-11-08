// The agent's page: raw operations on a WebContents. Authorization and the hand-over to the user are enforced by
// ControlledSession (src/core/browser-session.ts); this class only performs the page operations.

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { WebContents } from 'electron'
import type { RawPage } from '../core/browser-session'
import type { SignInForm, SignInStatus } from '../core/ports'
import { pollUntil, withTimeout } from './poll'
import { clickScript, describeFailure, existsScript, fileInputScript, fillScript, signInScript, type ActionResult } from './page-scripts'
import { isAbortedNavigation, normalizeBrowserUrl } from './targets'

const DEFAULT_LOAD_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 250
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** The agent's page and whatever hosts it; `dispose` releases both. */
export interface AgentSurface {
  contents: WebContents
  dispose(): void
}

export class ElectronRawPage implements RawPage {
  private surface: AgentSurface | null = null

  /** `create` builds the hidden page; it is called again if the previous one was destroyed or crashed. */
  constructor(private readonly create: () => AgentSurface) {}

  private live(): WebContents {
    if (!this.surface || this.surface.contents.isDestroyed()) {
      this.surface?.dispose()
      this.surface = this.create()
    }
    return this.surface.contents
  }

  /** URL currently loaded, without creating a page. Used to offer the same address to the user. */
  currentUrl(): string | null {
    const contents = this.surface?.contents
    return contents && !contents.isDestroyed() ? contents.getURL() || null : null
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

  async waitForSelector(selector: string, timeoutMs = 10_000): Promise<boolean> {
    return pollUntil(
      async () => {
        try {
          return (await this.read<boolean>(existsScript(selector))) === true
        } catch (error) {
          // The page may be navigating; an invalid selector is a bug and must surface.
          if (error instanceof Error && /not a valid selector|SyntaxError/i.test(error.message)) throw error
          return false
        }
      },
      { timeoutMs, intervalMs: POLL_INTERVAL_MS }
    )
  }

  async fill(selector: string, text: string): Promise<void> {
    const result = await this.read<ActionResult | null>(fillScript(selector, text))
    if (!result?.ok) throw describeFailure('fill', selector, result)
  }

  async click(selector: string): Promise<void> {
    const result = await this.read<ActionResult | null>(clickScript(selector))
    if (!result?.ok) throw describeFailure('click', selector, result)
  }

  /**
   * Fills the sign-in form (DEC-014). The script carries the password, so an error is never passed on with the script's own
   * text: whatever goes wrong is reported in words that cannot contain the credentials.
   */
  async signIn(form: SignInForm): Promise<{ status: SignInStatus }> {
    let result: { status?: SignInStatus } | null
    try {
      result = await this.read<{ status?: SignInStatus } | null>(signInScript(form))
    } catch {
      throw new Error('The sign-in page did not answer.')
    }
    const status = result?.status
    if (status !== 'submitted' && status !== 'next_step' && status !== 'no_form' && status !== 'captcha' && status !== 'wrong_host') throw new Error('The sign-in page gave no usable answer.')
    return { status }
  }

  /** Sets the files of an <input type=file> through the DevTools protocol (a script cannot do this). */
  async uploadFile(selector: string, path: string): Promise<void> {
    if (!isAbsolute(path)) throw new Error('Only absolute file paths can be uploaded')
    const info = await stat(path)
    if (!info.isFile()) throw new Error('The upload path is not a file')
    if (info.size > MAX_UPLOAD_BYTES) throw new Error('The file is too large to upload')

    const debuggerApi = this.live().debugger
    const attachedHere = !debuggerApi.isAttached()
    if (attachedHere) debuggerApi.attach('1.3')
    try {
      const evaluated = (await debuggerApi.sendCommand('Runtime.evaluate', { expression: fileInputScript(selector), returnByValue: false })) as {
        result?: { objectId?: string }
      }
      const objectId = evaluated.result?.objectId
      if (!objectId) throw new Error(`Could not upload: no file input matches "${selector}".`)
      await debuggerApi.sendCommand('DOM.setFileInputFiles', { files: [path], objectId })
    } finally {
      if (attachedHere && debuggerApi.isAttached()) debuggerApi.detach()
    }
  }
}
