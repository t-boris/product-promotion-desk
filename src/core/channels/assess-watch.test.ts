// DEC-042: an assessment that lets a suspended channel carry on must not park a watched channel as one for own posts only: it is looked at, so it has
// nothing to say about itself. A channel of a platform that is not watched is parked as before (DEC-034).

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

  it('carries on as a channel for own posts only when its platform is not watched', async () => {
    expect(await suspended('web')).toEqual({ detail: 'Your own posts only.', status: 'active', reads: false })
  })
})
