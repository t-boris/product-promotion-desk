// DEC-042, DEC-045: an assessment that lets a suspended channel carry on must not park a watched channel as one for own posts only: it is looked at, so it has
// nothing to say about itself. Every channel the app does not read is watched, on any platform or site.

import { describe, expect, it } from 'vitest'
import { makeReadyWorld } from './test-helpers'

async function suspended(platform: string): Promise<{ detail: string; status: string; reads: boolean }> {
  const w = await makeReadyWorld()
  w.fake.canRead = false
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
  w.core.db.prepare("UPDATE channels SET platform = ?, status = 'needs_user', status_detail = 'The account needs you.', reads = 0 WHERE id = ?").run(platform, channel.id)
  const assessed = await w.call('channels.assess', { channelId: channel.id })
  return { detail: assessed.statusDetail, status: assessed.status, reads: assessed.reads }
}

describe('channels.assess: a channel that was waiting for the owner', () => {
  it.each(['instagram', 'facebook', 'threads', 'x', 'linkedin'])('carries on as active, with nothing to say about itself, when %s is watched in the browser', async (platform) => {
    expect(await suspended(platform)).toEqual({ detail: '', status: 'active', reads: false })
  })

  it('does the same on a platform the app has no list for (any site is watched in the browser, DEC-045)', async () => {
    expect(await suspended('web')).toEqual({ detail: '', status: 'active', reads: false })
  })
})
