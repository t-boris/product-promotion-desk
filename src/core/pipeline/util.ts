// Small helpers shared by the discussion → draft → approval → sending flow.

import { createHash } from 'node:crypto'

export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Lower-cases and strips the "u/" / "@" decorations so "u/Brand_Account" equals "brand_account". */
export function normalizeIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\/?u\//, '')
    .replace(/^@/, '')
}

/**
 * Runs async work one at a time per key. Used per account so that limit checks, the attempt record and the
 * publication of one account never interleave (REQ-004: aggregate limits, no concurrent control).
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const mine = new Promise<void>((resolve) => (release = resolve))
    const tail = previous.then(() => mine)
    this.tails.set(key, tail)
    await previous
    try {
      return await work()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

export function minutesFrom(now: Date, minutes: number): string {
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}
