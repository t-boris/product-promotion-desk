import { describe, expect, it } from 'vitest'
import { pollUntil, withTimeout } from './poll'

function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

describe('pollUntil', () => {
  it('returns true as soon as the check passes', async () => {
    const c = clock()
    let calls = 0
    expect(await pollUntil(async () => ++calls === 3, { timeoutMs: 1000, intervalMs: 100, ...c })).toBe(true)
    expect(calls).toBe(3)
  })

  it('gives up after the timeout and checks at least once', async () => {
    const c = clock()
    let calls = 0
    expect(await pollUntil(async () => (calls++, false), { timeoutMs: 250, intervalMs: 100, ...c })).toBe(false)
    expect(calls).toBe(4) // t = 0, 100, 200, 250
    expect(await pollUntil(async () => true, { timeoutMs: 0, intervalMs: 100, ...c })).toBe(true)
  })

  it('does not swallow errors thrown by the check', async () => {
    await expect(pollUntil(async () => Promise.reject(new Error('boom')), { timeoutMs: 100, intervalMs: 10, ...clock() })).rejects.toThrow('boom')
  })
})

describe('withTimeout', () => {
  it('passes the result through and rejects a slow task', async () => {
    expect(await withTimeout(Promise.resolve(7), 50, 'late')).toBe(7)
    await expect(withTimeout(new Promise(() => undefined), 10, 'too slow')).rejects.toThrow('too slow')
  })
})
