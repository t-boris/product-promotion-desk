// The password vault of the owner's accounts (REQ-012, DEC-014): save, replace, remove, reveal and copy a password.
//
// A password goes only to the SecretStore (encrypted by the system keychain). The database keeps the login name, which is
// not a secret. Nothing here logs, emits or returns a password except `reveal`, which the web mode refuses.

import { ApiError } from '../../shared/api'
import type { Account, VaultStatus } from '../../shared/types'
import type { Core } from '../core'
import { passwordKey } from '../vault'
import { requireText } from './errors'
import type { ChannelsStore } from './store'
import type { AccountsService } from './accounts'

const MAX_LOGIN_NAME = 200
const MAX_PASSWORD = 256
const CLIPBOARD_CLEAR_MS = 30_000

export class VaultService {
  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly store: ChannelsStore
  ) {}

  status(): VaultStatus {
    const available = this.core.secrets.available()
    const accountIds = available ? this.core.repos.listAccounts().filter((a) => this.core.secrets.has(passwordKey(a.id))).map((a) => a.id) : []
    return { available, accountIds }
  }

  /** Whether a password is saved for the account (no value). */
  has(account: Account): boolean {
    return this.core.secrets.available() && this.core.secrets.has(passwordKey(account.id))
  }

  /** The saved password, or null. Only the sign-in step and the owner's own "show" and "copy" use it. */
  password(account: Account): string | null {
    return this.core.secrets.available() ? this.core.secrets.get(passwordKey(account.id)) : null
  }

  private requireAvailable(): void {
    if (!this.core.secrets.available()) {
      throw new ApiError('vault_unavailable', 'This system cannot encrypt passwords (no system keychain), so the application stores none. Sign in on the site itself.')
    }
  }

  savePassword(args: { accountId: string; loginName: string; password: string }): Account {
    const account = this.accounts.account(args.accountId)
    const loginName = requireText(args.loginName, 'The login name')
    if (loginName.length > MAX_LOGIN_NAME) throw new ApiError('invalid_input', `The login name is too long (limit ${MAX_LOGIN_NAME} characters).`)
    const password = typeof args.password === 'string' ? args.password : ''
    if (password === '') throw new ApiError('invalid_input', 'The password is required.')
    if (password.length > MAX_PASSWORD) throw new ApiError('invalid_input', `The password is too long (limit ${MAX_PASSWORD} characters).`)
    if ([...password].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) throw new ApiError('invalid_input', 'The password contains a control character or a line break. Check what was pasted.')
    this.requireAvailable()
    try {
      this.core.secrets.set(passwordKey(account.id), password)
    } catch {
      // The reason never includes the value; the store's own message is not passed on, in case it quotes what it was given.
      throw new ApiError('vault_failed', 'The password could not be saved to the vault.')
    }
    const updated = this.store.setLoginName(account.id, loginName)
    this.core.log.info('accounts', `A password was saved for ${account.label} (login name ${loginName}).`)
    this.core.events.changed('accounts')
    return updated
  }

  removePassword(accountId: unknown): Account {
    const account = this.accounts.account(accountId)
    this.core.secrets.delete(passwordKey(account.id))
    this.core.log.info('accounts', `The saved password of ${account.label} was removed.`)
    this.core.events.changed('accounts')
    return account
  }

  reveal(accountId: unknown): { password: string } {
    const account = this.accounts.account(accountId)
    const password = this.password(account)
    if (password === null) throw new ApiError('no_password', `No password is saved for ${account.label}.`)
    return { password }
  }

  copy(accountId: unknown): void {
    const account = this.accounts.account(accountId)
    const password = this.password(account)
    if (password === null) throw new ApiError('no_password', `No password is saved for ${account.label}.`)
    if (!this.core.clipboard) throw new ApiError('clipboard_unavailable', 'The clipboard is not available here. Use "Show" instead.')
    this.core.clipboard.copy(password, CLIPBOARD_CLEAR_MS)
  }
}
