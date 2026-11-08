// Errors that tell the caller WHY a connector could not work, so the flow worker can react to them
// (ask the person to sign in, ask them to solve a CAPTCHA) instead of showing a generic failure.
//
// They are recognised by `name` as well as by `instanceof`, because an error may cross a module or a serialization
// boundary. Their messages start with a fixed prefix, so a `failed` publish outcome (which carries only text) can
// be classified with `authIssueOf` as well.

export const LOGIN_REQUIRED_PREFIX = 'Sign-in required: '
export const CAPTCHA_REQUIRED_PREFIX = 'CAPTCHA required: '

/** The account is not signed in on the site (or the site shows a login wall). Nothing was changed on the site. */
export class LoginRequiredError extends Error {
  constructor(detail: string) {
    super(`${LOGIN_REQUIRED_PREFIX}${detail}`)
    this.name = 'LoginRequiredError'
  }
}

/** The site asks for a CAPTCHA or a human check that only the person can complete. Nothing was changed on the site. */
export class CaptchaRequiredError extends Error {
  constructor(detail: string) {
    super(`${CAPTCHA_REQUIRED_PREFIX}${detail}`)
    this.name = 'CaptchaRequiredError'
  }
}

export type AuthIssue = 'login' | 'captcha'

/** Classifies an error, or the error text of a failed publish outcome. `null` when it is neither issue. */
export function authIssueOf(subject: unknown): AuthIssue | null {
  if (subject instanceof LoginRequiredError) return 'login'
  if (subject instanceof CaptchaRequiredError) return 'captcha'
  const name = subject instanceof Error ? subject.name : ''
  if (name === 'LoginRequiredError') return 'login'
  if (name === 'CaptchaRequiredError') return 'captcha'
  const text = subject instanceof Error ? subject.message : typeof subject === 'string' ? subject : ''
  if (text.startsWith(LOGIN_REQUIRED_PREFIX)) return 'login'
  if (text.startsWith(CAPTCHA_REQUIRED_PREFIX)) return 'captcha'
  return null
}
