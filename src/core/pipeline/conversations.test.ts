// Conversations (DEC-063): "a post took off" in the Inbox, and how long a comment to the account has waited.
import { afterEach, describe, expect, it } from 'vitest'
import type { Opportunity } from '../../shared/types'
import type { SendingService } from '../services'
import { waitedNoteFor } from './conversations'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const DAY = 86_400_000

async function sentPost(title: string, likes: number | null, comments: number | null): Promise<string> {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: 'A post of my own.' } })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  const action = await (world.core.services.sending as SendingService).send(opportunity.id)
  if (likes !== null || comments !== null) world.core.db.prepare('UPDATE send_actions SET likes = ?, comments = ?, numbers_read_at = ? WHERE id = ?').run(likes, comments, world.clock.now().toISOString(), action.id)
  return action.id
}
const tookOff = async () => (await world.core.router.call('attention.list', undefined)).filter((item) => item.id.startsWith('tookoff:'))

describe('a post that took off', () => {
  it('is an Inbox item of its own while it is fresh, measured against the channel\'s own earlier posts', async () => {
    world = makeWorld()
    // With fewer than three earlier posts the usual is unknown: nothing is said, whatever the numbers.
    await sentPost('one', 10, 2)
    world.clock.advance(5 * DAY)
    await sentPost('two', 20, 3)
    world.clock.advance(5 * DAY)
    const early = await sentPost('three', 400, 90)
    expect(await tookOff()).toEqual([])
    world.clock.advance(5 * DAY)
    world.core.db.prepare('UPDATE send_actions SET likes = 30, comments = 4 WHERE id = ?').run(early)

    // The usual is now 20 points and 3 comments. An ordinary post says nothing; one at twice the usual does.
    await sentPost('ordinary', 25, 4)
    expect(await tookOff()).toEqual([])
    world.clock.advance(3_600_000)
    const hit = await sentPost('hit', 61, 5)
    const items = await tookOff()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: `tookoff:${hit}`, kind: 'question', refType: 'channel', refId: world.channel.id, title: `A post took off in ${world.channel.target}` })
    expect(items[0]!.detail).toContain('61 ')
    expect(items[0]!.detail).toContain('(usual 21)')
    expect(items[0]!.detail).not.toContain('comment')

    // Four days after the post the note is gone by itself.
    world.clock.advance(4 * DAY + 3_600_000)
    expect(await tookOff()).toEqual([])
  })
})

describe('a comment addressed to the account', () => {
  it('says how long it has waited once that is half a day, and nothing for a comment that is not addressed to the account', () => {
    world = makeWorld()
    const now = world.clock.now().getTime()
    const db = world.core.db
    db.prepare("INSERT INTO discussions (id, channel_id, external_id, title, url, author, body, first_seen_at, last_seen_at) VALUES ('d1', ?, 'd1', 'A post', 'https://fake.test/d1', 'someone', '', ?, ?)").run(world.channel.id, world.clock.now().toISOString(), world.clock.now().toISOString())
    const comment = (id: string, hoursAgo: number): void => {
      db.prepare("INSERT INTO comments (id, discussion_id, channel_id, external_id, author, body, url, posted_at, content_hash, first_seen_at, last_seen_at) VALUES (?, 'd1', ?, ?, 'someone', 'A question to you', 'https://fake.test/c', ?, 'h', ?, ?)").run(
        id,
        world.channel.id,
        id,
        new Date(now - hoursAgo * 3_600_000).toISOString(),
        world.clock.now().toISOString(),
        world.clock.now().toISOString()
      )
    }
    comment('c-fresh', 3)
    comment('c-day', 30)
    comment('c-late', 80)
    const opp = (commentId: string, source: string): Opportunity => ({ commentId, source }) as Opportunity
    expect(waitedNoteFor(world.core, opp('c-fresh', 'reply_to_me'))).toBe('')
    expect(waitedNoteFor(world.core, opp('c-day', 'reply_to_me'))).toMatch(/^Has waited 30 hours/)
    expect(waitedNoteFor(world.core, opp('c-late', 'mention'))).toMatch(/^Has waited 3 days/)
    expect(waitedNoteFor(world.core, opp('c-day', 'comment'))).toBe('')
    expect(waitedNoteFor(world.core, opp('gone', 'reply_to_me'))).toBe('')
  })
})
