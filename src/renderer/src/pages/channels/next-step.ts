// What an account still needs, in the order the owner does things. Pure, so it is tested without the interface.

import type { Account } from '../../../../shared/types'

/** The first thing still missing on an account, in the order the owner does things (address, password, sign-in). */
export interface NextStep {
  /** The block of the account card to work on; null when the account is ready. */
  block: 'email' | 'password' | 'signin' | null
  text: string
}

export function nextStep(account: Account, hasPassword: boolean, vaultAvailable: boolean): NextStep {
  if (!account.email) return { block: 'email', text: 'Next: give this account an e-mail address (step 3). Type one, or let the app propose one from your base mailbox.' }
  if (vaultAvailable && !hasPassword) return { block: 'password', text: 'Next: save its password (step 4). Generate a strong one, or type the one you already use on the site.' }
  if (account.status === 'captcha') return { block: 'signin', text: 'Next: solve the check the site is asking for, in the account’s browser (step 5).' }
  if (account.status !== 'ready') return { block: 'signin', text: 'Next: sign in on the site (step 5). If the account does not exist there yet, create it on the platform.' }
  return { block: null, text: 'All set. This account is signed in and ready to use.' }
}
