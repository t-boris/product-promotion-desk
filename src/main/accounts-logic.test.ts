// The Accounts screen's rules (the list grouped by profile, its selection and keys, the account's tabs, why the browser cannot be
// switched) live in src/renderer/src/pages/accounts/*; the renderer has no test runner of its own, and these modules import only pure code,
// so they are tested from here (DEC-037, phase C5).

import { describe, expect, it } from 'vitest'
import type { Account, AccountStatus, PlatformInfo, Profile } from '../shared/types'
import {
  ACCOUNT_TABS,
  ACCOUNT_TAB_LABEL,
  DEFAULT_ACCOUNT_TAB,
  OTHER_LOGINS,
  accountKey,
  accountRow,
  displayOrder,
  groupAccounts,
  parseKey,
  personaRow,
  profileKey,
  rowTone
} from '../renderer/src/pages/accounts/accounts-groups'
import { resolveSelection } from '../renderer/src/list-selection'
import { selectionAfterDismiss } from '../renderer/src/pages/inbox/inbox-groups'
import { PROFILE_FILL_CONTROL_TAKEN, PROFILE_FILL_SIGN_IN_FIRST, profileFillReason, REASON_AI_WORKING, REASON_CONTROL_TAKEN, REASON_WINDOW_OPEN, SIGNIN_CONTROL_TAKEN, browserSwitchReason, signInControlNote } from '../renderer/src/pages/accounts/account-browser-reason'

// The row the Accounts screen shows is the shared selection rule with the shared "who takes the place" rule (the screen commits it with `useListSelection`).
const selectedRow = (order: readonly string[], previous: readonly string[], chosen: string | null): string | null => resolveSelection(order, previous, chosen, selectionAfterDismiss)

function account(id: string, seed: { platform?: string; label?: string; profileId?: string | null; status?: AccountStatus } = {}): Account {
  return {
    id,
    platform: seed.platform ?? 'reddit',
    label: seed.label ?? `Login ${id}`,
    identity: null,
    partition: `persist:${id}`,
    status: seed.status ?? 'ready',
    createdAt: '2026-11-01T00:00:00.000Z',
    productId: null,
    role: null,
    loginName: null,
    email: null,
    mailboxId: null,
    profileId: seed.profileId === undefined ? null : seed.profileId,
    browser: 'internal',
    access: 'browser', signsInVia: null
  }
}

function profile(id: string, seed: Partial<Profile> = {}): Profile {
  return {
    id,
    label: `Profile ${id}`,
    productId: null,
    role: null,
    platforms: [],
    purpose: '',
    strategy: '',
    reasons: {},
    hasPicture: false,
    status: 'proposed',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    firstName: '',
    lastName: '',
    displayName: '',
    username: '',
    birthDate: '',
    gender: 'female',
    place: '',
    about: '',
    website: '',
    pictureIdea: '',
    ...seed
  }
}

const platforms = [
  { platform: 'reddit', label: 'Reddit' },
  { platform: 'instagram', label: 'Instagram' }
] as unknown as PlatformInfo[]

describe('the list grouped by profile', () => {
  it('lists every profile in the order given, with its accounts, and the logins without a profile last', () => {
    const groups = groupAccounts(
      [profile('p1'), profile('p2')],
      [account('a1', { profileId: 'p2' }), account('a2'), account('a3', { profileId: 'p1', platform: 'instagram' })]
    )
    expect(groups.map((g) => g.id)).toEqual(['group:p1', 'group:p2', 'group:other'])
    expect(groups.map((g) => g.accounts.map((a) => a.id))).toEqual([['a3'], ['a1'], ['a2']])
    expect(groups[0].profile?.id).toBe('p1')
    expect(groups[2].profile).toBeNull()
  })

  it('still lists a profile that has no login: that is where its logins are made', () => {
    const groups = groupAccounts([profile('p1')], [])
    expect(groups).toHaveLength(1)
    expect(groups[0].accounts).toEqual([])
  })

  it('leaves out "Other logins" when every login has a profile', () => {
    expect(groupAccounts([profile('p1')], [account('a1', { profileId: 'p1' })]).map((g) => g.id)).toEqual(['group:p1'])
  })

  it('has only "Other logins" while there is no profile', () => {
    const groups = groupAccounts([], [account('a1'), account('a2')])
    expect(groups.map((g) => g.id)).toEqual(['group:other'])
    expect(groups[0].accounts).toHaveLength(2)
    expect(OTHER_LOGINS).toBe('Other logins')
  })

  it('has no group at all with no profile and no login', () => {
    expect(groupAccounts([], [])).toEqual([])
  })

  it('treats a login whose profile is gone as a login without a profile', () => {
    const groups = groupAccounts([profile('p1')], [account('a1', { profileId: 'gone' })])
    expect(groups.map((g) => [g.id, g.accounts.map((a) => a.id)])).toEqual([
      ['group:p1', []],
      ['group:other', ['a1']]
    ])
  })

  it('lists the logins of a group by platform, then by name (case apart), then by id, the same on every load', () => {
    const accounts = [
      account('a', { platform: 'reddit', label: 'beta' }),
      account('b', { platform: 'reddit', label: 'Alpha' }),
      account('c', { platform: 'reddit', label: 'alpha' }),
      account('d', { platform: 'instagram', label: 'zeta' })
    ]
    const ids = (list: Account[]): string[] => groupAccounts([], list)[0].accounts.map((a) => a.id)
    expect(ids(accounts)).toEqual(['d', 'b', 'c', 'a'])
    expect(ids([...accounts].reverse())).toEqual(['d', 'b', 'c', 'a'])
  })

  it('does not change the lists it was given', () => {
    const accounts = [account('b', { label: 'b' }), account('a', { label: 'a' })]
    groupAccounts([], accounts)
    expect(accounts.map((a) => a.id)).toEqual(['b', 'a'])
  })
})

describe('the rows of the list', () => {
  const groups = groupAccounts([profile('p1'), profile('p2')], [account('a1', { profileId: 'p1' }), account('a2', { profileId: 'p1', platform: 'instagram' }), account('a3')])

  it('are the profile row, then its logins, then the next profile; "Other logins" is a heading and not a row', () => {
    expect(displayOrder(groups)).toEqual(['profile:p1', 'account:a2', 'account:a1', 'profile:p2', 'account:a3'])
  })

  it('has no row for an empty list', () => {
    expect(displayOrder([])).toEqual([])
  })

  it('keeps the key of a profile and of an account apart even when their ids are the same', () => {
    expect(profileKey('x')).not.toBe(accountKey('x'))
    expect(profileKey('x')).toBe('profile:x')
    expect(accountKey('x')).toBe('account:x')
  })

  it('reads a key back, whatever characters the id holds, and refuses anything else', () => {
    expect(parseKey(profileKey('p:1'))).toEqual({ kind: 'profile', id: 'p:1' })
    expect(parseKey(accountKey('a/b?c'))).toEqual({ kind: 'account', id: 'a/b?c' })
    expect(parseKey(null)).toBeNull()
    expect(parseKey('')).toBeNull()
    expect(parseKey('other:1')).toBeNull()
    expect(parseKey('account:')).toBeNull()
    expect(parseKey('profile')).toBeNull()
  })
})

describe('the row that is shown', () => {
  const order = ['profile:p1', 'account:a1', 'account:a2', 'profile:p2']

  it('is the chosen one while it is listed', () => {
    expect(selectedRow(order, order, 'account:a2')).toBe('account:a2')
  })

  it('is the first row when nothing is chosen', () => {
    expect(selectedRow(order, order, null)).toBe('profile:p1')
  })

  it('is the row that took the place of a removed one, in the order the list had', () => {
    expect(selectedRow(['profile:p1', 'account:a2', 'profile:p2'], order, 'account:a1')).toBe('account:a2')
    expect(selectedRow(['profile:p1', 'account:a1', 'account:a2'], order, 'profile:p2')).toBe('account:a2')
  })

  it('is the first row when the removed one and the rows around it are gone', () => {
    expect(selectedRow(['profile:p3'], order, 'account:a1')).toBe('profile:p3')
  })

  it('is the first row for a row that never was in the list (a link to an account that is not in the library)', () => {
    expect(selectedRow(order, order, 'account:unknown')).toBe('profile:p1')
  })

  it('is nothing for an empty list', () => {
    expect(selectedRow([], order, 'account:a1')).toBeNull()
    expect(selectedRow([], [], null)).toBeNull()
  })
})

describe('what a profile row says', () => {
  const now = new Date('2026-11-15T12:00:00.000Z')

  it('says a profile with no person yet is new, with no tag', () => {
    expect(personaRow(profile('p1', { label: 'Astrologer' }), 0, now)).toEqual({ title: 'Astrologer', line: 'No person yet', state: 'new', tone: '', accounts: 'no accounts' })
  })

  it('says a person that waits for the owner is proposed (amber)', () => {
    const row = personaRow(profile('p1', { displayName: 'Selena Marlowe', birthDate: '1989-01-02', place: 'Lisbon, Portugal', status: 'proposed' }), 1, now)
    expect(row.state).toBe('proposed')
    expect(row.tone).toBe('warn')
    expect(row.line).toBe('Selena Marlowe, 37, Lisbon')
    expect(row.accounts).toBe('1 account')
  })

  it('says an approved person is approved (green) and counts its accounts', () => {
    const row = personaRow(profile('p1', { displayName: 'Selena', status: 'approved' }), 3, now)
    expect(row.state).toBe('approved')
    expect(row.tone).toBe('good')
    expect(row.accounts).toBe('3 accounts')
  })

  it('does not call a profile with an approved status but no person approved', () => {
    expect(personaRow(profile('p1', { status: 'approved' }), 0, now).state).toBe('new')
  })
})

describe('the colour of a dot', () => {
  it('is green, amber or red for those tones, and the plain grey dot for anything else', () => {
    expect(rowTone('good')).toBe('good')
    expect(rowTone('warn')).toBe('warn')
    expect(rowTone('bad')).toBe('bad')
    expect(rowTone('neutral')).toBe('')
    expect(rowTone('info')).toBe('')
    expect(rowTone('')).toBe('')
  })
})

describe('what an account row says', () => {
  it('names the platform and the sign-in state, with the colour of the state', () => {
    expect(accountRow(account('a1', { label: 'Mara' }), platforms)).toEqual({ title: 'Mara', line: 'Reddit · Signed in', tone: 'good' })
    expect(accountRow(account('a1', { platform: 'instagram', status: 'login_required' }), platforms)).toMatchObject({ line: 'Instagram · Sign-in needed', tone: 'warn' })
    expect(accountRow(account('a1', { status: 'captcha' }), platforms)).toMatchObject({ line: 'Reddit · CAPTCHA to solve', tone: 'warn' })
    expect(accountRow(account('a1', { status: 'suspended' }), platforms)).toMatchObject({ line: 'Reddit · Suspended by the platform', tone: 'bad' })
  })

  it('names a platform the list does not know by its key', () => {
    expect(accountRow(account('a1', { platform: 'mastodon' }), platforms).line).toBe('Mastodon · Signed in')
  })
})

describe('the tabs of an account', () => {
  it('are Sign-in, Role, Browser and More, and it opens on Sign-in', () => {
    expect([...ACCOUNT_TABS]).toEqual(['signin', 'role', 'browser', 'more'])
    expect(ACCOUNT_TABS.map((tab) => ACCOUNT_TAB_LABEL[tab])).toEqual(['Sign-in', 'Role', 'Browser', 'More'])
    expect(DEFAULT_ACCOUNT_TAB).toBe('signin')
  })
})

describe('why the browser of an account cannot be switched (DEC-038)', () => {
  it('is the AI working, first', () => {
    expect(browserSwitchReason(true, { holder: 'user', windowOpen: true })).toBe(REASON_AI_WORKING)
    expect(browserSwitchReason(true, undefined)).toBe(REASON_AI_WORKING)
  })

  it('is control taken by the owner, then an open window', () => {
    expect(browserSwitchReason(false, { holder: 'user', windowOpen: true })).toBe(REASON_CONTROL_TAKEN)
    expect(browserSwitchReason(false, { holder: 'user', windowOpen: false })).toBe(REASON_CONTROL_TAKEN)
    expect(browserSwitchReason(false, { holder: 'none', windowOpen: true })).toBe(REASON_WINDOW_OPEN)
  })

  it('is nothing for the AI holding its own page, which the core does not refuse, and nothing while the answer has not come', () => {
    expect(browserSwitchReason(false, { holder: 'agent', windowOpen: false })).toBeNull()
    expect(browserSwitchReason(false, { holder: 'none', windowOpen: false })).toBeNull()
    expect(browserSwitchReason(false, undefined)).toBeNull()
  })

  it('says each reason in its own words, and no longer that the browser is "in use"', () => {
    expect(REASON_AI_WORKING).toBe('The AI is working on this account. Change its browser when it is done.')
    expect(REASON_CONTROL_TAKEN).toBe('You took control of the AI’s page of this account. Give control back (More), then change the browser.')
    expect(REASON_WINDOW_OPEN).toBe('A window of this account’s browser is open, and the change would close it. Close the window, then change the browser.')
    for (const reason of [REASON_AI_WORKING, REASON_CONTROL_TAKEN, REASON_WINDOW_OPEN]) expect(reason).not.toMatch(/in use/)
  })
})

describe('what the sign-in step says after the owner took control (DEC-038)', () => {
  it('is said only while control of the AI’s page is taken', () => {
    expect(signInControlNote({ holder: 'user' })).toBe(SIGNIN_CONTROL_TAKEN)
    expect(signInControlNote({ holder: 'agent' })).toBeNull()
    expect(signInControlNote({ holder: 'none' })).toBeNull()
    expect(signInControlNote(undefined)).toBeNull()
  })

  it('sends the owner to More, where control is given back, and does not blame an open window', () => {
    expect(SIGNIN_CONTROL_TAKEN).toBe('You took control of the AI’s page of this account, so the app cannot sign in or check it now. Give control back (More).')
  })
})

describe('why "Fill in the profile on the site (AI)" is off', () => {
  const ready = { ready: true, reason: null }

  it('is on for a signed-in account whose browser nobody took and whose engine is ready', () => {
    expect(profileFillReason(true, { holder: 'agent' }, ready)).toBeNull()
    expect(profileFillReason(true, undefined, undefined)).toBeNull()
  })

  it('asks for the sign-in first, before anything else', () => {
    expect(profileFillReason(false, { holder: 'user' }, { ready: false, reason: 'No engine.' })).toBe(PROFILE_FILL_SIGN_IN_FIRST)
  })

  it('is off after an explicit Take control, which the core would only refuse after the run was started', () => {
    expect(profileFillReason(true, { holder: 'user' }, ready)).toBe(PROFILE_FILL_CONTROL_TAKEN)
    expect(profileFillReason(true, { holder: 'user' }, { ready: false, reason: 'No engine.' })).toBe(PROFILE_FILL_CONTROL_TAKEN)
  })

  it('says the core\'s own reason when the engine is not ready, and nothing when it gave none', () => {
    expect(profileFillReason(true, { holder: 'agent' }, { ready: false, reason: 'Choose an AI engine in Settings first.' })).toBe('Choose an AI engine in Settings first.')
    expect(profileFillReason(true, { holder: 'agent' }, { ready: false, reason: null })).toBeNull()
  })
})

