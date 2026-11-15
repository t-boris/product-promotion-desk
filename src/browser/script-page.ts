// What every back end of the agent's page does the same way: it reads the page with scripts, and everything that fills, clicks or signs in
// is a script read. A back end says how a script runs (`read`), how a page is opened and which address it is on, how a file reaches an
// input and how a step's real input arrives; the rest, including the rule that a password is never sent twice, is here once.

import type { RawPage } from '../core/browser-session'
import type { PageStep, PageStepResult, SignInForm, SignInStatus } from '../core/ports'
import { pollUntil } from './poll'
import { clickScript, describeFailure, existsScript, fillScript, signInScript, type ActionResult } from './page-scripts'

const POLL_INTERVAL_MS = 250
/** A sign-in page may draw its form after it has "loaded" (Reddit builds it from web components, a few seconds in). */
const SIGN_IN_FORM_WAIT_MS = 15_000
const SIGN_IN_FORM_POLL_MS = 500

export abstract class ScriptedPage implements RawPage {
  abstract goto(url: string, options?: { timeoutMs?: number }): Promise<void>
  abstract url(): Promise<string>
  abstract read<T>(script: string): Promise<T>
  abstract uploadFile(selector: string, path: string): Promise<void>
  abstract pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult>

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
}
