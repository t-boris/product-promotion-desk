import type { Capability, CapabilityKey, CapabilityStatus } from '../shared/types'

// Declared as a record so adding a key to the CapabilityKey union fails to compile until it is listed here.
const KEYS: Record<CapabilityKey, null> = {
  read_posts: null,
  read_comments: null,
  detect_changes: null,
  publish_post: null,
  publish_reply: null,
  verify_send: null,
  metrics: null,
  rules: null
}

export const CAPABILITY_KEYS = Object.keys(KEYS) as CapabilityKey[]

/**
 * Collects the outcome of an assessment. Every key is always present in the result, and a key nobody
 * assessed stays 'needs_check' (never 'verified'): silence is not evidence (REQ-002).
 */
export class CapabilityBuilder {
  private readonly items = new Map<CapabilityKey, Capability>()
  private readonly checkedAt: string

  constructor(at: Date) {
    this.checkedAt = at.toISOString()
  }

  set(key: CapabilityKey, status: CapabilityStatus, detail: string): this {
    this.items.set(key, { key, status, detail, checkedAt: this.checkedAt })
    return this
  }

  has(key: CapabilityKey): boolean {
    return this.items.has(key)
  }

  /** Sets every key that has no entry yet. */
  fillRemaining(status: CapabilityStatus, detail: string): this {
    for (const key of CAPABILITY_KEYS) if (!this.items.has(key)) this.set(key, status, detail)
    return this
  }

  build(): Capability[] {
    return CAPABILITY_KEYS.map((key) => this.items.get(key) ?? { key, status: 'needs_check', detail: 'Not assessed.', checkedAt: this.checkedAt })
  }
}
