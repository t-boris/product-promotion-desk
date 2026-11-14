// The password vault of the main process (DEC-014): one file of encrypted values, the key held by the system keychain.
//
// Electron's `safeStorage` encrypts with a key kept in the macOS Keychain, so the file is useless on another machine or
// to another user. Every value is encrypted on its own and the file is written atomically with owner-only permissions.
// Without a usable keychain nothing is stored at all: there is no plain-text fallback.
//
// The keychain is asked only when a value is saved, shown or used (BUG-041): `has`, `delete` and `blocked` read the file or a remembered
// answer and never call the encryptor. Everything that does ask is asynchronous, because macOS may show a prompt for it and the
// application must go on answering while that prompt is open.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SecretOpenError, type SecretClipboard, type SecretStore } from '../core/ports'
import type { VaultUnavailable } from '../shared/types'

/**
 * The part of Electron's `safeStorage` the vault uses; a test supplies its own. It is the asynchronous API: the synchronous one
 * (`isEncryptionAvailable`, `encryptString`, `decryptString`) is deprecated and blocks the main process while a keychain prompt is open.
 * Electron documents that what `encryptString` wrote still decrypts with `decryptStringAsync`, so a vault file made by an earlier
 * version stays readable.
 */
export interface Encryptor {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plain: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>
}

type VaultFile = { version: 1; values: Record<string, string> }

export class FileVault implements SecretStore {
  private cache: VaultFile | null = null
  /** What the last real question to the keychain found: null while it worked or nobody has asked yet. */
  private block: VaultUnavailable | null = null

  constructor(
    private readonly path: string,
    private readonly encryptor: Encryptor,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  /** Asks the keychain (and so may show the macOS prompt, without stopping the application). Only a save, a reveal or a sign-in gets here. */
  async available(): Promise<boolean> {
    let usable = false
    try {
      usable = await this.encryptor.isAsyncEncryptionAvailable()
    } catch {
      // A keychain that cannot be asked is the same as one that said no.
    }
    // On a Mac there is always a keychain, so "no" means macOS refused the app its item or the keychain is locked; elsewhere there is none.
    this.block = usable ? null : this.platform === 'darwin' ? 'refused' : 'no_keychain'
    return usable
  }

  blocked(): VaultUnavailable | null {
    return this.block
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

  /** The file alone says whether a value is stored: the keychain is not asked. */
  has(key: string): boolean {
    return Object.hasOwn(this.load().values, key)
  }

  async get(key: string): Promise<string | null> {
    const stored = this.load().values[key]
    if (typeof stored !== 'string') return null
    if (!(await this.available())) throw new SecretOpenError(this.block)
    try {
      // `shouldReEncrypt` (a rotated key) is not acted on: the value is still read, and the next save writes it in the current form.
      return (await this.encryptor.decryptStringAsync(Buffer.from(stored, 'base64'))).result
    } catch {
      // The keychain answered but not this value (another user, a reset keychain): it is stored, so it is not "no value".
      throw new SecretOpenError(null)
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!(await this.available())) throw new Error('The password vault is not available on this system.')
    const encrypted = (await this.encryptor.encryptStringAsync(value)).toString('base64')
    // The file is read after the waiting, so a save that overlapped another one cannot drop its value.
    this.write({ version: 1, values: { ...this.load().values, [key]: encrypted } })
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
