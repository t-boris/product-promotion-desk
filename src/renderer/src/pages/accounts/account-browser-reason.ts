// What the browser state of an account says to the screens (DEC-026, DEC-038). Why the browser cannot be switched now: the switch signs the account out here and lets go of the old
// browser, windows included. The core refuses it while the AI works on the account, while the owner took control of the AI's page, and
// while a window of the owner's is open (the switch would close it). An open window alone does not stop the AI any more, so it is no
// longer called "in use". Pure, so the words are tested without the interface.

import type { BrowserState } from '../../../../shared/types'

export const REASON_AI_WORKING = 'The AI is working on this account. Change its browser when it is done.'
export const REASON_CONTROL_TAKEN = 'You took control of the AI’s page of this account. Give control back (More), then change the browser.'
export const REASON_WINDOW_OPEN = 'A window of this account’s browser is open, and the change would close it. Close the window, then change the browser.'

/** The one reason the choice is off, or null when it can be made. The first that applies is said; the core checks every one. */
export function browserSwitchReason(aiWorking: boolean, state: Pick<BrowserState, 'holder' | 'windowOpen'> | undefined): string | null {
  if (aiWorking) return REASON_AI_WORKING
  if (state?.holder === 'user') return REASON_CONTROL_TAKEN
  if (state?.windowOpen === true) return REASON_WINDOW_OPEN
  return null
}

export const SIGNIN_CONTROL_TAKEN = 'You took control of the AI’s page of this account, so the app cannot sign in or check it now. Give control back (More).'

/** The sentence the sign-in step shows after an explicit Take control (the only thing that stops the AI's page now), or null when nothing was taken. */
export function signInControlNote(state: Pick<BrowserState, 'holder'> | undefined): string | null {
  return state?.holder === 'user' ? SIGNIN_CONTROL_TAKEN : null
}

export const PROFILE_FILL_SIGN_IN_FIRST = 'Sign this account in first (open it, step 5).'
export const PROFILE_FILL_CONTROL_TAKEN = 'You took control of this account’s browser, so the AI cannot work in it. Give control back (More).'

/**
 * Why "Fill in the profile on the site (AI)" is off, or null when it is on. The AI works through the account's own page: after an explicit
 * Take control (DEC-038) it cannot, which the core would only say after a run was started and refused. `canStart` is the core's own answer
 * (the engine); an unanswered question is no reason.
 */
export function profileFillReason(signedIn: boolean, state: Pick<BrowserState, 'holder'> | undefined, canStart: { ready: boolean; reason?: string | null } | undefined): string | null {
  if (!signedIn) return PROFILE_FILL_SIGN_IN_FIRST
  if (state?.holder === 'user') return PROFILE_FILL_CONTROL_TAKEN
  if (canStart && !canStart.ready) return canStart.reason ?? null
  return null
}

