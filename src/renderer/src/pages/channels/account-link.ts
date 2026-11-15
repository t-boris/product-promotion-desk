// Accounts that sign in through another account (DEC-027): Threads signs in through its Instagram account. Pure rules, so they are
// tested without the interface.

import type { Account } from '../../../../shared/types'
import { ACCOUNT_STATUS_LABEL } from '../../status-labels'

/**
 * The accounts a login of a platform that signs in with `signsInWith` may sign in through: the accounts of that platform, without those
 * of another profile than the login's own (an account without a profile suits any).
 */
export function eligibleVia(accounts: Account[], signsInWith: string, profileId: string | null): Account[] {
  return accounts.filter((a) => a.platform === signsInWith && (profileId === null || a.profileId === null || a.profileId === profileId))
}

/** "Brand on Instagram · Signed in": an account as the owner picks it from a list. */
export function viaOption(account: Account): string {
  return `${account.label} · ${ACCOUNT_STATUS_LABEL[account.status]}`
}

const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/**
 * Why an account of a platform that signs in through another cannot be added yet, or null. `chosen` is the id of the account picked in the
 * list (empty when none). `candidates` are the accounts that could be chosen.
 */
export function viaBlocker(platformLabel: string, wantedLabel: string, candidates: Account[], chosen: string): string | null {
  if (candidates.length === 0) return `${platformLabel} signs in with ${article(wantedLabel)} ${wantedLabel} account. Add the ${wantedLabel} account first.`
  if (!candidates.some((a) => a.id === chosen)) return `Choose the ${wantedLabel} account ${platformLabel} signs in through.`
  return null
}

/**
 * The account preselected in a list of candidates: the one the owner chose if it is still a candidate, else the only candidate, else none.
 * Several candidates are never guessed between.
 */
export function chosenVia(candidates: Account[], chosen: string): string {
  if (candidates.some((a) => a.id === chosen)) return chosen
  return candidates.length === 1 ? (candidates[0]?.id ?? '') : ''
}

/**
 * What a list line says about how an account is reached: its e-mail address, or, for a login of a platform that signs in through another
 * account (`linkedPlatform`), that account. It has no address to ask for.
 */
export function contactLine(account: Account, linkedPlatform: boolean): string {
  if (account.signsInVia) return 'signs in through another account'
  if (linkedPlatform) return 'no account to sign in through yet'
  return account.email ?? 'no e-mail address yet'
}
