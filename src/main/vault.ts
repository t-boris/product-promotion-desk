// The password vault of the main process (DEC-014): one file of encrypted values, the key held by the system keychain.
//
// Electron's `safeStorage` encrypts with a key kept in the macOS Keychain, so the file is useless on another machine or
// to another user. Every value is encrypted on its own and the file is written atomically with owner-only permissions.
// Without a usable keychain nothing is stored at all: there is no plain-text fallback.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretClipboard, SecretStore } from '../core/ports'

/** The part of Electron's `safeStorage` the vault uses; a test supplies its own. */
export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

type VaultFile = { version: 1; values: Record<string, string> }

export class FileVault implements SecretStore {
  private cache: VaultFile | null = null

  constructor(
    private readonly path: string,
    private readonly encryptor: Encryptor
  ) {}

  available(): boolean {
    try {
      return this.encryptor.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private load(): VaultFile {
    if (this.cache) return this.cache
    let loaded: VaultFile = { version: 1, values: {} }
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<VaultFile>
        if (parsed.version === 1 && parsed.values && typeof parsed.values === 'object') loaded = { version: 1, values: { ...parsed.values } }
      } catch {
        // An unreadable file is treated as empty; it is replaced by the next save, never read as text anywhere.
      }
    }
    this.cache = loaded
    return loaded
  }

  private write(file: VaultFile): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, JSON.stringify(file), { mode: 0o600 })
    renameSync(temp, this.path)
    chmodSync(this.path, 0o600)
    this.cache = file
  }

  has(key: string): boolean {
    return this.available() && Object.hasOwn(this.load().values, key)
  }

  get(key: string): string | null {
    if (!this.available()) return null
    const stored = this.load().values[key]
    if (typeof stored !== 'string') return null
    try {
      return this.encryptor.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      // A value this keychain cannot open (another user, a reset keychain) is the same as no value.
      return null
    }
  }

  set(key: string, value: string): void {
    if (!this.available()) throw new Error('The password vault is not available on this system.')
    const file = this.load()
    this.write({ version: 1, values: { ...file.values, [key]: this.encryptor.encryptString(value).toString('base64') } })
  }

  delete(key: string): void {
    const file = this.load()
    if (!Object.hasOwn(file.values, key)) return
    const { [key]: _removed, ...rest } = file.values
    this.write({ version: 1, values: rest })
  }
}

/** The part of Electron's `clipboard` the copy uses. */
export interface ClipboardApi {
  writeText(text: string): void
  /** Newer Electron versions answer asynchronously. */
  readText(): string | Promise<string>
}

/** Copies a secret and clears the clipboard after a while, but only if the owner has not copied something else since. */
export class TimedClipboard implements SecretClipboard {
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly clipboard: ClipboardApi) {}

  copy(text: string, clearAfterMs: number): void {
    this.clipboard.writeText(text)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void Promise.resolve(this.clipboard.readText()).then((now) => {
        if (now === text) this.clipboard.writeText('')
      })
    }, clearAfterMs)
    this.timer.unref?.()
  }
}
