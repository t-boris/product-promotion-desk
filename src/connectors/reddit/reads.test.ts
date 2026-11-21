// DEC-045: what Reddit says about reading a community. It refuses the post list to a client that is not its own application; then the app cannot read
// the community itself and the AI watches it in the browser. Anything short of a refusal leaves it read through Reddit as before.

import { describe, expect, it } from 'vitest'
import type { Capability, Channel } from '../../shared/types'
import { RedditConnector } from './connector'

const connector = new RedditConnector({ sleep: async () => undefined, pacingMs: 0 })
const channelWith = (...capabilities: Pick<Capability, 'key' | 'status'>[]): Channel => ({ capabilities: capabilities.map((c) => ({ detail: '', checkedAt: null, ...c })) }) as unknown as Channel

describe('RedditConnector.readsChannel', () => {
  it('a community whose post list was refused is not read by the app', () => {
    expect(connector.readsChannel(channelWith({ key: 'read_posts', status: 'unavailable' }))).toBe(false)
    expect(connector.readsChannel(channelWith({ key: 'read_posts', status: 'restricted' }))).toBe(false)
  })

  it('a community that was never assessed, or whose list was read, or only could not be tried, is read as before', () => {
    expect(connector.readsChannel(channelWith())).toBe(true)
    expect(connector.readsChannel(channelWith({ key: 'read_posts', status: 'verified' }))).toBe(true)
    expect(connector.readsChannel(channelWith({ key: 'read_posts', status: 'needs_check' }))).toBe(true)
    expect(connector.readsChannel(channelWith({ key: 'read_comments', status: 'unavailable' }))).toBe(true)
  })
})
