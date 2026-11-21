// The findings of the AI triage as the Feed asks for them (DEC-040): findings.list, findings.counts and findings.markSeen.

import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import type { ApiEvent } from '../../shared/api'
import type { FindingLabel, FindingStage } from '../../shared/types'
import { newId } from '../db/database'
import { mapFinding } from '../repos'
import { FindingStore, POST_GONE, UNJUDGED_RELATION, UNREADABLE_RELATION } from './findings'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const DAY = 24 * 3_600_000

interface Seed {
  externalId: string
  label: FindingLabel | null
  stage?: FindingStage
  postedAt?: string | null
  createdAt?: string
  seen?: boolean
  productId?: string
  channelId?: string
  title?: string
  firstLook?: boolean
  relation?: string
}

const seed = (s: Seed): string => {
  const id = newId()
  const created = s.createdAt ?? world.clock.now().toISOString()
  world.core.db
    .prepare(
      `INSERT INTO findings (id, product_id, channel_id, external_id, title, url, author, posted_at, stage, label, relation, first_look, opportunity_id, seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'someone', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    )
    .run(
      id,
      s.productId ?? world.product.id,
      s.channelId ?? world.channel.id,
      s.externalId,
      s.title ?? `Title of ${s.externalId}`,
      `https://fake.test/${s.externalId}`,
      s.postedAt === undefined ? created : s.postedAt,
      s.stage ?? (s.label === null ? 'pending' : 'read'),
      s.label,
      s.relation ?? `Relation of ${s.externalId}`,
      s.firstLook ? 1 : 0,
      s.seen ? created : null,
      created,
      created
    )
  return id
}

const list = (args: { productId?: string; channelId?: string; labels?: FindingLabel[]; limit?: number } = {}) =>
  world.core.router.call('findings.list', { productId: world.product.id, ...args })
const ids = async (args: Parameters<typeof list>[0] = {}): Promise<string[]> => (await list(args)).map((card) => card.finding.externalId)

describe('a verdict is final', () => {
  const state = (id: string) => world.core.db.prepare('SELECT stage, label, relation FROM findings WHERE id = ?').get(id)

  it('a title is judged once, and only a post that waits to be read can be read', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    const pending = seed({ externalId: 'p', label: null, stage: 'pending' })
    const waiting = seed({ externalId: 'w', label: null, stage: 'title' })
    const read = seed({ externalId: 'r', label: 'notice', stage: 'read' })

    // A post that was not judged cannot be read, and one that was read cannot be judged again.
    expect(store.settleRead(pending, { label: 'reply', relation: 'x', opportunityId: null })).toBe(false)
    expect(store.judgeTitle(waiting, { relevant: false, why: 'x' })).toBe(false)
    expect(store.judgeTitle(read, { relevant: false, why: 'x' })).toBe(false)
    expect(store.settleRead(read, { label: 'skip', relation: 'x', opportunityId: null })).toBe(false)
    expect(state(pending)).toEqual({ stage: 'pending', label: null, relation: 'Relation of p' })
    expect(state(waiting)).toEqual({ stage: 'title', label: null, relation: 'Relation of w' })
    expect(state(read)).toEqual({ stage: 'read', label: 'notice', relation: 'Relation of r' })

    expect(store.judgeTitle(pending, { relevant: true, why: 'Bears on the goal' })).toBe(true)
    expect(store.judgeTitle(pending, { relevant: false, why: 'Changed my mind' })).toBe(false)
    expect(state(pending)).toEqual({ stage: 'title', label: null, relation: 'Bears on the goal' })
    expect(store.settleRead(waiting, { label: 'notice', relation: 'Read', opportunityId: null })).toBe(true)
    expect(store.settleRead(waiting, { label: 'skip', relation: 'Changed my mind', opportunityId: null })).toBe(false)
    expect(state(waiting)).toEqual({ stage: 'read', label: 'notice', relation: 'Read' })
  })

  it('counts an unusable answer once per post, settles a post as a notice at the third, and keeps the count to itself', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    const a = seed({ externalId: 'a', label: null, stage: 'pending' })
    const b = seed({ externalId: 'b', label: null, stage: 'title' })
    const done = seed({ externalId: 'done', label: 'skip', stage: 'title' })
    const attempts = (id: string): number => (world.core.db.prepare('SELECT attempts FROM findings WHERE id = ?').get(id) as { attempts: number }).attempts

    expect(store.recordUnusable([a, b, done, 'not-a-finding'])).toEqual([])
    expect([attempts(a), attempts(b), attempts(done)]).toEqual([1, 1, 0])
    expect(store.recordUnusable([a])).toEqual([])
    expect([attempts(a), attempts(b)]).toEqual([2, 1])
    expect(store.recordUnusable([a, b])).toEqual([a])
    expect([attempts(a), attempts(b)]).toEqual([3, 2])
    expect(state(a)).toEqual({ stage: 'title', label: 'notice', relation: UNJUDGED_RELATION })
    expect(state(b)).toEqual({ stage: 'title', label: null, relation: 'Relation of b' })
    expect(state(done)).toEqual({ stage: 'title', label: 'skip', relation: 'Relation of done' })

    // A post that has its label is not counted again, nor settled again.
    expect(store.recordUnusable([a])).toEqual([])
    expect(attempts(a)).toBe(3)
    // The count is not part of what the screens are given.
    const row = world.core.db.prepare('SELECT * FROM findings WHERE id = ?').get(a) as Record<string, unknown>
    expect(Object.keys(mapFinding(row))).not.toContain('attempts')
    expect(JSON.stringify(mapFinding(row))).not.toContain('attempts')
  })

  it('counts a post that could not be read in the same attempts, settles it as a notice with its own fixed relation at the third, and never touches one with a label', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    const a = seed({ externalId: 'a', label: null, stage: 'title' })
    const b = seed({ externalId: 'b', label: null, stage: 'title' })
    const done = seed({ externalId: 'done', label: 'notice', stage: 'read' })
    const attempts = (id: string): number => (world.core.db.prepare('SELECT attempts FROM findings WHERE id = ?').get(id) as { attempts: number }).attempts

    expect(store.recordUnreadable([a, b, done, 'not-a-finding'])).toEqual([])
    expect([attempts(a), attempts(b), attempts(done)]).toEqual([1, 1, 0])
    expect(store.recordUnreadable([a])).toEqual([])
    // Both kinds of failure add up in one count: a post that failed once of each kind is at two.
    expect(store.recordUnusable([a])).toEqual([a])
    expect(attempts(a)).toBe(3)
    expect(state(a)).toEqual({ stage: 'title', label: 'notice', relation: UNJUDGED_RELATION })

    expect(store.recordUnreadable([b])).toEqual([])
    expect(store.recordUnreadable([b])).toEqual([b])
    expect(state(b)).toEqual({ stage: 'title', label: 'notice', relation: UNREADABLE_RELATION })
    expect(UNREADABLE_RELATION).toBe('The post could not be read, so it is shown for you to look at.')
    expect(store.recordUnreadable([b, done])).toEqual([])
    expect([attempts(b), attempts(done)]).toEqual([3, 0])
  })

  it('lists the posts that wait to be read with those that failed the least first, and the newest first among equals', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    const at = (hours: number): string => new Date(Date.parse('2026-11-08T12:00:00.000Z') - hours * 3_600_000).toISOString()
    seed({ externalId: 'fresh', label: null, stage: 'title', postedAt: at(1) })
    seed({ externalId: 'fresh-old', label: null, stage: 'title', postedAt: at(5) })
    const failed = seed({ externalId: 'failed', label: null, stage: 'title', postedAt: at(0) })
    const failedTwice = seed({ externalId: 'failed-twice', label: null, stage: 'title', postedAt: at(2) })
    seed({ externalId: 'pending', label: null, stage: 'pending', postedAt: at(0) })
    seed({ externalId: 'read', label: 'notice', stage: 'read', postedAt: at(0) })
    world.core.db.prepare('UPDATE findings SET attempts = 1 WHERE id = ?').run(failed)
    world.core.db.prepare('UPDATE findings SET attempts = 2 WHERE id = ?').run(failedTwice)

    expect(store.waiting(world.channel.id, 10).map((f) => f.externalId)).toEqual(['fresh', 'fresh-old', 'failed', 'failed-twice'])
    expect(store.waiting(world.channel.id, 2).map((f) => f.externalId)).toEqual(['fresh', 'fresh-old'])
  })

  it('keeps how far a channel was listed apart from the channel itself: null until set, per channel, not part of what the screens are given', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    const other = world.addChannel({ target: 'r/other' })
    expect(store.listedThrough(world.channel.id)).toBeNull()
    expect(store.listedThrough('no-such-channel')).toBeNull()

    store.setListedThrough(world.channel.id, '2026-11-08T12:00:00.000Z')
    expect(store.listedThrough(world.channel.id)).toBe('2026-11-08T12:00:00.000Z')
    expect(store.listedThrough(other.id)).toBeNull()
    store.setListedThrough(world.channel.id, '2026-11-09T12:00:00.000Z')
    expect(store.listedThrough(world.channel.id)).toBe('2026-11-09T12:00:00.000Z')

    // The shared Channel is the same as before: the cursor is the store's own business.
    expect(JSON.stringify(world.refresh())).not.toMatch(/listed_?through/i)
    expect(world.refresh().lookedBackAt).toBeNull()
  })

  it('a post is stored once per channel, whatever the listing shows', () => {
    world = makeWorld()
    const store = new FindingStore(world.core)
    const remote = { externalId: 'p1', url: 'https://fake.test/p1', title: 'A title', author: 'someone', body: '', postedAt: null, comments: [] }
    expect(store.addPending(world.product.id, world.channel.id, remote, true)).toBe(true)
    expect(store.addPending(world.product.id, world.channel.id, { ...remote, title: 'Another title' }, false)).toBe(false)
    expect(world.core.db.prepare('SELECT title, first_look FROM findings').all()).toEqual([{ title: 'A title', first_look: 1 }])
    const other = world.addChannel({ target: 'r/other' })
    expect(store.addPending(world.product.id, other.id, remote, false)).toBe(true)
  })
})

describe('recentJudgment: whether the engine judged something lately', () => {
  const since = '2026-11-08T00:00:00.000Z'
  const proof = (): boolean => new FindingStore(world.core).recentJudgment(since)

  it('is true for a finding labelled at or after the time asked for, whatever its label or channel, and false before it', () => {
    world = makeWorld()
    expect(proof()).toBe(false)
    seed({ externalId: 'old', label: 'skip', createdAt: '2026-11-07T23:59:59.999Z' })
    expect(proof()).toBe(false)
    for (const [label, other] of [['skip', false], ['notice', false], ['reply', false], ['skip', true]] as const) {
      world.core.db.prepare('DELETE FROM findings').run()
      const channel = other ? world.addChannel({ productId: world.addProduct('Another').id, target: 'r/other' }) : world.channel
      seed({ externalId: 'new', label, createdAt: since, channelId: channel.id, productId: channel.productId })
      expect(proof()).toBe(true)
    }
  })

  it('does not count a post that has no label: pending, or relevant by its title and waiting to be read', () => {
    world = makeWorld()
    seed({ externalId: 'pending', label: null, stage: 'pending', createdAt: '2026-11-09T00:00:00.000Z' })
    seed({ externalId: 'waiting', label: null, stage: 'title', createdAt: '2026-11-09T00:00:00.000Z' })
    expect(proof()).toBe(false)
  })

  it('does not count what is no judgment: a post settled by the attempts rule, or one found gone', () => {
    world = makeWorld()
    seed({ externalId: 'given-up', label: 'notice', stage: 'title', relation: UNJUDGED_RELATION, createdAt: '2026-11-09T00:00:00.000Z' })
    seed({ externalId: 'gone', label: 'skip', stage: 'read', relation: POST_GONE, createdAt: '2026-11-09T00:00:00.000Z' })
    seed({ externalId: 'unreadable', label: 'notice', stage: 'title', relation: UNREADABLE_RELATION, createdAt: '2026-11-09T00:00:00.000Z' })
    expect(proof()).toBe(false)
    // A reply that could not be queued is a notice with the AI's own relation: it was judged.
    seed({ externalId: 'blocked', label: 'notice', stage: 'read', relation: 'Not queued (the post is locked). Asks which app to use.', createdAt: '2026-11-09T00:00:00.000Z' })
    expect(proof()).toBe(true)
  })

  it('is not moved by the owner looking at a finding, nor by a post being counted', () => {
    world = makeWorld()
    const old = seed({ externalId: 'old', label: 'notice', createdAt: '2026-11-01T00:00:00.000Z' })
    const store = new FindingStore(world.core)
    const waiting = seed({ externalId: 'waiting', label: null, stage: 'title', createdAt: '2026-11-01T00:00:00.000Z' })
    store.markSeen([old])
    store.recordUnusable([waiting])
    expect(proof()).toBe(false)
    expect((world.core.db.prepare('SELECT updated_at AS at FROM findings WHERE id = ?').get(old) as { at: string }).at).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('findings.list', () => {
  it('lists a product\'s findings newest post first, each with the channel it came from', async () => {
    world = makeWorld()
    const other = world.addChannel({ target: 'r/other' })
    seed({ externalId: 'old', label: 'notice', postedAt: '2026-11-01T00:00:00.000Z' })
    seed({ externalId: 'new', label: 'reply', postedAt: '2026-11-07T00:00:00.000Z', channelId: other.id, firstLook: true })
    seed({ externalId: 'mid', label: 'skip', postedAt: '2026-11-04T00:00:00.000Z' })
    // A post with no time is placed by when it was found.
    seed({ externalId: 'untimed', label: 'notice', postedAt: null, createdAt: '2026-11-05T00:00:00.000Z' })

    const cards = await list()

    expect(cards.map((c) => c.finding.externalId)).toEqual(['new', 'untimed', 'mid', 'old'])
    expect(cards[0]).toMatchObject({ channelTarget: 'r/other', channelPlatform: 'fake', finding: { label: 'reply', stage: 'read', firstLook: true, relation: 'Relation of new', url: 'https://fake.test/new', seenAt: null } })
    expect(cards[3].channelTarget).toBe(world.channel.target)
  })

  it('keeps to the labels asked for', async () => {
    world = makeWorld()
    seed({ externalId: 'r1', label: 'reply' })
    seed({ externalId: 'n1', label: 'notice' })
    seed({ externalId: 's1', label: 'skip' })
    expect((await ids({ labels: ['notice'] })).sort()).toEqual(['n1'])
    expect((await ids({ labels: ['reply', 'skip'] })).sort()).toEqual(['r1', 's1'])
    expect((await ids({ labels: ['reply', 'notice', 'skip'] })).sort()).toEqual(['n1', 'r1', 's1'])
  })

  it('lists a post that has no label yet (pending, or waiting to be read) only when no label is asked for', async () => {
    world = makeWorld()
    seed({ externalId: 'pending', label: null, stage: 'pending' })
    seed({ externalId: 'waiting', label: null, stage: 'title' })
    seed({ externalId: 'n1', label: 'notice' })
    expect((await ids()).sort()).toEqual(['n1', 'pending', 'waiting'])
    expect((await ids({ labels: ['reply', 'notice', 'skip'] })).sort()).toEqual(['n1'])
    expect(await ids({ labels: ['skip'] })).toEqual([])
  })

  it('keeps to one channel, and never shows another product\'s findings', async () => {
    world = makeWorld()
    const other = world.addChannel({ target: 'r/other' })
    const product = world.addProduct('Another')
    const foreign = world.addChannel({ productId: product.id, target: 'r/foreign' })
    seed({ externalId: 'a', label: 'notice' })
    seed({ externalId: 'b', label: 'notice', channelId: other.id })
    seed({ externalId: 'c', label: 'notice', channelId: foreign.id, productId: product.id })

    expect((await ids()).sort()).toEqual(['a', 'b'])
    expect(await ids({ channelId: other.id })).toEqual(['b'])
    expect(await ids({ productId: product.id })).toEqual(['c'])
    expect(await ids({ productId: product.id, channelId: other.id })).toEqual([])
  })

  it('returns 100 by default and at most 300, however many are asked for', async () => {
    world = makeWorld()
    const insert = world.core.db.transaction(() => {
      for (let i = 0; i < 320; i++) seed({ externalId: `p${i}`, label: 'skip', postedAt: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString() })
    })
    insert()

    expect(await list()).toHaveLength(100)
    expect(await list({ limit: 7 })).toHaveLength(7)
    expect(await list({ limit: 1000 })).toHaveLength(300)
    expect(await list({ limit: 0 })).toHaveLength(1)
    expect(await list({ limit: -5 })).toHaveLength(1)
    expect(await list({ limit: Number.NaN })).toHaveLength(100)
    expect((await ids({ limit: 3 }))[0]).toBe('p319') // the newest first
  })

  it('refuses a label that does not exist and a missing product', async () => {
    world = makeWorld()
    await expect(list({ labels: ['send' as FindingLabel] })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(list({ labels: 'notice' as unknown as FindingLabel[] })).rejects.toBeInstanceOf(ApiError)
    await expect(world.core.router.call('findings.list', { productId: '' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(world.core.router.call('findings.counts', { productId: ' ' })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('has nothing to show for a product that has nothing', async () => {
    world = makeWorld()
    expect(await list()).toEqual([])
    expect(await world.core.router.call('findings.counts', { productId: world.product.id })).toEqual({ unseenNotices: 0, notices: 0, skipped: 0, pending: 0 })
  })
})

describe('findings.counts', () => {
  it('counts the notices (and those not looked at), the skipped posts, and every post without a label', async () => {
    world = makeWorld()
    const product = world.addProduct('Another')
    const foreign = world.addChannel({ productId: product.id, target: 'r/foreign' })
    seed({ externalId: 'n1', label: 'notice' })
    seed({ externalId: 'n2', label: 'notice', seen: true })
    seed({ externalId: 'n3', label: 'notice' })
    seed({ externalId: 'r1', label: 'reply' })
    seed({ externalId: 's1', label: 'skip' })
    seed({ externalId: 's2', label: 'skip', seen: true })
    seed({ externalId: 'p1', label: null, stage: 'pending' })
    seed({ externalId: 'w1', label: null, stage: 'title' })
    seed({ externalId: 'x1', label: 'notice', channelId: foreign.id, productId: product.id })

    expect(await world.core.router.call('findings.counts', { productId: world.product.id })).toEqual({ unseenNotices: 2, notices: 3, skipped: 2, pending: 2 })
    expect(await world.core.router.call('findings.counts', { productId: product.id })).toEqual({ unseenNotices: 1, notices: 1, skipped: 0, pending: 0 })
  })

  it('counts one channel when asked for one, and the whole product when not', async () => {
    world = makeWorld()
    const second = world.addChannel({ target: 'r/second' })
    seed({ externalId: 'a1', label: 'notice' })
    seed({ externalId: 'a2', label: 'skip' })
    seed({ externalId: 'b1', label: 'notice', channelId: second.id })
    seed({ externalId: 'b2', label: 'notice', channelId: second.id, seen: true })
    seed({ externalId: 'b3', label: null, stage: 'pending', channelId: second.id })

    const call = (channelId?: string) => world.core.router.call('findings.counts', { productId: world.product.id, ...(channelId ? { channelId } : {}) })
    expect(await call()).toEqual({ unseenNotices: 2, notices: 3, skipped: 1, pending: 1 })
    expect(await call(second.id)).toEqual({ unseenNotices: 1, notices: 2, skipped: 0, pending: 1 })
    expect(await call(world.channel.id)).toEqual({ unseenNotices: 1, notices: 1, skipped: 1, pending: 0 })
    // A channel of another product is nothing of this product's.
    const foreign = world.addChannel({ productId: world.addProduct('Another').id, target: 'r/foreign' })
    expect(await call(foreign.id)).toEqual({ unseenNotices: 0, notices: 0, skipped: 0, pending: 0 })
  })
})

describe('findings.markSeen', () => {
  const seenAt = (id: string): string | null => (world.core.db.prepare('SELECT seen_at AS at FROM findings WHERE id = ?').get(id) as { at: string | null }).at

  it('marks the findings given as looked at, now, and leaves the others', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    const b = seed({ externalId: 'b', label: 'notice' })
    const c = seed({ externalId: 'c', label: 'notice' })
    world.clock.advance(5 * DAY)

    await world.core.router.call('findings.markSeen', { ids: [a, b] })

    expect(seenAt(a)).toBe(world.clock.now().toISOString())
    expect(seenAt(b)).toBe(world.clock.now().toISOString())
    expect(seenAt(c)).toBeNull()
    expect((await world.core.router.call('findings.counts', { productId: world.product.id })).unseenNotices).toBe(1)
  })

  it('ignores an id that is not a finding, and an empty list', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    await expect(world.core.router.call('findings.markSeen', { ids: ['nope', 'also-not', a] })).resolves.toBeUndefined()
    await expect(world.core.router.call('findings.markSeen', { ids: [] })).resolves.toBeUndefined()
    expect(seenAt(a)).not.toBeNull()
  })

  it('does not move the time a finding was first looked at, and is not an error the second time', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    await world.core.router.call('findings.markSeen', { ids: [a] })
    const first = seenAt(a)
    world.clock.advance(DAY)
    await world.core.router.call('findings.markSeen', { ids: [a] })
    expect(seenAt(a)).toBe(first)
  })

  it('works for the ids of any product: ids are global', async () => {
    world = makeWorld()
    const product = world.addProduct('Another')
    const foreign = world.addChannel({ productId: product.id, target: 'r/foreign' })
    const id = seed({ externalId: 'x', label: 'notice', channelId: foreign.id, productId: product.id })
    await world.core.router.call('findings.markSeen', { ids: [id] })
    expect(seenAt(id)).not.toBeNull()
  })

  it('refuses something that is not a list of ids', async () => {
    world = makeWorld()
    await expect(world.core.router.call('findings.markSeen', { ids: 'a' as unknown as string[] })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(world.core.router.call('findings.markSeen', { ids: [1] as unknown as string[] })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('tells the screens the findings changed, but not when nothing did', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    const events: ApiEvent[] = []
    world.core.events.subscribe((event) => events.push(event))

    await world.core.router.call('findings.markSeen', { ids: ['nope'] })
    expect(events.filter((e) => e.type === 'changed' && e.scope === 'opportunities')).toEqual([])

    await world.core.router.call('findings.markSeen', { ids: [a] })
    expect(events.filter((e) => e.type === 'changed' && e.scope === 'opportunities')).toHaveLength(1)
  })
})

describe('findings.markUnseen', () => {
  const seenAt = (id: string): string | null => (world.core.db.prepare('SELECT seen_at AS at FROM findings WHERE id = ?').get(id) as { at: string | null }).at

  it('takes the mark off the findings given and leaves the others as they are', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    const b = seed({ externalId: 'b', label: 'notice' })
    const c = seed({ externalId: 'c', label: 'notice' })
    await world.core.router.call('findings.markSeen', { ids: [a, b, c] })

    await world.core.router.call('findings.markUnseen', { ids: [a] })

    expect(seenAt(a)).toBeNull()
    expect(seenAt(b)).not.toBeNull()
    expect(seenAt(c)).not.toBeNull()
    expect((await world.core.router.call('findings.counts', { productId: world.product.id })).unseenNotices).toBe(1)
  })

  it('is not an error for an id that is not a finding, for a finding not seen, or for an empty list', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    await expect(world.core.router.call('findings.markUnseen', { ids: ['nope', a] })).resolves.toBeUndefined()
    await expect(world.core.router.call('findings.markUnseen', { ids: [] })).resolves.toBeUndefined()
    expect(seenAt(a)).toBeNull()
  })

  it('does not move the time of the judgment: updated_at stays', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    await world.core.router.call('findings.markSeen', { ids: [a] })
    const before = (world.core.db.prepare('SELECT updated_at AS at FROM findings WHERE id = ?').get(a) as { at: string }).at
    world.clock.advance(DAY)
    await world.core.router.call('findings.markUnseen', { ids: [a] })
    expect((world.core.db.prepare('SELECT updated_at AS at FROM findings WHERE id = ?').get(a) as { at: string }).at).toBe(before)
  })

  it('refuses something that is not a list of ids', async () => {
    world = makeWorld()
    await expect(world.core.router.call('findings.markUnseen', { ids: 'a' as unknown as string[] })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('tells the screens the findings changed, but not when nothing did', async () => {
    world = makeWorld()
    const a = seed({ externalId: 'a', label: 'notice' })
    await world.core.router.call('findings.markSeen', { ids: [a] })
    const events: ApiEvent[] = []
    world.core.events.subscribe((event) => events.push(event))

    await world.core.router.call('findings.markUnseen', { ids: ['nope'] })
    expect(events.filter((e) => e.type === 'changed' && e.scope === 'opportunities')).toEqual([])

    await world.core.router.call('findings.markUnseen', { ids: [a] })
    expect(events.filter((e) => e.type === 'changed' && e.scope === 'opportunities')).toHaveLength(1)
  })
})

describe('what the triage changes is told to the screens', () => {
  it('a pass that judged something says the opportunities changed', async () => {
    world = makeWorld({ settings: { lookBackDays: 7 } })
    world.connector.addPost({ externalId: 'p1', postedAt: new Date(world.clock.now().getTime() - 3_600_000).toISOString() })
    world.engine.on('triage.titles', JSON.stringify({ posts: [{ n: 1, relevant: false, why: 'Off topic' }] }))
    const events: ApiEvent[] = []
    world.core.events.subscribe((event) => events.push(event))

    await world.monitor.runChannel(world.channel.id)

    expect(events.some((e) => e.type === 'changed' && e.scope === 'opportunities')).toBe(true)
    expect((await ids({ labels: ['skip'] }))).toEqual(['p1'])
    expect(await world.core.router.call('findings.counts', { productId: world.product.id })).toMatchObject({ skipped: 1, pending: 0 })
  })
})
