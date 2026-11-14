import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecretOpenError } from '../core/ports'
import { FileVault, TimedClipboard, type Encryptor } from './vault'

/** What an earlier version wrote: the synchronous `encryptString` of Electron. */
const legacyEncrypt = (plain: string): Buffer => Buffer.from(`enc:${[...plain].reverse().join('')}`)

/**
 * A reversible "encryption" for the test, so that the file must never contain the plain value whatever the algorithm is. It models both
 * of Electron's APIs the way its documentation promises: the asynchronous one writes its own format and opens both its own and what the
 * synchronous `encryptString` wrote. `calls` is a spy: every question to the keychain lands in it, in order.
 */
function encryptor(options: { available?: boolean; failAvailability?: boolean } = {}): Encryptor & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isAsyncEncryptionAvailable: async () => {
      calls.push('isAsyncEncryptionAvailable')
      if (options.failAvailability) throw new Error('the keychain did not answer')
      return options.available ?? true
    },
    encryptStringAsync: async (plain) => {
      calls.push('encryptStringAsync')
      return Buffer.from(`asy:${[...plain].reverse().join('')}`)
    },
    decryptStringAsync: async (data) => {
      calls.push('decryptStringAsync')
      const text = data.toString()
      if (!text.startsWith('asy:') && !text.startsWith('enc:')) throw new Error('not ours')
      return { shouldReEncrypt: false, result: [...text.slice(4)].reverse().join('') }
    }
  }
}

const fileOf = (values: Record<string, string>): string => JSON.stringify({ version: 1, values })
const rejection = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => null, (error: unknown) => error)

describe('FileVault', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ppd-vault-'))
  })

  it('keeps values encrypted in a file only the owner can read, and reads them back', async () => {
    const path = join(dir, 'vault.bin')
    const vault = new FileVault(path, encryptor())
    await vault.set('account:a1', 'S3cret-Pa$$w0rd!')
    expect(vault.has('account:a1')).toBe(true)
    expect(await vault.get('account:a1')).toBe('S3cret-Pa$$w0rd!')
    expect(readFileSync(path, 'utf8')).not.toContain('S3cret')
    expect(statSync(path).mode & 0o777).toBe(0o600)
    // A new instance (a restart) finds the same values.
    expect(await new FileVault(path, encryptor()).get('account:a1')).toBe('S3cret-Pa$$w0rd!')
  })

  it('replaces and deletes a value, leaving the others', async () => {
    const vault = new FileVault(join(dir, 'vault.bin'), encryptor())
    await vault.set('a', '1')
    await vault.set('b', '2')
    await vault.set('a', '3')
    expect(await vault.get('a')).toBe('3')
    vault.delete('a')
    expect(vault.has('a')).toBe(false)
    expect(await vault.get('b')).toBe('2')
    vault.delete('never-there')
  })

  it('does not lose a value when two saves overlap', async () => {
    const path = join(dir, 'vault.bin')
    const vault = new FileVault(path, encryptor())
    await Promise.all([vault.set('a', '1'), vault.set('b', '2'), vault.set('c', '3')])
    const reopened = new FileVault(path, encryptor())
    expect([await reopened.get('a'), await reopened.get('b'), await reopened.get('c')]).toEqual(['1', '2', '3'])
  })

  it('still reads a vault file written by the synchronous API of an earlier version, and keeps it when a new value is saved', async () => {
    const path = join(dir, 'vault.bin')
    writeFileSync(path, fileOf({ 'account:old': legacyEncrypt('Old-Pa$$w0rd').toString('base64') }))
    const vault = new FileVault(path, encryptor())
    expect(await vault.get('account:old')).toBe('Old-Pa$$w0rd')
    await vault.set('account:new', 'New-Pa$$w0rd')
    const reopened = new FileVault(path, encryptor())
    expect(await reopened.get('account:old')).toBe('Old-Pa$$w0rd')
    expect(await reopened.get('account:new')).toBe('New-Pa$$w0rd')
  })

  it('stores nothing when the keychain cannot encrypt, and says why only after something asked', async () => {
    const path = join(dir, 'vault.bin')
    const refusing = encryptor({ available: false })
    const vault = new FileVault(path, refusing, 'darwin')
    expect(vault.blocked()).toBeNull()
    expect(refusing.calls).toEqual([])
    expect(await vault.available()).toBe(false)
    expect(vault.blocked()).toBe('refused')
    await expect(vault.set('a', 'x')).rejects.toThrow(/not available/)
    expect(vault.has('a')).toBe(false)
    expect(await vault.get('a')).toBeNull()
    expect(() => readFileSync(path)).toThrow()
  })

  it('blames the keychain only on a Mac: elsewhere there is none, and a keychain that cannot be asked is a "no"', async () => {
    const elsewhere = new FileVault(join(dir, 'a.bin'), encryptor({ available: false }), 'linux')
    expect(await elsewhere.available()).toBe(false)
    expect(elsewhere.blocked()).toBe('no_keychain')
    const silent = new FileVault(join(dir, 'b.bin'), encryptor({ failAvailability: true }), 'darwin')
    expect(await silent.available()).toBe(false)
    expect(silent.blocked()).toBe('refused')
  })

  it('forgets a refusal when the keychain answers yes the next time', async () => {
    let answer = false
    const vault = new FileVault(join(dir, 'vault.bin'), { ...encryptor(), isAsyncEncryptionAvailable: async () => answer }, 'darwin')
    await vault.available()
    expect(vault.blocked()).toBe('refused')
    answer = true
    expect(await vault.available()).toBe(true)
    expect(vault.blocked()).toBeNull()
  })

  it('says a saved value cannot be opened, with the reason, instead of "no value"', async () => {
    const path = join(dir, 'vault.bin')
    await new FileVault(path, encryptor()).set('a', 'x')

    // The keychain refuses the app: the value is there, so the answer is not null.
    const refused = new FileVault(path, encryptor({ available: false }), 'darwin')
    expect(refused.has('a')).toBe(true)
    const error = await rejection(refused.get('a'))
    expect(error).toBeInstanceOf(SecretOpenError)
    expect((error as SecretOpenError).blocked).toBe('refused')

    // The keychain answers but holds another key: nothing blocks the vault, only this value cannot be read.
    const other: Encryptor = { ...encryptor(), decryptStringAsync: async () => { throw new Error('wrong key') } }
    const unreadable = await rejection(new FileVault(path, other).get('a'))
    expect(unreadable).toBeInstanceOf(SecretOpenError)
    expect((unreadable as SecretOpenError).blocked).toBeNull()
  })

  it('treats an unreadable file as empty and replaces it with the next save', async () => {
    const path = join(dir, 'vault.bin')
    writeFileSync(path, 'not json at all')
    const vault = new FileVault(path, encryptor())
    expect(vault.has('a')).toBe(false)
    expect(await vault.get('a')).toBeNull()
    await vault.set('b', 'y')
    expect(await new FileVault(path, encryptor()).get('b')).toBe('y')
  })

  it('does not trust the shape of a file: only its own values object is read', async () => {
    const path = join(dir, 'vault.bin')
    writeFileSync(path, JSON.stringify({ version: 1, values: { __proto__: 'x', a: 5 } }))
    const vault = new FileVault(path, encryptor())
    expect(await vault.get('a')).toBeNull()
    expect(await vault.get('toString')).toBeNull()
    expect(vault.has('constructor')).toBe(false)
  })

  it('never calls the keychain to say whether a password is saved, what is blocked or to forget one (BUG-041)', async () => {
    const path = join(dir, 'vault.bin')
    writeFileSync(path, fileOf({ 'account:a1': legacyEncrypt('x').toString('base64'), 'account:a2': legacyEncrypt('y').toString('base64') }))
    const spy = encryptor()
    const vault = new FileVault(path, spy)
    expect(vault.has('account:a1')).toBe(true)
    expect(vault.has('account:none')).toBe(false)
    expect(vault.blocked()).toBeNull()
    expect(await vault.get('account:none')).toBeNull()
    vault.delete('account:a2')
    expect(vault.has('account:a2')).toBe(false)
    expect(spy.calls).toEqual([])
  })

  it('calls the keychain when a value is opened or saved, and only then', async () => {
    const path = join(dir, 'vault.bin')
    writeFileSync(path, fileOf({ 'account:a1': legacyEncrypt('x').toString('base64') }))
    const spy = encryptor()
    const vault = new FileVault(path, spy)
    expect(await vault.get('account:a1')).toBe('x')
    expect(spy.calls).toEqual(['isAsyncEncryptionAvailable', 'decryptStringAsync'])
    spy.calls.length = 0
    await vault.set('account:a2', 'y')
    expect(spy.calls).toEqual(['isAsyncEncryptionAvailable', 'encryptStringAsync'])
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
