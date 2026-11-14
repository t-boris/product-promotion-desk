import { describe, expect, it } from 'vitest'
import { DEFAULT_WEB_PORT, parseWebPort, usablePort } from './web-port'

const REFUSAL = { ok: false, message: 'Use a port from 1024 to 65535' }

describe('parseWebPort', () => {
  it.each([
    ['1024', 1024],
    ['8080', 8080],
    ['47615', 47615],
    ['65535', 65535],
    ['  8080  ', 8080],
    ['08080', 8080]
  ])('accepts "%s"', (text, port) => {
    expect(parseWebPort(text)).toEqual({ ok: true, port })
  })

  it.each(['', '   ', 'abc', '8080abc', '80 80', '1e3', '+8080', '-8080', '80.5', '0x1F90', '８０８０', '000000'])('refuses "%s", which is not made of digits', (text) => {
    expect(parseWebPort(text)).toEqual(REFUSAL)
  })

  it.each(['0', '1', '80', '443', '1023', '65536', '99999'])('refuses "%s", which is outside 1024-65535', (text) => {
    expect(parseWebPort(text)).toEqual(REFUSAL)
  })
})

describe('usablePort: the port the server uses for a stored value', () => {
  it('keeps a stored port in range', () => {
    expect(usablePort(8080)).toBe(8080)
    expect(usablePort(1024)).toBe(1024)
    expect(usablePort(65535)).toBe(65535)
  })

  it('falls back to the default for anything the server could not listen on (a value stored by an older build)', () => {
    for (const stored of [99999, 65536, 1023, 80, 0, -1, 80.5, Number.NaN, Number.POSITIVE_INFINITY, 1e21, null, undefined, 'abc', {}]) {
      expect(usablePort(stored)).toBe(DEFAULT_WEB_PORT)
    }
  })

  it('reads a port that was stored as text', () => {
    expect(usablePort('8080')).toBe(8080)
  })
})
