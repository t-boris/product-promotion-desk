// The owner's star on a post of the Feed (findings.setStarred) and the posts the AI starts starred: the ones it calls worth a reply.

import { afterEach, describe, expect, it } from 'vitest'
import type { ApiEvent } from '../../shared/api'
import { newId } from '../db/database'
import { FindingStore } from './findings'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const starredAt = (id: string): string | null => (world.core.db.prepare('SELECT starred_at AS at FROM findings WHERE id = ?').get(id) as { at: string | null }).at
const latestId = (): string => (world.core.db.prepare('SELECT id FROM findings ORDER BY rowid DESC LIMIT 1').get() as { id: string }).id

const watched = (url: string, relation: string): string => {
  new FindingStore(world.core).addWatched(
    world.product.id,
    world.channel.id,
    { url, title: `Title ${url}`, author: 'poster', label: 'notice', relation, about: '', thread: '', replyTo: '', comment: '', comments: [], analysis: '', topics: [], images: [], own: false, replies: null, score: null },
    false
  )
  return latestId()
}

describe('the star', () => {
  it('starts on a post the AI calls worth a reply, and not on one it only noted', () => {
    world = makeWorld()
    const reply = watched('https://www.reddit.com/r/x/comments/1', 'Worth a reply: asks for a tool like ours.')
    const noted = watched('https://www.reddit.com/r/x/comments/2', 'Relates to the goal.')
    expect(starredAt(reply)).toBe(world.clock.now().toISOString())
    expect(starredAt(noted)).toBeNull()
  })

  it('is put on and taken off by the owner, and shows in what the Feed lists', async () => {
    world = makeWorld()
    const id = watched('https://www.reddit.com/r/x/comments/2', 'Relates to the goal.')
    await world.core.router.call('findings.setStarred', { id, starred: true })
    expect(starredAt(id)).not.toBeNull()
    const listed = await world.core.router.call('findings.list', { productId: world.product.id })
    expect(listed.find((c) => c.finding.id === id)?.finding.starredAt).not.toBeNull()
    await world.core.router.call('findings.setStarred', { id, starred: false })
    expect(starredAt(id)).toBeNull()
    const again = await world.core.router.call('findings.list', { productId: world.product.id })
    expect(again.find((c) => c.finding.id === id)?.finding.starredAt).toBeNull()
  })

  it('is the owner\'s mark: it does not move the time of the AI\'s judgment, nor mark the post seen', async () => {
    world = makeWorld()
    const id = watched('https://www.reddit.com/r/x/comments/2', 'Relates to the goal.')
    const before = world.core.db.prepare('SELECT updated_at AS at, seen_at AS seen FROM findings WHERE id = ?').get(id)
    world.clock.advance(3_600_000)
    await world.core.router.call('findings.setStarred', { id, starred: true })
    expect(world.core.db.prepare('SELECT updated_at AS at, seen_at AS seen FROM findings WHERE id = ?').get(id)).toEqual(before)
  })

  it('is refused for a post that is not there, and for an answer that is not yes or no', async () => {
    world = makeWorld()
    const id = watched('https://www.reddit.com/r/x/comments/2', 'Relates to the goal.')
    await expect(world.core.router.call('findings.setStarred', { id: newId(), starred: true })).rejects.toMatchObject({ code: 'not_found' })
    await expect(world.core.router.call('findings.setStarred', { id: '', starred: true })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(world.core.router.call('findings.setStarred', { id, starred: 'yes' as unknown as boolean })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(starredAt(id)).toBeNull()
  })

  it('tells the screens the findings changed', async () => {
    world = makeWorld()
    const id = watched('https://www.reddit.com/r/x/comments/2', 'Relates to the goal.')
    const events: ApiEvent[] = []
    world.core.events.subscribe((event) => events.push(event))
    await world.core.router.call('findings.setStarred', { id, starred: true })
    expect(events.filter((e) => e.type === 'changed' && e.scope === 'opportunities')).toHaveLength(1)
  })

  it('is not on a post of the account\'s own until something records one: no post is own by default', () => {
    world = makeWorld()
    const id = watched('https://www.reddit.com/r/x/comments/3', 'Relates to the goal.')
    expect((world.core.db.prepare('SELECT is_own AS own FROM findings WHERE id = ?').get(id) as { own: number }).own).toBe(0)
  })
})
