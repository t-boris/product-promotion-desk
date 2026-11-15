import { describe, expect, it, vi } from 'vitest'
import type { AttentionItem } from '../../shared/types'
import { newId } from '../db/database'
import { buildResultsHistory } from './results'
import { periodStart } from './overview'
import { makeHarness } from './scheduler-harness'
import { seedAccount, seedChannel, seedDraft, seedOpportunity, seedProduct, seedSend } from './scheduler-seed'

// The fake clock starts at 2026-11-08T12:00:00Z.
const NOW = '2026-11-08T12:00:00.000Z'
const DAY = 86_400_000
const ago = (ms: number): string => new Date(Date.parse(NOW) - ms).toISOString()

function approve(h: ReturnType<typeof makeHarness>, draftId: string, destination: string): void {
  h.core.db
    .prepare('INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), draftId, 'hash', h.account.id, destination, 'user', NOW)
}

function snapshot(h: ReturnType<typeof makeHarness>, channelId: string, key: string, value: number | null, at: string, available = value !== null): void {
  h.core.db
    .prepare('INSERT INTO metric_snapshots (id, channel_id, key, label, value, available, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), channelId, key, key.toUpperCase(), value, available ? 1 : 0, at)
}

describe('the period (local days)', () => {
  it('starts at local midnight of the first day, whatever the offset', () => {
    const now = new Date(NOW)
    expect(periodStart(now, 1, 0).toISOString()).toBe('2026-11-08T00:00:00.000Z')
    expect(periodStart(now, 7, 0).toISOString()).toBe('2026-11-02T00:00:00.000Z')
    // UTC-8: it is 04:00 on the 8th there, so the local day began at 08:00 UTC.
    expect(periodStart(now, 1, -480).toISOString()).toBe('2026-11-08T08:00:00.000Z')
    // UTC+3: 15:00 on the 8th there; the local day began at 21:00 UTC on the 7th.
    expect(periodStart(now, 1, 180).toISOString()).toBe('2026-11-07T21:00:00.000Z')
  })
})

describe('overview.get', () => {
  it('counts the opportunities created in the period through the funnel, and no step holds more than the one before', async () => {
    const h = makeHarness()
    const channel = h.channel()
    // Four opportunities in the period: one only found, one drafted, one approved, one sent. One older than the period.
    seedOpportunity(h.core, channel.id, { updatedAt: ago(DAY) })
    const drafted = seedOpportunity(h.core, channel.id, { updatedAt: ago(DAY) })
    seedDraft(h.core, drafted)
    const approved = seedOpportunity(h.core, channel.id, { updatedAt: ago(DAY) })
    approve(h, seedDraft(h.core, approved), 'x')
    const sent = seedOpportunity(h.core, channel.id, { updatedAt: ago(DAY), state: 'confirmed' })
    seedSend(h.core, { opportunityId: sent, accountId: h.account.id })
    const old = seedOpportunity(h.core, channel.id, { updatedAt: ago(30 * DAY), state: 'confirmed' })
    seedSend(h.core, { opportunityId: old, accountId: h.account.id, attemptedAt: ago(30 * DAY), completedAt: ago(30 * DAY) })

    const view = await h.core.router.call('overview.get', { productId: h.productId, days: 7 })

    expect(view.funnel).toEqual({ found: 4, drafted: 3, approved: 2, sent: 1 })
    expect(view.funnel.found).toBeGreaterThanOrEqual(view.funnel.drafted)
    expect(view.funnel.drafted).toBeGreaterThanOrEqual(view.funnel.approved)
    expect(view.funnel.approved).toBeGreaterThanOrEqual(view.funnel.sent)
  })

  it('keeps an approval that was invalidated as an approval, and does not count a send that failed', async () => {
    const h = makeHarness()
    const channel = h.channel()
    const opp = seedOpportunity(h.core, channel.id, { updatedAt: ago(DAY) })
    seedSend(h.core, { opportunityId: opp, accountId: h.account.id, state: 'failed' })
    h.core.db.prepare("UPDATE approvals SET invalidated_at = ?, invalid_reason = 'edited' WHERE draft_id IN (SELECT id FROM drafts WHERE opportunity_id = ?)").run(NOW, opp)

    const view = await h.core.router.call('overview.get', { productId: h.productId, days: 7 })

    // It was approved once (the approval row stays as evidence), but a failed send is not a sent one.
    expect(view.funnel).toEqual({ found: 1, drafted: 1, approved: 1, sent: 0 })
  })

  it('reports each channel: what waits, what was sent in the period, and when it last worked', async () => {
    const h = makeHarness()
    const busy = h.channel({ target: 'r/busy' })
    h.channel({ target: 'r/quiet', status: 'paused' })
    for (const state of ['draft', 'awaiting_approval', 'ready', 'needs_user'] as const) seedOpportunity(h.core, busy.id, { state })
    seedOpportunity(h.core, busy.id, { state: 'discovered' })
    seedOpportunity(h.core, busy.id, { state: 'cancelled' })
    const sent = seedOpportunity(h.core, busy.id, { state: 'confirmed' })
    seedSend(h.core, { opportunityId: sent, accountId: h.account.id })

    const view = await h.core.router.call('overview.get', { productId: h.productId, days: 7 })

    const byTarget = Object.fromEntries(view.channels.map((c) => [c.target, c]))
    expect(byTarget['r/busy']).toMatchObject({ waiting: 4, sent: 1, status: 'active', lastSentAt: NOW })
    expect(byTarget['r/quiet']).toMatchObject({ waiting: 0, sent: 0, status: 'paused', lastSentAt: null })
    expect(view.channels).toHaveLength(2)
  })

  it('knows when a channel last sent even when that was before the period, and ignores sends that did not finish', async () => {
    const h = makeHarness()
    const channel = h.channel()
    const earlier = seedOpportunity(h.core, channel.id, { state: 'confirmed' })
    seedSend(h.core, { opportunityId: earlier, accountId: h.account.id, attemptedAt: ago(40 * DAY), completedAt: ago(40 * DAY) })
    const later = seedOpportunity(h.core, channel.id, { state: 'confirmed' })
    seedSend(h.core, { opportunityId: later, accountId: h.account.id, attemptedAt: ago(20 * DAY), completedAt: ago(20 * DAY) })
    seedSend(h.core, { opportunityId: seedOpportunity(h.core, channel.id), accountId: h.account.id, state: 'failed', attemptedAt: ago(DAY), completedAt: ago(DAY) })

    const view = await h.core.router.call('overview.get', { productId: h.productId, days: 7 })

    expect(view.channels[0]).toMatchObject({ sent: 0, lastSentAt: ago(20 * DAY) })
  })

  it('gives one entry for every local day of the period, with sends split into replies and own posts', async () => {
    const h = makeHarness()
    const channel = h.channel()
    const reply = seedOpportunity(h.core, channel.id, { kind: 'reply', state: 'confirmed' })
    seedSend(h.core, { opportunityId: reply, accountId: h.account.id, attemptedAt: '2026-11-08T09:00:00.000Z', completedAt: '2026-11-08T09:00:00.000Z' })
    const post = seedOpportunity(h.core, channel.id, { kind: 'standalone', state: 'confirmed' })
    seedSend(h.core, { opportunityId: post, accountId: h.account.id, attemptedAt: '2026-11-06T23:30:00.000Z', completedAt: '2026-11-06T23:30:00.000Z' })

    const utc = await h.core.router.call('overview.get', { productId: h.productId, days: 3 })
    expect(utc.activity.map((d) => d.day)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08'])
    expect(utc.activity).toEqual([
      { day: '2026-11-06', posts: 1, replies: 0 },
      { day: '2026-11-07', posts: 0, replies: 0 },
      { day: '2026-11-08', posts: 0, replies: 1 }
    ])

    // Three hours east of UTC the post of 23:30 on the 6th happened on the 7th.
    const east = await h.core.router.call('overview.get', { productId: h.productId, days: 3, utcOffsetMinutes: 180 })
    expect(east.activity).toEqual([
      { day: '2026-11-06', posts: 0, replies: 0 },
      { day: '2026-11-07', posts: 1, replies: 0 },
      { day: '2026-11-08', posts: 0, replies: 1 }
    ])
  })

  it("lists only this product's attention items, and the account items of accounts its channels use", async () => {
    const h = makeHarness()
    const channel = h.channel()
    const mine = seedOpportunity(h.core, channel.id, { state: 'awaiting_approval' })
    // Another product with its own waiting opportunity.
    const otherProduct = newId()
    h.core.db.prepare("INSERT INTO products (id, name, created_at, updated_at) VALUES (?, 'Other', ?, ?)").run(otherProduct, NOW, NOW)
    const foreign = newId()
    h.core.db
      .prepare(
        "INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, reason, created_at, updated_at) VALUES (?, ?, ?, 'reply', 'awaiting_approval', 'd', '', ?, ?)"
      )
      .run(foreign, channel.id, otherProduct, NOW, NOW)

    const view = await h.core.router.call('overview.get', { productId: h.productId, days: 7 })

    expect(view.attention.map((item) => item.refId)).toContain(mine)
    expect(view.attention.map((item) => item.refId)).not.toContain(foreign)
  })

  it('keeps an item about the product by every kind of reference, and drops the same kinds about another product', async () => {
    const h = makeHarness()
    const mine = h.channel()
    const otherProduct = seedProduct(h.core, { name: 'Other' })
    const otherAccount = seedAccount(h.core, { label: 'Other login' })
    const theirs = seedChannel(h.core, { productId: otherProduct, accountId: otherAccount.id })
    const myOpportunity = seedOpportunity(h.core, mine.id)
    const myAction = seedSend(h.core, { opportunityId: myOpportunity, accountId: h.account.id }).actionId
    const theirOpportunity = seedOpportunity(h.core, theirs.id)
    const theirAction = seedSend(h.core, { opportunityId: theirOpportunity, accountId: otherAccount.id }).actionId
    const item = (refType: AttentionItem['refType'], refId: string): AttentionItem => ({ id: `${refType}:${refId}`, kind: 'question', title: refType, detail: '', refType, refId, createdAt: NOW })
    const wanted = [item('product', h.productId), item('channel', mine.id), item('account', h.account.id), item('opportunity', myOpportunity), item('action', myAction)]
    const unwanted = [item('product', otherProduct), item('channel', theirs.id), item('account', otherAccount.id), item('opportunity', theirOpportunity), item('action', theirAction), item('opportunity', 'gone'), item('action', 'gone')]
    vi.spyOn(h.automation.attention, 'list').mockReturnValue([...wanted, ...unwanted])

    const view = await h.core.router.call('overview.get', { productId: h.productId, days: 7 })

    expect(view.attention.map((i) => i.id)).toEqual(wanted.map((i) => i.id))
  })

  it('does not count a failed or unfinished send as sent, on a channel or on a day', async () => {
    const h = makeHarness()
    const channel = h.channel()
    for (const state of ['failed', 'sending', 'unknown'] as const) {
      seedSend(h.core, { opportunityId: seedOpportunity(h.core, channel.id), accountId: h.account.id, state })
    }

    const view = await h.core.router.call('overview.get', { productId: h.productId, days: 3 })

    expect(view.channels[0].sent).toBe(0)
    expect(view.activity.every((d) => d.posts === 0 && d.replies === 0)).toBe(true)
  })

  it('refuses a period that is not a whole number of days from 1 to 365, a bad offset and an unknown product', async () => {
    const h = makeHarness()
    for (const days of [0, 366, 1.5, Number.NaN, -3]) {
      await expect(h.core.router.call('overview.get', { productId: h.productId, days })).rejects.toMatchObject({ code: 'invalid_input' })
    }
    await expect(h.core.router.call('overview.get', { productId: h.productId, days: 7, utcOffsetMinutes: 900 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.core.router.call('overview.get', { productId: 'nope', days: 7 })).rejects.toMatchObject({ code: 'not_found' })
    await expect(h.core.router.call('overview.get', { productId: h.productId, days: 365 })).resolves.toMatchObject({ days: 365 })
    await expect(h.core.router.call('overview.get', { productId: h.productId, days: 1 })).resolves.toMatchObject({ days: 1 })
  })
})

describe('results.history', () => {
  it('returns the readings inside the period per channel and metric, oldest first, and leaves a missing reading missing', async () => {
    const h = makeHarness()
    const channel = h.channel()
    snapshot(h, channel.id, 'upvotes', 3, ago(2 * DAY))
    snapshot(h, channel.id, 'upvotes', 0, ago(DAY))
    snapshot(h, channel.id, 'upvotes', null, ago(DAY / 2))
    snapshot(h, channel.id, 'upvotes', 9, ago(60 * DAY))
    snapshot(h, channel.id, 'reach', 12, ago(DAY))
    // A connector bug that kept a number beside "not available" must not become a reading.
    snapshot(h, channel.id, 'clicks', 7, ago(DAY), false)

    const history = await h.core.router.call('results.history', { productId: h.productId, days: 7 })

    const upvotes = history.series.find((s) => s.key === 'upvotes')!
    expect(upvotes.points.map((p) => p.value)).toEqual([3, 0, null])
    expect(upvotes.points.map((p) => p.capturedAt)).toEqual([ago(2 * DAY), ago(DAY), ago(DAY / 2)])
    expect(history.series.find((s) => s.key === 'reach')!.points).toEqual([{ capturedAt: ago(DAY), value: 12 }])
    expect(history.series.find((s) => s.key === 'clicks')!.points).toEqual([{ capturedAt: ago(DAY), value: null }])
    expect(history.series.every((s) => s.channelId === channel.id)).toBe(true)
    expect({ days: history.days, to: history.to, from: history.from }).toEqual({ days: 7, to: NOW, from: ago(7 * DAY) })
  })

  it('names a series by its newest label when a connector renamed the metric', async () => {
    const h = makeHarness()
    const channel = h.channel()
    const insert = h.core.db.prepare('INSERT INTO metric_snapshots (id, channel_id, key, label, value, available, captured_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
    insert.run(newId(), channel.id, 'score', 'Score', 1, ago(2 * DAY))
    insert.run(newId(), channel.id, 'score', 'Post score', 2, ago(DAY))

    const history = await h.core.router.call('results.history', { productId: h.productId, days: 7 })

    expect(history.series).toHaveLength(1)
    expect(history.series[0].label).toBe('Post score')
    expect(history.series[0].points.map((p) => p.value)).toEqual([1, 2])
  })

  it("never returns another product's readings", async () => {
    const h = makeHarness()
    const channel = h.channel()
    snapshot(h, channel.id, 'upvotes', 1, ago(DAY))
    const otherProduct = newId()
    h.core.db.prepare("INSERT INTO products (id, name, created_at, updated_at) VALUES (?, 'Other', ?, ?)").run(otherProduct, NOW, NOW)

    const history = await h.core.router.call('results.history', { productId: otherProduct, days: 7 })

    expect(history.series).toEqual([])
  })

  it('refuses a bad period and an unknown product', () => {
    const h = makeHarness()
    expect(() => buildResultsHistory(h.core, { productId: h.productId, days: 0 })).toThrowError(/days must be/)
    expect(() => buildResultsHistory(h.core, { productId: 'nope', days: 7 })).toThrowError(/Product not found/)
  })
})
