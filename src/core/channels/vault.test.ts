// The password vault and the assisted sign-in (REQ-012, DEC-014).

import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { ApiError, LOCAL_ONLY_METHODS, type ApiArgs, type ApiMethod } from '../../shared/api'
import { vaultUnavailableText } from '../../shared/vault-message'
import { makeReadyWorld, type World } from './test-helpers'

const PASSWORD = 'S3cret-Pa$$w0rd!'
const save = (w: World, extra: Partial<{ loginName: string; password: string }> = {}) => w.call('vault.savePassword', { accountId: w.account.id, loginName: 'natal_bot', password: PASSWORD, ...extra })
const page = (w: World) => w.t.browser.page(w.account.id)

/** What a refused call carries: the code, and the words the owner reads. */
async function refusedWith<M extends ApiMethod>(w: World, method: M, args: ApiArgs<M>): Promise<{ code: string; message: string }> {
  try {
    await w.call(method, args)
  } catch (error) {
    if (error instanceof ApiError) return { code: error.code, message: error.message }
    throw error
  }
  throw new Error(`${method} was expected to be refused`)
}

/** Everything an owner, a log reader or a web client could see, as one text. */
function everythingVisible(w: World): string {
  const tables = ['accounts', 'channels', 'log_events', 'settings']
  const rows = tables.flatMap((name) => {
    try {
      return w.core.db.prepare(`SELECT * FROM ${name}`).all()
    } catch {
      return []
    }
  })
  return JSON.stringify(rows)
}

describe('the vault', () => {
  it('saves a login name and a password; only the name is in the database and the account list', async () => {
    const w = await makeReadyWorld()
    expect(await w.call('vault.status', undefined)).toEqual({ available: true, unavailable: null, accountIds: [], apiKeyAccountIds: [], apiKeyEnds: {} })
    const account = await save(w)
    expect(account.loginName).toBe('natal_bot')
    expect(await w.call('vault.status', undefined)).toEqual({ available: true, unavailable: null, accountIds: [w.account.id], apiKeyAccountIds: [], apiKeyEnds: {} })

    expect(JSON.stringify(await w.call('accounts.list', undefined))).not.toContain(PASSWORD)
    expect(JSON.stringify(await w.call('vault.status', undefined))).not.toContain(PASSWORD)
    expect(everythingVisible(w)).not.toContain(PASSWORD)
    expect(await w.core.secrets.get(`account:${w.account.id}`)).toBe(PASSWORD)
  })

  it('writes nothing to the log that contains the password, and says that a password was saved', async () => {
    const w = await makeReadyWorld()
    await save(w)
    const log = JSON.stringify(w.core.db.prepare('SELECT * FROM log_events').all())
    expect(log).not.toContain(PASSWORD)
    expect(log).toMatch(/password was saved/i)
  })

  it('replaces a password and removes it, and a removed account leaves nothing behind', async () => {
    const w = await makeReadyWorld()
    await save(w)
    await save(w, { password: 'second-password' })
    expect(await w.core.secrets.get(`account:${w.account.id}`)).toBe('second-password')

    await w.call('vault.removePassword', { accountId: w.account.id })
    expect(await w.call('vault.status', undefined)).toEqual({ available: true, unavailable: null, accountIds: [], apiKeyAccountIds: [], apiKeyEnds: {} })
    expect(w.core.repos.account(w.account.id).loginName).toBe('natal_bot')

    await save(w)
    await w.call('accounts.remove', { id: w.account.id })
    expect(w.t.secrets.values.size).toBe(0)
  })

  it('refuses what cannot be a password or a login name, and stores nothing', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('vault.savePassword', { accountId: w.account.id, loginName: '  ', password: PASSWORD })).toBe('invalid_input')
    expect(await w.refusal('vault.savePassword', { accountId: w.account.id, loginName: 'x', password: '' })).toBe('invalid_input')
    expect(await w.refusal('vault.savePassword', { accountId: w.account.id, loginName: 'x', password: 'line\nbreak' })).toBe('invalid_input')
    expect(await w.refusal('vault.savePassword', { accountId: w.account.id, loginName: 'x', password: 'p'.repeat(257) })).toBe('invalid_input')
    expect(await w.refusal('vault.savePassword', { accountId: w.account.id, loginName: 'x'.repeat(201), password: PASSWORD })).toBe('invalid_input')
    expect(await w.refusal('vault.savePassword', { accountId: 'nope', loginName: 'x', password: PASSWORD })).toBe('not_found')
    expect(w.t.secrets.values.size).toBe(0)
  })

  it('says so and stores nothing when the keychain refuses the app, and only after something asked it', async () => {
    const w = await makeReadyWorld()
    w.t.secrets.encryptable = false
    // Looking at the screen asks nothing, so nothing is known yet.
    expect(await w.call('vault.status', undefined)).toEqual({ available: true, unavailable: null, accountIds: [], apiKeyAccountIds: [], apiKeyEnds: {} })
    expect(w.t.secrets.touches).toBe(0)

    const announced = w.changes.length
    const refused = await refusedWith(w, 'vault.savePassword', { accountId: w.account.id, loginName: 'x', password: PASSWORD })
    expect(refused).toEqual({ code: 'vault_unavailable', message: vaultUnavailableText('refused') })
    // What the click found out is announced, so the open screen reads the status again and shows its Password block.
    expect(w.changes.slice(announced)).toContain('accounts')
    expect(refused.message).not.toMatch(/no (usable )?(system )?keychain/i)
    expect(await w.call('vault.status', undefined)).toEqual({ available: false, unavailable: 'refused', accountIds: [], apiKeyAccountIds: [], apiKeyEnds: {} })
    expect(w.t.secrets.values.size).toBe(0)
    expect(w.core.repos.account(w.account.id).loginName).toBeNull()
  })

  it('says there is no keychain only when the system has none', async () => {
    const w = await makeReadyWorld()
    w.t.secrets.encryptable = false
    w.t.secrets.cause = 'no_keychain'
    expect(await w.refusal('vault.savePassword', { accountId: w.account.id, loginName: 'x', password: PASSWORD })).toBe('vault_unavailable')
    expect(await w.call('vault.status', undefined)).toEqual({ available: false, unavailable: 'no_keychain', accountIds: [], apiKeyAccountIds: [], apiKeyEnds: {} })
  })

  it('does not touch the keychain to say which passwords are saved, however often it is asked (BUG-041)', async () => {
    const w = await makeReadyWorld()
    await save(w)
    w.t.secrets.touches = 0
    // Even a keychain that would refuse is not asked: the answer comes from the vault file.
    w.t.secrets.encryptable = false
    for (let i = 0; i < 3; i++) {
      expect(await w.call('vault.status', undefined)).toEqual({ available: true, unavailable: null, accountIds: [w.account.id], apiKeyAccountIds: [], apiKeyEnds: {} })
      await w.call('accounts.list', undefined)
    }
    expect(w.t.secrets.touches).toBe(0)
  })

  it('shows and copies the password only on request, and the copy is cleared after 30 seconds', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('vault.revealPassword', { accountId: w.account.id })).toBe('no_password')
    await save(w)
    expect(await w.call('vault.revealPassword', { accountId: w.account.id })).toEqual({ password: PASSWORD })
    await w.call('vault.copyPassword', { accountId: w.account.id })
    expect(w.t.clipboard.copies).toEqual([{ text: PASSWORD, clearAfterMs: 30_000 }])
  })

  it('says a saved password cannot be opened, not that none is saved, when the keychain refuses the app', async () => {
    const w = await makeReadyWorld()
    await save(w)
    w.t.secrets.encryptable = false
    for (const method of ['vault.revealPassword', 'vault.copyPassword'] as const) {
      expect(await refusedWith(w, method, { accountId: w.account.id })).toEqual({ code: 'vault_unavailable', message: vaultUnavailableText('refused') })
    }
    expect(w.t.clipboard.copies).toEqual([])
    // The screen is told to read the status again, and the status now says what happened; the saved password is still counted.
    expect(await w.call('vault.status', undefined)).toEqual({ available: false, unavailable: 'refused', accountIds: [w.account.id], apiKeyAccountIds: [], apiKeyEnds: {} })
  })

  it('says a saved password cannot be opened with this keychain when only that value is unreadable', async () => {
    const w = await makeReadyWorld()
    await save(w)
    w.t.secrets.unreadable.add(`account:${w.account.id}`)
    const error = await refusedWith(w, 'vault.revealPassword', { accountId: w.account.id })
    expect(error.code).toBe('vault_unavailable')
    expect(error.message).toContain('cannot be opened with this keychain')
    expect(error.message).not.toContain('Always Allow')
    expect(await w.call('vault.status', undefined)).toMatchObject({ available: true, unavailable: null })
  })

  it('marks exactly the methods that return a secret as local only', () => {
    expect([...LOCAL_ONLY_METHODS].sort()).toEqual(['vault.copyPassword', 'vault.revealPassword'])
  })
})

describe('sign in with the saved password', () => {
  it('fills the form of the platform page and confirms with the site\'s own login check', async () => {
    const w = await makeReadyWorld()
    await save(w)
    const result = await w.call('accounts.signIn', { accountId: w.account.id })
    expect(result.outcome).toBe('signed_in')
    expect(result.account.status).toBe('ready')
    expect(page(w).log).toContain('goto https://fake.test/login')
    expect(page(w).signIns).toEqual([{ username: 'natal_bot', password: PASSWORD, hosts: ['fake.test'] }])
    // The password is handed to the page and nowhere else.
    expect(page(w).log.join('\n')).not.toContain(PASSWORD)
    expect(everythingVisible(w)).not.toContain(PASSWORD)
    expect(JSON.stringify(w.core.db.prepare('SELECT * FROM log_events').all())).not.toContain(PASSWORD)
  })

  it('needs a saved password', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('accounts.signIn', { accountId: w.account.id })).toBe('no_password')
    expect(page(w).signIns).toEqual([])
  })

  it('does not sign in when the keychain will not open the password, and says so instead of "no password"', async () => {
    const w = await makeReadyWorld()
    await save(w)
    w.t.secrets.encryptable = false
    expect(await refusedWith(w, 'accounts.signIn', { accountId: w.account.id })).toEqual({ code: 'vault_unavailable', message: vaultUnavailableText('refused') })
    expect(page(w).signIns).toEqual([])
  })

  it.each([
    ['wrong_host', /not a page of this platform/i],
    ['captcha', /CAPTCHA/],
    ['no_form', /form was not found/i]
  ] as const)('stops on "%s", asks for the owner and does not retry', async (status, words) => {
    const w = await makeReadyWorld()
    await save(w)
    page(w).signInAnswers = [status]
    const result = await w.call('accounts.signIn', { accountId: w.account.id })
    expect(result.outcome).toBe('needs_you')
    expect(result.detail).toMatch(words)
    expect(page(w).signIns).toHaveLength(1)
    expect(w.fake.calls).not.toContain('checkLogin')
  })

  it('handles a form that asks for the name first and the password on the next step', async () => {
    const w = await makeReadyWorld()
    await save(w)
    page(w).signInAnswers = ['next_step', 'submitted']
    const result = await w.call('accounts.signIn', { accountId: w.account.id })
    expect(page(w).signIns).toHaveLength(2)
    expect(result.outcome).toBe('signed_in')
  })

  it('does not call it a success when the site does not confirm the sign-in', async () => {
    const w = await makeReadyWorld()
    await save(w)
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    const result = await w.call('accounts.signIn', { accountId: w.account.id })
    expect(result.outcome).toBe('needs_you')
    expect(result.detail).toMatch(/did not confirm/i)
    expect(result.account.status).toBe('login_required')
  })

  it('leaves the browser alone while the owner has it', async () => {
    const w = await makeReadyWorld()
    await save(w)
    w.t.browser.session(w.account).takeControl()
    expect(await w.refusal('accounts.signIn', { accountId: w.account.id })).toBe('user_window_open')
    expect(page(w).signIns).toEqual([])
  })

  it('never signs the same account in twice at once', async () => {
    const w = await makeReadyWorld()
    await save(w)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    w.core.sleep.bind(w.core)
    const slow = vi.spyOn(w.core, 'sleep').mockImplementation(() => gate)
    const first = w.call('accounts.signIn', { accountId: w.account.id })
    await vi.waitFor(() => expect(page(w).signIns).toHaveLength(1))
    expect(await w.refusal('accounts.signIn', { accountId: w.account.id })).toBe('sign_in_running')
    release()
    await first
    slow.mockRestore()
  })
})

describe('automatic sign-in when an account is found signed out', () => {
  const signedOut = (w: World) => (w.fake.login = { loggedIn: false, identity: null, captcha: false })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

  it('tries once with the saved password', async () => {
    const w = await makeReadyWorld()
    await save(w)
    signedOut(w)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await vi.waitFor(() => expect(page(w).signIns).toHaveLength(1))
  })

  it('does nothing without a saved password', async () => {
    const w = await makeReadyWorld()
    signedOut(w)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await settle()
    expect(page(w).signIns).toEqual([])
  })

  it('does not touch the keychain for an account with no saved password (BUG-041)', async () => {
    const w = await makeReadyWorld()
    signedOut(w)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await settle()
    expect(w.t.secrets.touches).toBe(0)
  })

  it('logs a refusal of the keychain as the reason it did not run, and does not ask a keychain that refused again', async () => {
    const w = await makeReadyWorld()
    await save(w)
    w.t.secrets.encryptable = false
    signedOut(w)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await vi.waitFor(() => expect(JSON.stringify(w.core.db.prepare("SELECT * FROM log_events WHERE level = 'warn'").all())).toContain('macOS did not let the app use its keychain item'))
    expect(page(w).signIns).toEqual([])
    const asked = w.t.secrets.touches
    expect(w.core.secrets.blocked()).toBe('refused')

    // The next time it is found signed out, the background does not ask the keychain again.
    w.t.clock.advance(2 * 60 * 60 * 1000)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await settle()
    expect(w.t.secrets.touches).toBe(asked)
  })

  it('tries at most once an hour, even if the password is wrong', async () => {
    const w = await makeReadyWorld()
    await save(w)
    signedOut(w)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await vi.waitFor(() => expect(page(w).signIns).toHaveLength(1))
    await settle()

    await w.call('accounts.checkLogin', { accountId: w.account.id })
    w.t.clock.advance(59 * 60 * 1000)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await settle()
    expect(page(w).signIns).toHaveLength(1)

    w.t.clock.advance(2 * 60 * 1000)
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    await vi.waitFor(() => expect(page(w).signIns).toHaveLength(2))
  })

  it('does not break the check that found the account signed out when the attempt itself fails', async () => {
    const w = await makeReadyWorld()
    await save(w)
    signedOut(w)
    page(w).signIn = async () => {
      throw new Error('The sign-in page did not answer.')
    }
    const checked = await w.call('accounts.checkLogin', { accountId: w.account.id })
    expect(checked.status).toBe('login_required')
    await vi.waitFor(() => expect(JSON.stringify(w.core.db.prepare("SELECT * FROM log_events WHERE level = 'warn'").all())).toMatch(/did not run/i))
    expect(everythingVisible(w)).not.toContain(PASSWORD)
  })
})
