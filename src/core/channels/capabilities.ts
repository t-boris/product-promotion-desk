// Capability bookkeeping for channels (SRC-001 section 3, REQ-002). Pure functions.
//
// The central rule: a sending ability (publish a post, publish a reply, verify a send) is 'verified' only after an
// actual authorized send confirmed it (markCapabilityVerified). Onboarding never publishes test messages, so an
// assessment can at best say "needs_check" about them - whatever a connector claims.

import type { Capability, CapabilityKey, CapabilityStatus, IsoTime } from '../../shared/types'

// Typed as a record so that adding a CapabilityKey without listing it here breaks the build.
const KEY_TABLE: Record<CapabilityKey, null> = {
  read_posts: null,
  read_comments: null,
  detect_changes: null,
  publish_post: null,
  publish_reply: null,
  verify_send: null,
  metrics: null,
  rules: null
}
export const CAPABILITY_KEYS = Object.keys(KEY_TABLE) as CapabilityKey[]

/** Abilities that only an actual authorized send can prove. */
export const SENDING_KEYS: readonly CapabilityKey[] = ['publish_post', 'publish_reply', 'verify_send']

const STATUSES: readonly CapabilityStatus[] = ['verified', 'needs_check', 'needs_user', 'unavailable', 'restricted']

const isSendingKey = (key: CapabilityKey): boolean => SENDING_KEYS.includes(key)

export const NOT_ASSESSED = 'Not assessed yet.'
export const CONFIRMED_BY_FIRST_SEND = 'It is confirmed only by the first authorized send.'

/** Nothing is known about a new channel: every capability requires verification. */
export function blankCapabilities(): Capability[] {
  return CAPABILITY_KEYS.map((key) => ({ key, status: 'needs_check', detail: NOT_ASSESSED, checkedAt: null }))
}

/**
 * Every capability waits for a person (sign in, solve a check). Proof from an earlier authorized send stays: being
 * signed out today does not undo a send that was confirmed yesterday, and the account status says what is wrong.
 */
export function blockedCapabilities(previous: Capability[], detail: string, at: IsoTime): Capability[] {
  return CAPABILITY_KEYS.map((key): Capability => {
    const prior = find(previous, key)
    if (isSendingKey(key) && prior?.status === 'verified') return prior
    return { key, status: 'needs_user', detail, checkedAt: at }
  })
}

export function find(capabilities: Capability[], key: CapabilityKey): Capability | undefined {
  return capabilities.find((c) => c.key === key)
}

export function statusOf(capabilities: Capability[], key: CapabilityKey): CapabilityStatus | null {
  return find(capabilities, key)?.status ?? null
}

/**
 * Turns a connector's assessment into the stored capability list: all keys present, nothing claimed that was not
 * observed. `previous` carries proof from earlier authorized sends, which a later read-only check cannot disprove.
 */
export function normalizeAssessment(previous: Capability[], assessed: Capability[], at: IsoTime): Capability[] {
  return CAPABILITY_KEYS.map((key): Capability => {
    const reported = find(assessed, key)
    const prior = find(previous, key)
    const provenBySend = isSendingKey(key) && prior?.status === 'verified'

    let status: CapabilityStatus = reported && STATUSES.includes(reported.status) ? reported.status : 'needs_check'
    let detail = typeof reported?.detail === 'string' ? reported.detail.trim() : ''
    if (!reported) detail = 'The connector did not report this capability.'

    if (isSendingKey(key) && status === 'verified') {
      if (provenBySend && prior) return prior
      status = 'needs_check'
      detail = `${detail ? `${detail.replace(/\s*$/, '')} ` : ''}${CONFIRMED_BY_FIRST_SEND}`
    }
    // A form that merely loads says nothing against an ability a real send already proved.
    if (provenBySend && prior && status === 'needs_check') return prior

    return { key, status, detail, checkedAt: at }
  })
}

/** The result of an actual authorized use: the one way a sending ability becomes 'verified'. */
export function withVerified(capabilities: Capability[], key: CapabilityKey, detail: string, at: IsoTime): Capability[] {
  const base = capabilities.length > 0 ? capabilities : blankCapabilities()
  const updated: Capability = { key, status: 'verified', detail, checkedAt: at }
  return base.some((c) => c.key === key) ? base.map((c) => (c.key === key ? updated : c)) : [...base, updated]
}

export function countByStatus(capabilities: Capability[]): Record<CapabilityStatus, number> {
  const counts: Record<CapabilityStatus, number> = { verified: 0, needs_check: 0, needs_user: 0, unavailable: 0, restricted: 0 }
  for (const c of capabilities) counts[c.status] += 1
  return counts
}

export function summarize(capabilities: Capability[]): string {
  const counts = countByStatus(capabilities)
  const parts: string[] = []
  if (counts.verified) parts.push(`${counts.verified} verified`)
  if (counts.needs_check) parts.push(`${counts.needs_check} need checking`)
  if (counts.needs_user) parts.push(`${counts.needs_user} need you`)
  if (counts.restricted) parts.push(`${counts.restricted} restricted by rules`)
  if (counts.unavailable) parts.push(`${counts.unavailable} unavailable`)
  return parts.join(', ')
}
