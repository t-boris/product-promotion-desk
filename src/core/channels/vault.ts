// The password vault of the owner's accounts (REQ-012, DEC-014): save, replace, remove, reveal and copy a password.
//
// A password goes only to the SecretStore (encrypted by the system keychain). The database keeps the login name, which is
// not a secret. Nothing here logs, emits or returns a password except `reveal`, which the web mode refuses.

import { createHash, randomBytes } from 'node:crypto'
import { ApiError } from '../../shared/api'
import { aKeyNameOf, keyNameOf, type Account, type VaultStatus } from '../../shared/types'
import { vaultUnavailableText } from '../../shared/vault-message'
import type { Core } from '../core'
import { SecretOpenError, type ApiAccess, type Connector, type KeptKey } from '../ports'
import type { SignInWait } from '../net/sign-in-listener'
import { passwordKey, apiKeyKey } from '../vault'
import { requireText } from './errors'
import type { ChannelsStore } from './store'
import type { AccountsService } from './accounts'
import { keyTimesOf, rememberKeyTimes } from './key-renewal'

const MAX_LOGIN_NAME = 200
const MAX_PASSWORD = 256
const MAX_API_KEY = 4096
/** How long a sign-in waits for the owner in the platform's window. */
const SIGN_IN_WAIT_MS = 10 * 60_000
const CLIPBOARD_CLEAR_MS = 30_000

export class VaultService {
  constructor(
    private readonly core: Core,
    private readonly accounts: AccountsService,
    private readonly store: ChannelsStore
  ) {}

  /** Which accounts have a password saved, from the vault file alone: asking never touches the keychain, so it never prompts (BUG-041). */
  status(): VaultStatus {
    const unavailable = this.core.secrets.blocked()
    const accountIds = this.core.repos.listAccounts().filter((a) => this.core.secrets.has(passwordKey(a.id))).map((a) => a.id)
    const apiKeyAccountIds = this.core.repos.listAccounts().filter((a) => this.core.secrets.has(apiKeyKey(a.id))).map((a) => a.id)
    const apiKeyEnds: Record<string, string> = {}
    for (const id of apiKeyAccountIds) {
      const ends = keyTimesOf(this.core.db, id).expiresAt
      if (ends) apiKeyEnds[id] = ends
    }
    return { available: unavailable === null, unavailable, accountIds, apiKeyAccountIds, apiKeyEnds }
  }

  /** Whether a password is saved for the account (no value). Reads the vault file only. */
  has(account: Account): boolean {
    return this.core.secrets.has(passwordKey(account.id))
  }

  /**
   * The saved password, or null when none is saved. Only the sign-in step and the owner's own "show" and "copy" use it, and this is the
   * first place the keychain is asked. A password that is saved but cannot be opened is `vault_unavailable`, never "no password".
   */
  async password(account: Account): Promise<string | null> {
    try {
      return await this.core.secrets.get(passwordKey(account.id))
    } catch (error) {
      if (!(error instanceof SecretOpenError)) throw error
      // The screen reads the status again, so its Password block says what this click found out.
      this.core.events.changed('accounts')
      const why = error.blocked ? vaultUnavailableText(error.blocked) : `The saved password of ${account.label} cannot be opened with this keychain (it was saved under another key, for example before a keychain reset). Save the password again.`
      throw new ApiError('vault_unavailable', why)
    }
  }

  private async requireAvailable(): Promise<void> {
    if (await this.core.secrets.available()) return
    this.core.events.changed('accounts')
    throw new ApiError('vault_unavailable', vaultUnavailableText(this.core.secrets.blocked() ?? 'no_keychain'))
  }

  async savePassword(args: { accountId: string; loginName: string; password: string }): Promise<Account> {
    const account = this.accounts.account(args.accountId)
    // An account that signs in through another has no credentials of its own to keep (DEC-027).
    if (account.signsInVia) throw new ApiError('signs_in_through_another', `${account.label} signs in through ${this.accounts.account(account.signsInVia).label}: it has no password of its own to save.`)
    const loginName = requireText(args.loginName, 'The login name')
    if (loginName.length > MAX_LOGIN_NAME) throw new ApiError('invalid_input', `The login name is too long (limit ${MAX_LOGIN_NAME} characters).`)
    const password = typeof args.password === 'string' ? args.password : ''
    if (password === '') throw new ApiError('invalid_input', 'The password is required.')
    if (password.length > MAX_PASSWORD) throw new ApiError('invalid_input', `The password is too long (limit ${MAX_PASSWORD} characters).`)
    if ([...password].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) throw new ApiError('invalid_input', 'The password contains a control character or a line break. Check what was pasted.')
    await this.requireAvailable()
    try {
      await this.core.secrets.set(passwordKey(account.id), password)
    } catch {
      // The reason never includes the value; the store's own message is not passed on, in case it quotes what it was given.
      throw new ApiError('vault_failed', 'The password could not be saved to the vault.')
    }
    const updated = this.store.setLoginName(account.id, loginName)
    this.core.log.info('accounts', `A password was saved for ${account.label} (login name ${loginName}).`)
    this.core.events.changed('accounts')
    return updated
  }

  /**
   * Saves the key of an account that works through its platform's API (a bot token, DEC-055) and checks it with the platform at once: the account
   * becomes ready, with the name the platform gives it, or says why not. The key is kept only in the vault and is never shown again.
   */
  async saveApiKey(args: { accountId: string; key: string; secret?: string; keyId?: string }): Promise<Account> {
    const account = this.accounts.account(args.accountId)
    const connector = account.access === 'api' ? this.core.connectors.list().find((c) => c.api !== undefined && c.platform === account.platform) : undefined
    const api = connector?.api
    if (!connector || !api) throw new ApiError('invalid_input', `${account.label} works in its browser: it has no API key to save.`)
    if (api.signIn) throw new ApiError('invalid_input', `${account.label} is connected by a sign-in, not by a pasted key: press “${api.signIn.label}” on its page.`)
    const key = typeof args.key === 'string' ? args.key.trim() : ''
    if (key === '') throw new ApiError('invalid_input', `The ${keyNameOf(api)} is required.`)
    if (key.length > MAX_API_KEY || !api.keyLooksValid(key)) throw new ApiError('invalid_input', `This does not look like ${aKeyNameOf(api)}. Copy it whole from where the platform shows it.`)
    const keyId = api.keyId && typeof args.keyId === 'string' ? args.keyId.trim() : ''
    if (api.keyId && (keyId === '' || keyId.length > 128 || /\s/.test(keyId))) throw new ApiError('invalid_input', `The ${api.keyId.label.toLowerCase()} is required: it is one word, shown beside the ${keyNameOf(api)}.`)
    await this.requireAvailable()
    // A platform whose keys end is asked how long this one lasts, and for a longer one when the owner gave the secret that makes it. The secret is used here and kept nowhere.
    const secret = api.onceSecret && typeof args.secret === 'string' && args.secret.trim() !== '' ? args.secret.trim() : null
    let kept: KeptKey = { key, expiresAt: null }
    if (connector.keyToKeep) {
      try {
        kept = await connector.keyToKeep(this.core.http, { key, secret, keyId: api.keyId ? keyId : null }, this.core.clock.now())
      } catch (error) {
        throw new ApiError('invalid_input', error instanceof Error ? error.message : String(error))
      }
    }
    // A key the platform never renews and whose end it does not tell: counted from now, the day it was saved (it is made minutes before).
    if (kept.expiresAt === null && api.keyDays) kept = { key: kept.key, expiresAt: new Date(this.core.clock.now().getTime() + api.keyDays * 24 * 3_600_000).toISOString() }
    return this.keep(account, connector, api, kept)
  }

  /** Puts the key of an API account into the vault, remembers its times, and checks it with the platform at once. */
  private async keep(account: Account, connector: Connector, api: ApiAccess, kept: KeptKey): Promise<Account> {
    try {
      await this.core.secrets.set(apiKeyKey(account.id), kept.key)
    } catch {
      throw new ApiError('vault_failed', `The ${keyNameOf(api)} could not be saved to the vault.`)
    }
    rememberKeyTimes(this.core.db, account.id, this.core.clock.now().toISOString(), kept.expiresAt)
    this.core.log.info('accounts', `${aKeyNameOf(api).replace(/^a/, 'A')} was saved for ${account.label}${kept.expiresAt && !api.renewedOnUse ? `; it lasts until ${kept.expiresAt.slice(0, 10)}${connector.renewKey ? ' and the application renews it by itself' : ', and a new one must be saved before then'}` : ''}.`)
    this.core.events.changed('accounts')
    return this.accounts.checkLogin(account.id, { signInAgain: false })
  }

  /** The sign-ins that are waiting for their owner in a browser window, by account. */
  private readonly signIns = new Map<string, SignInWait>()

  /**
   * Connects an account whose platform is signed in to through its own window: the platform's page is opened in the account's browser, the
   * owner allows the application there, the platform sends the browser back to an address on this Mac, and what it gives for the code is kept.
   * The verifier and the code never leave this call, and nothing of them is logged.
   */
  async signIn(args: { accountId: string; keyId: string }): Promise<Account> {
    const account = this.accounts.account(args.accountId)
    const connector = account.access === 'api' ? this.core.connectors.list().find((c) => c.api !== undefined && c.platform === account.platform) : undefined
    const api = connector?.api
    if (!connector || !api?.signIn || !connector.signInUrl || !connector.keyFromSignIn) throw new ApiError('invalid_input', `${account.label} is not connected by a sign-in.`)
    const keyId = typeof args.keyId === 'string' ? args.keyId.trim() : ''
    const idName = api.keyId?.label ?? 'id of the app'
    if (keyId === '' || keyId.length > 128 || /\s/.test(keyId)) throw new ApiError('invalid_input', `The ${idName} is required: it is one word, copied from the platform.`)
    await this.requireAvailable()
    if (this.signIns.has(account.id)) throw new ApiError('invalid_state', `A sign-in of ${account.label} is going on already: allow the application in the browser window, or stop waiting first.`)
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(48).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    let wait: SignInWait
    try {
      wait = await this.core.signInListener.listen(state, SIGN_IN_WAIT_MS)
    } catch (error) {
      throw new ApiError('sign_in_failed', error instanceof Error ? error.message : String(error))
    }
    this.signIns.set(account.id, wait)
    try {
      await this.accounts.openBrowser({ accountId: account.id, url: connector.signInUrl({ keyId, redirectUri: wait.redirectUri, state, challenge }) })
      this.core.log.info('accounts', `The sign-in of ${account.label} was started: the platform's page is open in the account's browser, and the application waits for you to allow it there.`)
      const answer = await wait.answer
      const code = answer.get('code')
      if (!code) {
        const said = answer.get('error_description') ?? answer.get('error') ?? 'it sent no code back'
        throw new Error(`The platform did not allow it (${said.slice(0, 200)}). Nothing was saved.`)
      }
      const kept = await connector.keyFromSignIn(this.core.http, { keyId, redirectUri: wait.redirectUri, code, verifier }, this.core.clock.now())
      return await this.keep(account, connector, api, kept)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('sign_in_failed', error instanceof Error ? error.message : String(error))
    } finally {
      wait.stop()
      this.signIns.delete(account.id)
    }
  }

  stopSignIn(accountId: unknown): void {
    this.signIns.get(this.accounts.account(accountId).id)?.stop()
  }

  removePassword(accountId: unknown): Account {
    const account = this.accounts.account(accountId)
    this.core.secrets.delete(passwordKey(account.id))
    this.core.log.info('accounts', `The saved password of ${account.label} was removed.`)
    this.core.events.changed('accounts')
    return account
  }

  async reveal(accountId: unknown): Promise<{ password: string }> {
    const account = this.accounts.account(accountId)
    const password = await this.password(account)
    if (password === null) throw new ApiError('no_password', `No password is saved for ${account.label}.`)
    return { password }
  }

  async copy(accountId: unknown): Promise<void> {
    const account = this.accounts.account(accountId)
    const password = await this.password(account)
    if (password === null) throw new ApiError('no_password', `No password is saved for ${account.label}.`)
    if (!this.core.clipboard) throw new ApiError('clipboard_unavailable', 'The clipboard is not available here. Use "Show" instead.')
    this.core.clipboard.copy(password, CLIPBOARD_CLEAR_MS)
  }
}
