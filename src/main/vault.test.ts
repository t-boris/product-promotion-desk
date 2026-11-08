import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileVault, TimedClipboard, type Encryptor } from './vault'

/** Reversible "encryption" for the test: the file must never contain the plain value, whatever the algorithm is. */
const encryptor = (available = true): Encryptor => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decryptString: (data) => {
    const text = data.toString()
    if (!text.startsWith('enc:')) throw new Error('not ours')
    return [...text.slice(4)].reverse().join('')
  }
})

describe('FileVault', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ppd-vault-'))
  })

  it('keeps values encrypted in a file only the owner can read, and reads them back', () => {
    const path = join(dir, 'vault.bin')
    const vault = new FileVault(path, encryptor())
    vault.set('account:a1', 'S3cret-Pa$$w0rd!')
    expect(vault.has('account:a1')).toBe(true)
    expect(vault.get('account:a1')).toBe('S3cret-Pa$$w0rd!')
    expect(readFileSync(path, 'utf8')).not.toContain('S3cret')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    // A new instance (a restart) finds the same values.
    expect(new FileVault(path, encryptor()).get('account:a1')).toBe('S3cret-Pa$$w0rd!')
  })

  it('replaces and deletes a value, leaving the others', () => {
    const vault = new FileVault(join(dir, 'vault.bin'), encryptor())
    vault.set('a', '1')
    vault.set('b', '2')
    vault.set('a', '3')
    expect(vault.get('a')).toBe('3')
    vault.delete('a')
    expect(vault.has('a')).toBe(false)
    expect(vault.get('b')).toBe('2')
    vault.delete('never-there')
  })

  it('stores and reveals nothing when the keychain cannot encrypt', () => {
    const path = join(dir, 'vault.bin')
    const vault = new FileVault(path, encryptor(false))
    expect(vault.available()).toBe(false)
    expect(() => vault.set('a', 'x')).toThrow(/not available/)
    expect(vault.has('a')).toBe(false)
    expect(vault.get('a')).toBeNull()
    expect(() => readFileSync(path)).toThrow()
  })

  it('treats a value this keychain cannot open as missing, and an unreadable file as empty', () => {
    const path = join(dir, 'vault.bin')
    new FileVault(path, encryptor()).set('a', 'x')
    const other: Encryptor = { ...encryptor(), decryptString: () => { throw new Error('wrong key') } }
    expect(new FileVault(path, other).get('a')).toBeNull()

    writeFileSync(path, 'not json at all')
    const vault = new FileVault(path, encryptor())
    expect(vault.has('a')).toBe(false)
    vault.set('b', 'y')
    expect(new FileVault(path, encryptor()).get('b')).toBe('y')
  })

  it('does not trust the shape of a file: only its own values object is read', () => {
    const path = join(dir, 'vault.bin')
    writeFileSync(path, JSON.stringify({ version: 1, values: { __proto__: 'x', a: 5 } }))
    const vault = new FileVault(path, encryptor())
    expect(vault.get('a')).toBeNull()
    expect(vault.get('toString')).toBeNull()
    expect(vault.has('constructor')).toBe(false)
  })
})

describe('TimedClipboard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function clipboard(initial = '') {
    const state = { text: initial }
    return { state, api: { writeText: (t: string) => void (state.text = t), readText: async () => state.text } }
  }

  it('clears what it copied after the time is up', async () => {
    const { state, api } = clipboard()
    new TimedClipboard(api).copy('secret', 30_000)
    expect(state.text).toBe('secret')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(state.text).toBe('secret')
    await vi.advanceTimersByTimeAsync(2)
    expect(state.text).toBe('')
  })

  it('leaves the clipboard alone if the owner copied something else meanwhile', async () => {
    const { state, api } = clipboard()
    new TimedClipboard(api).copy('secret', 30_000)
    state.text = 'something else the owner copied'
    await vi.advanceTimersByTimeAsync(31_000)
    expect(state.text).toBe('something else the owner copied')
  })

  it('a second copy restarts the time', async () => {
    const { state, api } = clipboard()
    const board = new TimedClipboard(api)
    board.copy('one', 30_000)
    await vi.advanceTimersByTimeAsync(20_000)
    board.copy('two', 30_000)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(state.text).toBe('two')
    await vi.advanceTimersByTimeAsync(11_000)
    expect(state.text).toBe('')
  })
})
