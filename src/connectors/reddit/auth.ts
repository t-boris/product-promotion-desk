// Tells "the session cannot read this" (signed out, CAPTCHA wall) apart from every other reason a read can fail,
// so the caller gets an error it can recognise (LoginRequiredError / CaptchaRequiredError) instead of a generic one.

import type { BrowserPage } from '../../core/ports'
import { CaptchaRequiredError, LoginRequiredError } from '../errors'
import { gateProbeScript, type GateProbe } from '../page-scripts'
import type { RedditApi } from './api'

export const CAPTCHA_HINT = 'Reddit asks for a human check. Complete it in the account browser, then try again.'

/** True when the currently loaded document is a CAPTCHA or human-check wall. Read-only. */
export async function captchaShown(page: BrowserPage): Promise<boolean> {
  return (await page.read<GateProbe>(gateProbeScript())).captcha
}

/**
 * The error for a read Reddit refused. Only access refusals (401/403) can be caused by the session, so only they
 * cost extra page reads: a CAPTCHA wall is checked first (it also makes the identity call fail), then whether the
 * account is signed in at all. Anything else stays a plain error with the original reason.
 */
export async function refusalError(page: BrowserPage, api: RedditApi, refusal: { status: number }, message: string): Promise<Error> {
  if (refusal.status !== 401 && refusal.status !== 403) return new Error(message)
  if (await captchaShown(page)) return new CaptchaRequiredError(`${CAPTCHA_HINT} (${message})`)
  if ((await api.me()) === null) return new LoginRequiredError(`the account is not signed in to Reddit (${message}).`)
  return new Error(message)
}
