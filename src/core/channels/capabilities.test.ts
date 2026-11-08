import { describe, expect, it } from 'vitest'
import type { Capability, CapabilityKey, CapabilityStatus } from '../../shared/types'
import { blankCapabilities, blockedCapabilities, CAPABILITY_KEYS, CONFIRMED_BY_FIRST_SEND, normalizeAssessment, summarize, withVerified } from './capabilities'

const AT = '2026-11-08T12:00:00.000Z'
const EARLIER = '2026-11-01T09:00:00.000Z'

const cap = (key: CapabilityKey, status: CapabilityStatus, detail = `${key} detail`, checkedAt: string | null = AT): Capability => ({ key, status, detail, checkedAt })
const all = (status: CapabilityStatus): Capability[] => CAPABILITY_KEYS.map((key) => cap(key, status))
const get = (list: Capability[], key: CapabilityKey): Capability => {
  const found = list.find((c) => c.key === key)
  if (!found) throw new Error(`missing ${key}`)
  return found
}

describe('a new channel claims nothing', () => {
  it('has every capability, all needing verification, never checked', () => {
    const blank = blankCapabilities()
    expect(blank.map((c) => c.key)).toEqual(CAPABILITY_KEYS)
    expect(blank.every((c) => c.status === 'needs_check' && c.checkedAt === null)).toBe(true)
    expect(CAPABILITY_KEYS).toHaveLength(8)
  })
})

describe('assessment never claims sending abilities (REQ-002: no test publications)', () => {
  it('downgrades "verified" sending abilities to needs_check and says why', () => {
    const result = normalizeAssessment(blankCapabilities(), all('verified'), AT)
    for (const key of ['publish_post', 'publish_reply', 'verify_send'] as const) {
      expect(get(result, key).status).toBe('needs_check')
      expect(get(result, key).detail).toContain(CONFIRMED_BY_FIRST_SEND)
    }
  })

  it('keeps what was really observed: reading, change detection, metrics, rules', () => {
    const result = normalizeAssessment(blankCapabilities(), all('verified'), AT)
    for (const key of ['read_posts', 'read_comments', 'detect_changes', 'metrics', 'rules'] as const) {
      expect(get(result, key).status).toBe('verified')
    }
  })

  it('keeps unavailable, restricted and needs_user as reported', () => {
    const assessed = [cap('publish_post', 'restricted'), cap('publish_reply', 'unavailable'), cap('read_posts', 'needs_user')]
    const result = normalizeAssessment(blankCapabilities(), assessed, AT)
    expect(get(result, 'publish_post').status).toBe('restricted')
    expect(get(result, 'publish_reply').status).toBe('unavailable')
    expect(get(result, 'read_posts').status).toBe('needs_user')
  })

  it('stamps every capability with the time of this check and reports missing ones as needing a check', () => {
    const result = normalizeAssessment(blankCapabilities(), [cap('read_posts', 'verified')], AT)
    expect(result).toHaveLength(8)
    expect(result.every((c) => c.checkedAt === AT)).toBe(true)
    expect(get(result, 'metrics')).toMatchObject({ status: 'needs_check', detail: 'The connector did not report this capability.' })
  })

  it('does not accept a status that does not exist', () => {
    const bogus = [{ key: 'read_posts', status: 'great', detail: 'x', checkedAt: null } as unknown as Capability]
    expect(get(normalizeAssessment(blankCapabilities(), bogus, AT), 'read_posts').status).toBe('needs_check')
  })
})

describe('proof from real sends survives a read-only re-assessment', () => {
  const proven = withVerified(blankCapabilities(), 'publish_reply', 'Reply confirmed on r/test', EARLIER)

  it('keeps a verified reply ability when the connector says verified or merely needs_check', () => {
    for (const status of ['verified', 'needs_check'] as const) {
      const result = normalizeAssessment(proven, [cap('publish_reply', status)], AT)
      expect(get(result, 'publish_reply')).toEqual({ key: 'publish_reply', status: 'verified', detail: 'Reply confirmed on r/test', checkedAt: EARLIER })
    }
  })

  it('but yields to evidence against it: restricted, unavailable or needs_user', () => {
    for (const status of ['restricted', 'unavailable', 'needs_user'] as const) {
      expect(get(normalizeAssessment(proven, [cap('publish_reply', status)], AT), 'publish_reply').status).toBe(status)
    }
  })

  it('keeps proof while the account is signed out, but nothing else is claimed', () => {
    const blocked = blockedCapabilities(proven, 'Not signed in', AT)
    expect(get(blocked, 'publish_reply').status).toBe('verified')
    expect(blocked.filter((c) => c.status === 'needs_user')).toHaveLength(7)
    expect(get(blocked, 'read_posts')).toMatchObject({ status: 'needs_user', detail: 'Not signed in', checkedAt: AT })
  })
})

describe('markVerified and summary', () => {
  it('marks one capability verified by actual use', () => {
    const result = withVerified(blankCapabilities(), 'publish_post', 'Post confirmed', AT)
    expect(get(result, 'publish_post')).toEqual({ key: 'publish_post', status: 'verified', detail: 'Post confirmed', checkedAt: AT })
    expect(get(result, 'publish_reply').status).toBe('needs_check')
  })

  it('starts from a blank list when none was stored', () => {
    expect(withVerified([], 'publish_post', 'ok', AT)).toHaveLength(8)
  })

  it('summarizes by status in plain words', () => {
    const result = normalizeAssessment(blankCapabilities(), [cap('read_posts', 'verified'), cap('publish_post', 'restricted')], AT)
    expect(summarize(result)).toBe('1 verified, 6 need checking, 1 restricted by rules')
  })
})
