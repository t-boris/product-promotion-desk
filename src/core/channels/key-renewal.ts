import type { Core } from '../core'
import { keyNameOf } from '../../shared/types'
import type { Db } from '../db/database'
import type { KeyTimes } from '../ports'
import { apiKeyKey } from '../vault'

/** What is remembered of an account's key: when it was saved or last renewed, and when it ends as far as the platform said. */
export function keyTimesOf(db: Db, accountId: string): KeyTimes {
  const row = db.prepare('SELECT changed_at AS changedAt, expires_at AS expiresAt FROM api_key_times WHERE account_id = ?').get(accountId) as KeyTimes | undefined
  return row ?? { changedAt: null, expiresAt: null }
}

/** Remembers that the key of an account was saved or renewed now. */
export function rememberKeyTimes(db: Db, accountId: string, changedAt: string, expiresAt: string | null): void {
  db.prepare('INSERT INTO api_key_times (account_id, changed_at, expires_at) VALUES (?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET changed_at = excluded.changed_at, expires_at = excluded.expires_at').run(accountId, changedAt, expiresAt)
}

/**
 * Keys that end (a Threads access token lasts 60 days) are renewed by the application before they do: each API account whose connector can
 * renew its key is asked, and the key the platform gives in its place is put into the vault. A key is never logged. A key the platform no
 * longer accepts is left as it is: the account's next sign-in check says so on its page.
 */
export class KeyRenewal {
  constructor(private readonly core: Core) {}

  /** Renews every key that is due; returns how many were renewed. A failure of one account does not stop the others. */
  async renewDue(): Promise<number> {
    let renewed = 0
    for (const account of this.core.repos.listAccounts()) {
      if (account.access !== 'api') continue
      const connector = this.core.connectors.list().find((c) => c.api !== undefined && c.platform === account.platform)
      if (!connector?.api || !connector.renewKey) continue
      const name = keyNameOf(connector.api)
      try {
        // Asked of the vault file first: an account with no key saved never makes the keychain ask.
        if (!this.core.secrets.has(apiKeyKey(account.id))) continue
        const key = await this.core.secrets.get(apiKeyKey(account.id))
        if (!key) continue
        const now = this.core.clock.now()
        const next = await connector.renewKey(this.core.http, key, now, keyTimesOf(this.core.db, account.id))
        if (!next) continue
        await this.core.secrets.set(apiKeyKey(account.id), next.key)
        rememberKeyTimes(this.core.db, account.id, now.toISOString(), next.expiresAt)
        renewed += 1
        this.core.log.info('accounts', `The ${name} of ${account.label} was renewed${next.expiresAt ? `; it lasts until ${next.expiresAt.slice(0, 10)}` : ''}.`)
      } catch (error) {
        this.core.log.warn('accounts', `The ${name} of ${account.label} could not be renewed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return renewed
  }
}
