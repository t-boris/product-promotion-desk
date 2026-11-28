// The inbox ability of a channel (DEC-039): a connector with no inbox is shown as unavailable, with the reason, whatever it says about it.

import { describe, expect, it } from 'vitest'
import type { Capability, CapabilityKey, Channel } from '../../shared/types'
import { FakeConnector } from '../testing/fake-connector'
import { NO_INBOX_REASON, blankCapabilities, normalizeAssessment, withInboxVerdict } from './capabilities'
import { makeReadyWorld, type World } from './test-helpers'

const AT = '2026-11-15T10:00:00.000Z'
const cap = (key: CapabilityKey, status: Capability['status'], detail = 'x'): Capability => ({ key, status, detail, checkedAt: AT })
const get = (list: Capability[], key: CapabilityKey): Capability => list.find((c) => c.key === key) as Capability

async function connected(fake: FakeConnector): Promise<{ w: World; channel: Channel }> {
  const w = await makeReadyWorld({ fake })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
  return { w, channel }
}

describe('withInboxVerdict', () => {
  it('leaves the list alone when the connector can read an inbox', () => {
    const list = normalizeAssessment(blankCapabilities(), [cap('read_inbox', 'verified', 'readable')], AT)
    expect(withInboxVerdict(list, true, AT)).toBe(list)
  })

  it('shows the inbox as unavailable, with the fixed reason, when it cannot, whatever the connector said', () => {
    const list = normalizeAssessment(blankCapabilities(), [cap('read_inbox', 'verified', 'readable'), cap('read_posts', 'verified')], AT)
    const result = withInboxVerdict(list, false, AT)
    expect(get(result, 'read_inbox')).toEqual({ key: 'read_inbox', status: 'unavailable', detail: NO_INBOX_REASON, checkedAt: AT })
    expect(get(result, 'read_posts').status).toBe('verified') // nothing else is touched
    expect(result).toHaveLength(list.length)
  })

  it('keeps the connector\'s own reason when the connector itself says the inbox is unavailable', () => {
    // A Page or a profile worked through an API: replies are read as comments under the account's posts, and the general reason would deny it.
    const own = 'Replies arrive as replies to the account\'s posts.'
    const list = normalizeAssessment(blankCapabilities(), [cap('read_inbox', 'unavailable', own)], AT)
    expect(get(withInboxVerdict(list, false, AT), 'read_inbox')).toEqual({ key: 'read_inbox', status: 'unavailable', detail: own, checkedAt: AT })
    const silent = normalizeAssessment(blankCapabilities(), [cap('read_inbox', 'unavailable', ' ')], AT)
    expect(get(withInboxVerdict(silent, false, AT), 'read_inbox').detail).toBe(NO_INBOX_REASON)
  })
})

describe('channels.assess and the inbox', () => {
  it('reports a connector without an inbox as unavailable, with the reason, and the other abilities as they were', async () => {
    const fake = new FakeConnector()
    fake.readInbox = undefined
    const { w, channel } = await connected(fake)

    const assessed = await w.call('channels.assess', { channelId: channel.id })

    expect(get(assessed.capabilities, 'read_inbox')).toMatchObject({ status: 'unavailable', detail: NO_INBOX_REASON })
    expect(get(assessed.capabilities, 'read_posts').status).toBe('verified')
    expect(assessed.status).toBe('setup') // an unavailable inbox does not stop a channel from being set up
  })

  it('keeps what a connector with an inbox reports about it', async () => {
    const fake = new FakeConnector()
    fake.setCapability('read_inbox', 'needs_check', 'The inbox could not be read (HTTP 500).')
    const { w, channel } = await connected(fake)
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(get(assessed.capabilities, 'read_inbox')).toMatchObject({ status: 'needs_check', detail: 'The inbox could not be read (HTTP 500).' })
  })

  it('says it was not reported when the connector leaves it out', async () => {
    const fake = new FakeConnector()
    fake.capabilities = fake.capabilities.filter((c) => c.key !== 'read_inbox')
    const { w, channel } = await connected(fake)
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(get(assessed.capabilities, 'read_inbox')).toMatchObject({ status: 'needs_check', detail: 'The connector did not report this capability.' })
  })

  it('does not stop a channel from being read when only the inbox is unavailable', async () => {
    const fake = new FakeConnector()
    fake.readInbox = undefined
    const { w, channel } = await connected(fake)
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    expect(get(assessed.capabilities, 'read_posts').status).toBe('verified')
    expect(get(assessed.capabilities, 'read_comments').status).toBe('verified')
  })
})
