// The vault's contract with the core (DEC-014). The real store is the main process's, encrypted by the system keychain.

import type { SecretStore } from './ports'

/** The key a password is kept under. Keys are not secret; they only say which account a value belongs to. */
export const passwordKey = (accountId: string): string => `account:${accountId}`

/** Used when nothing was supplied (web mode in a test, a system without a keychain): says so and stores nothing. */
export class UnavailableSecretStore implements SecretStore {
  available(): boolean {
    return false
  }
  has(): boolean {
    return false
  }
  get(): string | null {
    return null
  }
  set(): void {
    throw new Error('The password vault is not available on this system.')
  }
  delete(): void {
    // nothing is stored, nothing to delete
  }
}
