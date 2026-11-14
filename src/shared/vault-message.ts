// What the owner is told when the password vault cannot be used (BUG-041). One wording for the Password block and for the errors of a
// save, a reveal, a copy and a sign-in, so the screen and the message after a click never disagree. Plain TypeScript: the core and the
// renderer both import it.

import type { VaultUnavailable } from './types'

/** Says what happened and what to do, without blaming the Mac when only the app's access was refused. */
export function vaultUnavailableText(reason: VaultUnavailable): string {
  if (reason === 'refused') {
    return 'macOS did not let the app use its keychain item (it asks again after an update), so saved passwords cannot be opened and new ones cannot be saved. Quit and reopen the app, then choose Always Allow when macOS asks.'
  }
  return 'This system has no usable keychain, so the app cannot keep passwords safely and stores none. Sign in on the site itself.'
}
