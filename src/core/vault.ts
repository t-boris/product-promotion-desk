// The vault's contract with the core (DEC-014). The real store is the main process's, encrypted by the system keychain.

import type { VaultUnavailable } from '../shared/types'
import type { SecretStore } from './ports'

/** The key a password is kept under. Keys are not secret; they only say which account a value belongs to. */
export const passwordKey = (accountId: string): string => `account:${accountId}`

/** The vault entry of an API account's key (a bot token, DEC-055). Never the password entry: the automatic sign-in types a password into a web form. */
export const apiKeyKey = (accountId: string): string => `apikey:${accountId}`

/** The vault entry of a base mailbox's IMAP app password (REQ-013, DEC-100). Kept only in the encrypted vault, never in SQLite or logs. */
export const mailboxPasswordKey = (mailboxId: string): string => `mailbox:${mailboxId}`

/** Used when nothing was supplied (web mode in a test, a system without a keychain): says so and stores nothing. */
export class UnavailableSecretStore implements SecretStore {
  async available(): Promise<boolean> {
    return false
  }
  blocked(): VaultUnavailable {
    return 'no_keychain'
  }
  has(): boolean {
    return false
  }
  async get(): Promise<string | null> {
    return null
  }
  async set(): Promise<void> {
    throw new Error('The password vault is not available on this system.')
  }
  delete(): void {
    // nothing is stored, nothing to delete
  }
}
