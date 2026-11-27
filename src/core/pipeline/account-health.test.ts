// Account health (DEC-064).
import { afterEach, describe, expect, it } from 'vitest'
import type { SendingService } from '../services'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const DAY = 86_400_000

async function sentPost(text: string, likes: number | null): Promise<void> {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'A post', text } })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  const action = await (world.core.services.sending as SendingService).send(opportunity.id)
  if (likes !== null) world.core.db.prepare('UPDATE send_actions SET likes = ?, numbers_read_at = ? WHERE id = ?').run(likes, world.clock.now().toISOString(), action.id)
  world.clock.advance(DAY)
}

describe('account health', () => {
  it('counts what the account sent in thirty days and how much of it carries the product\'s site, and compares the latest posts with the ones before', async () => {
    world = makeWorld()
    world.core.db.prepare("UPDATE products SET website_url = 'https://natalmystic.test', add_site_link = 0 WHERE id = ?").run(world.product.id)
    const accountId = world.channel.accountId
    expect(await world.core.router.call('accounts.health', { accountId })).toMatchObject({ days: 30, posts: { sent: 0, withLink: 0 }, replies: { sent: 0, withLink: 0 } })

    for (const likes of [20, 30, 10]) await sentPost('Just words.', likes)
    await sentPost('See natalmystic.test for the chart.', 4)
    await sentPost('Words again.', 6)
    await sentPost('And again.', 5)
    const view = await world.core.router.call('accounts.health', { accountId })
    expect(view.posts).toEqual({ sent: 6, withLink: 1 })
    expect(view.replies).toEqual({ sent: 0, withLink: 0 })
    expect(view.reach).toEqual([{ channelId: world.channel.id, target: world.channel.target, platform: world.channel.platform, posts: 6, recent: 5, usual: 20, standing: 'fell' }])

    // What was sent more than thirty days ago leaves the share; the reach still knows the posts.
    world.clock.advance(26 * DAY - 3_600_000)
    const later = await world.core.router.call('accounts.health', { accountId })
    expect(later.posts).toEqual({ sent: 4, withLink: 1 })
    expect(later.reach[0]).toMatchObject({ posts: 6, standing: 'fell' })
    await expect(world.core.router.call('accounts.health', { accountId: 'nobody' })).rejects.toMatchObject({ code: 'not_found' })
  })
})
