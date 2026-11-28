import type { Core } from '../core'
import { keyNameOf } from '../../shared/types'
import { apiKeyKey } from '../vault'

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
        const next = await connector.renewKey(this.core.http, key, this.core.clock.now())
        if (!next) continue
        await this.core.secrets.set(apiKeyKey(account.id), next.key)
        renewed += 1
        this.core.log.info('accounts', `The ${name} of ${account.label} was renewed${next.expiresAt ? `; it lasts until ${next.expiresAt.slice(0, 10)}` : ''}.`)
      } catch (error) {
        this.core.log.warn('accounts', `The ${name} of ${account.label} could not be renewed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return renewed
  }
}
