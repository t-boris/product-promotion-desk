// What an account still needs, in the order the owner does things. Pure, so it is tested without the interface.

import type { Account } from '../../../../shared/types'

/** The first thing still missing on an account, in the order the owner does things (address, password, sign-in; or, for a login that signs in through another account, that account and the sign-in). */
export interface NextStep {
  /** The block of the account card to work on; null when the account is ready. */
  block: 'via' | 'email' | 'password' | 'signin' | 'key' | null
  text: string
}

/** What an account that signs in through another (DEC-027) knows about it: the account (null until one is chosen), its platform's name, and whether its password is saved. */
export interface SignsInThrough {
  account: Account | null
  label: string
  hasPassword: boolean
}

export function nextStep(account: Account, hasPassword: boolean, vaultAvailable: boolean, through?: SignsInThrough): NextStep {
  // A login with no credentials of its own (Threads): the account it signs in through, then the sign-in. It never asks for an address or a password.
  if (through) return nextStepThrough(account, through)
  // An account that works through its platform's API (a bot) has one thing to do: its key.
  if (account.access === 'api') {
    return account.status === 'ready' ? { block: null, text: 'All set. The app works with this account through the platform, with no browser.' } : { block: 'key', text: hasPassword ? 'Next: the platform does not accept the saved key. Save a new one, or check again.' : 'Next: save its key (the steps are below).' }
  }
  if (!account.email) return { block: 'email', text: 'Next: give this account an e-mail address (step 3). Type one, or let the app propose one from your base mailbox.' }
  if (vaultAvailable && !hasPassword) return { block: 'password', text: 'Next: save its password (step 4). Generate a strong one, or type the one you already use on the site.' }
  if (account.status === 'captcha') return { block: 'signin', text: 'Next: solve the check the site is asking for, in the account’s browser (step 5).' }
  if (account.status !== 'ready') return { block: 'signin', text: 'Next: sign in on the site (step 5). If the account does not exist there yet, create it on the platform.' }
  return { block: null, text: 'All set. This account is signed in and ready to use.' }
}

function nextStepThrough(account: Account, through: SignsInThrough): NextStep {
  const via = through.account
  if (!via) return { block: 'via', text: `Next: choose the ${through.label} account this one signs in through (step 3). It has no password of its own.` }
  if (account.status === 'ready') return { block: null, text: 'All set. This account is signed in and ready to use.' }
  if (!(via.loginName ?? via.email) || !through.hasPassword) {
    // The work is on the other account: its button is the one to press, not this account's sign-in.
    return { block: 'via', text: `Next: ${via.label} needs its login (an e-mail address) and a saved password first, because ${account.label} signs in through it. Open ${via.label} (step 3) and finish it, then let the AI sign in here (step 4).` }
  }
  if (account.status === 'captcha') return { block: 'signin', text: 'Next: solve the check the site is asking for, in the account’s browser (step 4).' }
  return { block: 'signin', text: `Next: sign in (step 4). Let the AI sign in through ${via.label}, or sign in yourself in the account’s browser.` }
}

/**
 * What the note under "Add account" says comes next. From the library the owner is led through the account's own steps; from a
 * product's Channels screen the app returns there, and the address, the password and the sign-in wait (the sign-in is needed before the
 * channel is activated, not to connect it or to write a draft by hand).
 */
export function afterCreateNote(product: { name: string | undefined } | null, linked = false, keyName: string | null = null): string {
  // An account that works through its platform's API has one thing to set: its key.
  if (keyName) return `After adding it you paste its ${keyName} on the account's page (Accounts section); the steps are written there. Then connect its channel.`
  // A login that signs in through another account has no address and no password to set.
  if (linked) return product ? `After adding it you go back to the Channels screen of ${product.name ?? 'this product'} to connect a channel with this account. Its sign-in comes later, in the Accounts section: the AI signs in through the account you chose.` : 'After adding it you are told what to do next: let the AI sign in through the account you chose.'
  if (!product) return 'After adding it you are told what to do next: set the address and the password, then create the account on the platform or sign in.'
  return `After adding it you go back to the Channels screen of ${product.name ?? 'this product'} to connect a channel with this account. Its address, password and sign-in come later, in the Accounts section, and are needed before the channel is activated.`
}
