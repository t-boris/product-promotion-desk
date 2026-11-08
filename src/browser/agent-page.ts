// The agent's page: raw operations on a WebContents. Authorization and the hand-over to the user are enforced by
// ControlledSession (src/core/browser-session.ts); this class only performs the page operations.

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { WebContents } from 'electron'
import type { RawPage } from '../core/browser-session'
import type { PageStep, PageStepResult, SignInForm, SignInStatus } from '../core/ports'
import { pollUntil, withTimeout } from './poll'
import { clickScript, describeFailure, existsScript, fileInputScript, fillScript, locateScript, markOptionScript, mouseSeenScript, mouseWatchScript, prepareTypingScript, scriptClickScript, selectOptionScript, setValueScript, signInScript, typedScript, type ActionResult, type LocatedElement } from './page-scripts'
import { isAbortedNavigation, normalizeBrowserUrl } from './targets'

const DEFAULT_LOAD_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 250
/** A sign-in page may draw its form after it has "loaded" (Reddit builds it from web components, a few seconds in). */
const SIGN_IN_FORM_WAIT_MS = 15_000
const SIGN_IN_FORM_POLL_MS = 500
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
   * One step of the browser agent (DEC-017), done the way a person's hands would: a real mouse click at the element's centre and
   * real keystrokes (MarkView's browser does the same), because a site tells a person's input from a script's. A script is the
   * fallback when the tab cannot take real input or the text did not land. Refuses a page outside `hosts`.
   */
  async pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult> {
    const contents = this.live()
    let host = ''
    try {
      host = new URL(contents.getURL()).hostname.toLowerCase()
    } catch {
      // No page yet.
    }
    if (!hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return { status: 'wrong_host', detail: `The page is ${host ? `on ${host}` : 'not loaded'}, which is not a page of this platform, so nothing was done.` }
    }

    if (step.do === 'key') {
      await pressKey(contents, step.key)
      await settle()
      return { status: 'done', detail: `Pressed ${step.key}.` }
    }

    const located = await this.read<LocatedElement>(locateScript(step.ref))
    if (!located.ok) return { status: 'not_found', detail: `There is no element ${step.ref} on the page now: it changed since the snapshot.` }

    if (step.do === 'click') {
      if (located.disabled) return { status: 'refused', detail: `${step.ref} is disabled.` }
      const how = await this.clickElement(contents, step.ref, located)
      return how === null ? { status: 'refused', detail: `${step.ref} could not be clicked.` } : { status: 'done', detail: `Clicked ${step.ref} ${how}.` }
    }

    if (step.do === 'select') {
      const chosen = await this.read<ActionResult>(selectOptionScript(step.ref, step.text))
      await settle()
      if (chosen.ok) return { status: 'done', detail: `Chose an option in ${step.ref}.` }
      if (chosen.reason !== 'not_a_list') return { status: 'refused', detail: chosen.reason === 'no_such_option' ? `${step.ref} has no option like that.` : `${step.ref} cannot be chosen from (${chosen.reason ?? 'unknown'}).` }
      return this.chooseInDropDown(contents, step.ref, step.text, located)
    }

    const prepared = await this.read<ActionResult>(prepareTypingScript(step.ref))
    if (!prepared.ok) return { status: 'refused', detail: prepared.reason === 'disabled' ? `${step.ref} is disabled.` : `${step.ref} does not take text.` }
    contents.focus()
    await contents.insertText(step.text)
    if (!(await this.read<ActionResult>(typedScript(step.ref, step.text))).ok) {
      const fallback = await this.read<ActionResult>(setValueScript(step.ref, step.text))
      if (!fallback.ok) return { status: 'refused', detail: `${step.ref} did not take the text.` }
      await settle()
      return { status: 'done', detail: `Typed into ${step.ref} by script (real typing did not take).` }
    }
    await settle()
    return { status: 'done', detail: `Typed into ${step.ref}.` }
  }

  /**
   * Clicks an element: with the browser's own mouse when the tab takes it, otherwise with the page's own events. The agent's tab is
   * not drawn on screen, and Chromium drops a real mouse press sent to such a tab, so whether it arrived is looked at, not assumed.
   * Returns how it was done, or null when it could not be.
   */
  private async clickElement(contents: WebContents, ref: string, located: LocatedElement): Promise<string | null> {
    if (located.hit && located.x !== undefined && located.y !== undefined) {
      await this.read<ActionResult>(mouseWatchScript())
      contents.focus()
      contents.sendInputEvent({ type: 'mouseMove', x: located.x, y: located.y })
      contents.sendInputEvent({ type: 'mouseDown', x: located.x, y: located.y, button: 'left', clickCount: 1 })
      contents.sendInputEvent({ type: 'mouseUp', x: located.x, y: located.y, button: 'left', clickCount: 1 })
      if ((await this.read<ActionResult>(mouseSeenScript())).ok) {
        await settle()
        return 'with a mouse click'
      }
    }
    const scripted = await this.read<ActionResult>(scriptClickScript(ref))
    await settle()
    return scripted.ok ? 'by script (a real click does not reach a tab that is not drawn, or something covers the element)' : null
  }

  /** A drop-down that is not a plain list (Facebook's birthday lists): open it, click the option with this text, as a person would. */
  private async chooseInDropDown(contents: WebContents, ref: string, text: string, located: LocatedElement): Promise<PageStepResult> {
    if (located.disabled) return { status: 'refused', detail: `${ref} is disabled.` }
    if ((await this.clickElement(contents, ref, located)) === null) return { status: 'refused', detail: `${ref} could not be opened.` }
    const found = await this.read<{ ok: boolean; reason?: string; ref?: string; options?: string[] }>(markOptionScript(ref, text))
    if (!found.ok || !found.ref) {
      const offered = found.options && found.options.length > 0 ? ` It offers: ${found.options.join(', ')}.` : ''
      return { status: 'refused', detail: found.reason === 'no_options' ? `${ref} showed no options after it was opened.` : `${ref} has no option like that.${offered}` }
    }
    const option = await this.read<LocatedElement>(locateScript(found.ref))
    if (!option.ok || (await this.clickElement(contents, found.ref, option)) === null) return { status: 'refused', detail: `The option in ${ref} could not be clicked.` }
    return { status: 'done', detail: `Chose an option in ${ref}.` }
  }

  /**
   * Fills the sign-in form (DEC-014). The script carries the password, so an error is never passed on with the script's own
   * text: whatever goes wrong is reported in words that cannot contain the credentials.
   */
  async signIn(form: SignInForm): Promise<{ status: SignInStatus }> {
    let status: SignInStatus = 'no_form'
    // Only "no form yet" is asked again: nothing was sent then. Any other answer, and any failure of the read, ends it at
    // once, so a password is never sent twice (a second wrong attempt could lock the account).
    await pollUntil(
      async () => {
        status = await this.signInOnce(form)
        return status !== 'no_form'
      },
      { timeoutMs: SIGN_IN_FORM_WAIT_MS, intervalMs: SIGN_IN_FORM_POLL_MS }
    )
    return { status }
  }

  private async signInOnce(form: SignInForm): Promise<SignInStatus> {
    let result: { status?: SignInStatus } | null
    try {
      result = await this.read<{ status?: SignInStatus } | null>(signInScript(form))
    } catch {
      throw new Error('The sign-in page did not answer.')
    }
    const status = result?.status
    if (status !== 'submitted' && status !== 'next_step' && status !== 'no_form' && status !== 'captcha' && status !== 'wrong_host') throw new Error('The sign-in page gave no usable answer.')
    return status
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

const KEYS: Record<'Enter' | 'Tab' | 'Escape', { keyCode: string; char?: string }> = {
  Enter: { keyCode: 'Enter', char: '\r' },
  Tab: { keyCode: 'Tab' },
  Escape: { keyCode: 'Escape' }
}

/** A real key press on the focused element: down, the character when there is one, up. */
async function pressKey(contents: WebContents, key: 'Enter' | 'Tab' | 'Escape'): Promise<void> {
  const spec = KEYS[key]
  contents.focus()
  contents.sendInputEvent({ type: 'keyDown', keyCode: spec.keyCode })
  if (spec.char) contents.sendInputEvent({ type: 'char', keyCode: spec.char })
  contents.sendInputEvent({ type: 'keyUp', keyCode: spec.keyCode })
}

/** The pause after a step, so that the page has reacted before it is looked at again. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 350))
