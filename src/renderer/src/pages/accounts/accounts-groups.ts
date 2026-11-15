// What the Accounts screen lists and how its selection behaves (DEC-037, phase C5): one list grouped by profile (the person behind a
// login), the accounts of a profile beneath its row, and the logins that belong to no profile under "Other logins". The screen is the
// library of every login, not the current product's. Pure, so the rules are tested from src/main/accounts-logic.test.ts without the interface.

import { profileLine } from '../../../../shared/profile'
import type { Account, PlatformInfo, Profile } from '../../../../shared/types'
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE, platformLabel } from '../channels/model'

// ───────────── Grouping ─────────────

export const OTHER_LOGINS = 'Other logins'

/** One group of the list: a profile with its logins, or the logins that have no profile. */
export interface AccountGroup {
  id: string
  /** The profile, or null for "Other logins". */
  profile: Profile | null
  accounts: Account[]
}

/** A login of a profile is listed by its platform, then by its name, so the order is the same on every load. */
const byPlatformThenName = (a: Account, b: Account): number => a.platform.localeCompare(b.platform) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)

/**
 * The groups in the order of the list: every profile in the order given (a profile with no login is still listed, it is where its logins
 * are made), then "Other logins" when there is any. A login whose profile is not in the list (it was removed) is a login without a profile.
 */
export function groupAccounts(profiles: readonly Profile[], accounts: readonly Account[]): AccountGroup[] {
  const known = new Set(profiles.map((profile) => profile.id))
  const groups: AccountGroup[] = profiles.map((profile) => ({ id: `group:${profile.id}`, profile, accounts: accounts.filter((a) => a.profileId === profile.id).sort(byPlatformThenName) }))
  const loose = accounts.filter((a) => a.profileId === null || !known.has(a.profileId))
  return loose.length > 0 ? [...groups, { id: 'group:other', profile: null, accounts: loose.sort(byPlatformThenName) }] : groups
}

// ───────────── Rows and keys ─────────────

/** A row of the list is a profile or an account; the key says which, so the two kinds of id never meet. */
export const profileKey = (id: string): string => `profile:${id}`
export const accountKey = (id: string): string => `account:${id}`

export type RowRef = { kind: 'profile' | 'account'; id: string }

export function parseKey(key: string | null): RowRef | null {
  if (key === null) return null
  const at = key.indexOf(':')
  const kind = key.slice(0, at)
  const id = key.slice(at + 1)
  return (kind === 'profile' || kind === 'account') && id !== '' ? { kind, id } : null
}

/** The rows as the list shows them, top to bottom: what the arrow keys walk through. "Other logins" is a heading, not a row. */
export function displayOrder(groups: readonly AccountGroup[]): string[] {
  return groups.flatMap((group) => [...(group.profile ? [profileKey(group.profile.id)] : []), ...group.accounts.map((a) => accountKey(a.id))])
}

// ───────────── What a row says ─────────────

export type RowTone = 'good' | 'warn' | 'bad' | ''
/** The colour of a dot: a state that needs the owner or went wrong is amber or red, a good one green, anything else is the plain grey dot. */
export const rowTone = (tone: string): RowTone => (tone === 'good' || tone === 'warn' || tone === 'bad' ? tone : '')

export interface PersonaRow {
  title: string
  /** The person in one line ("Selena Marlowe, 37, Lisbon"), or that there is none yet. */
  line: string
  /** A person proposed and waiting for the owner is a tag; a new or an approved profile is a dot and its word. */
  state: 'new' | 'proposed' | 'approved'
  tone: RowTone
  accounts: string
}

export function personaRow(profile: Profile, accounts: number, now: Date): PersonaRow {
  const hasPerson = profile.displayName !== ''
  const state = !hasPerson ? 'new' : profile.status === 'approved' ? 'approved' : 'proposed'
  return {
    title: profile.label,
    line: hasPerson ? profileLine(profile, now) : 'No person yet',
    state,
    tone: state === 'proposed' ? 'warn' : state === 'approved' ? 'good' : '',
    accounts: accounts === 0 ? 'no accounts' : `${accounts} ${accounts === 1 ? 'account' : 'accounts'}`
  }
}

export interface AccountRow {
  title: string
  /** The platform and the sign-in state: "Reddit · Sign-in needed". */
  line: string
  tone: RowTone
}

export function accountRow(account: Account, platforms: readonly PlatformInfo[]): AccountRow {
  return { title: account.label, line: `${platformLabel(account.platform, [...platforms])} · ${ACCOUNT_STATUS_LABEL[account.status]}`, tone: rowTone(ACCOUNT_STATUS_TONE[account.status]) }
}

// ───────────── The account's tabs ─────────────

/** The tabs of an account in display order: how it signs in, who it speaks as, the browser it works in, and the rare controls. */
export const ACCOUNT_TABS = ['signin', 'role', 'browser', 'more'] as const
export type AccountTab = (typeof ACCOUNT_TABS)[number]

export const ACCOUNT_TAB_LABEL: Record<AccountTab, string> = { signin: 'Sign-in', role: 'Role', browser: 'Browser', more: 'More' }

export const DEFAULT_ACCOUNT_TAB: AccountTab = 'signin'
