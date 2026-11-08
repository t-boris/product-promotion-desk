import { describe, expect, it } from 'vitest'
import type { ApiEvent } from '../../shared/api'
import { AttentionNotifier } from './attention-notify'
import { sendDueDigests } from './attention-digest'
import { flush } from './scheduler-fakes'
import { makeHarness } from './scheduler-harness'
import { seedAccount, seedComment, seedDraft, seedOpportunity, seedSend } from './scheduler-seed'
import { MINUTE_MS } from './scheduler-timing'

const HOUR = 60 * MINUTE_MS
const ago = (h: ReturnType<typeof makeHarness>, ms: number): string => new Date(h.clock.now().getTime() - ms).toISOString()
const list = (h: ReturnType<typeof makeHarness>) => h.core.router.call('attention.list', undefined)

describe('attention.list (SRC-001 "Требует внимания")', () => {
  function seedEverything(h: ReturnType<typeof makeHarness>) {
    const channel = h.channel({ target: 'r/astrology' })
    const approval = seedOpportunity(h.core, channel.id, { state: 'awaiting_approval', updatedAt: ago(h, 1 * HOUR) })
    seedDraft(h.core, approval, 'Thanks for asking! Natal Mystic builds charts from birth data.')
    const draft = seedOpportunity(h.core, channel.id, { state: 'draft', kind: 'standalone', updatedAt: ago(h, 2 * HOUR) })
    const question = seedOpportunity(h.core, channel.id, { state: 'needs_user', reason: 'Which price should I quote?', updatedAt: ago(h, 3 * HOUR) })
    const unknownOpp = seedOpportunity(h.core, channel.id, { state: 'unknown_result', updatedAt: ago(h, 4 * HOUR) })
    const { actionId } = seedSend(h.core, { opportunityId: unknownOpp, accountId: h.account.id, state: 'unknown', completedAt: null, attemptedAt: ago(h, 4 * HOUR) })
    seedOpportunity(h.core, channel.id, { state: 'discovered' })
    seedOpportunity(h.core, channel.id, { state: 'confirmed' })
    const expired = seedAccount(h.core, { label: 'Old login', status: 'login_required' })
    const captcha = seedAccount(h.core, { label: 'Captcha acct', status: 'captcha' })
    const broken = h.channel({ target: 'r/broken', status: 'error', statusDetail: 'Page structure changed' })
    const stuck = h.channel({ target: 'r/stuck', status: 'needs_user', statusDetail: 'Rules forbid bots' })
    // Explained by the expired account's own item: must not appear a second time.
    h.channel({ target: 'r/dup', accountId: expired.id, status: 'needs_user' })
    return { approval, draft, question, unknownOpp, actionId, expired, captcha, broken, stuck }
  }

  it('aggregates approvals, drafts, questions, unknown results, logins, CAPTCHAs and channel problems', async () => {
    const h = makeHarness()
    const s = seedEverything(h)

    const items = await list(h)

    const byId = new Map(items.map((i) => [i.id, i]))
    expect(byId.get(`approval:${s.approval}`)).toMatchObject({ kind: 'approval', refType: 'opportunity', refId: s.approval, title: 'Approve reply in r/astrology' })
    expect(byId.get(`approval:${s.approval}`)?.detail).toContain('Natal Mystic builds charts')
    expect(byId.get(`draft:${s.draft}`)).toMatchObject({ kind: 'draft', refType: 'opportunity', title: 'Review draft publication in r/astrology' })
    expect(byId.get(`question:${s.question}`)).toMatchObject({ kind: 'question', detail: 'Which price should I quote?' })
    expect(byId.get(`unknown_result:${s.actionId}`)).toMatchObject({ kind: 'unknown_result', refType: 'opportunity', refId: s.unknownOpp })
    expect(byId.get(`login:${s.expired.id}`)).toMatchObject({ kind: 'login', refType: 'account', refId: s.expired.id })
    expect(byId.get(`captcha:${s.captcha.id}`)).toMatchObject({ kind: 'captcha', refType: 'account' })
    expect(byId.get(`error:${s.broken.id}`)).toMatchObject({ kind: 'error', refType: 'channel', detail: 'Page structure changed' })
    expect(byId.get(`connection:${s.stuck.id}`)).toMatchObject({ kind: 'connection', refType: 'channel', detail: 'Rules forbid bots' })
    // discovered / confirmed opportunities and the duplicate channel row are not attention items.
    expect(items).toHaveLength(8)
  })

  it('uses stable ids and lists the newest item first', async () => {
    const h = makeHarness()
    seedEverything(h)

    const first = await list(h)
    h.clock.advance(HOUR)
    const second = await list(h)

    expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id))
    expect(new Set(first.map((i) => i.id)).size).toBe(first.length)
    const times = first.map((i) => i.createdAt)
    expect(times).toEqual([...times].sort().reverse())
    // A long-standing login problem keeps the time it was first seen instead of looking new on every refresh.
    const login = (items: typeof first) => items.find((i) => i.kind === 'login')!.createdAt
    expect(login(second)).toBe(login(first))
  })

  it('suggests a channel that keeps failing even though its status is still active', async () => {
    const h = makeHarness()
    const channel = h.channel()
    h.monitor.behaviors.set(channel.id, async () => {
      throw new Error('net::ERR_CONNECTION_RESET')
    })
    await h.start()
    for (let i = 0; i < 3; i++) {
      const next = Date.parse(h.core.repos.channel(channel.id).nextCheckAt!)
      await h.elapse(next - h.clock.now().getTime())
    }

    const items = await list(h)
    const item = items.find((i) => i.id === `connection:${channel.id}`)
    expect(item?.title).toContain('keeps failing')
    expect(item?.detail).toContain('net::ERR_CONNECTION_RESET')
  })

  it('emits changed "attention" when the underlying data changes, and only then', async () => {
    const h = makeHarness()
    const channel = h.channel({ nextCheckAt: new Date(h.clock.now().getTime() + 24 * HOUR).toISOString() })
    await h.start()
    const events: ApiEvent[] = []
    h.core.events.subscribe((e) => events.push(e))
    const attentionEvents = () => events.filter((e) => e.type === 'changed' && e.scope === 'attention').length

    const id = seedOpportunity(h.core, channel.id, { state: 'awaiting_approval' })
    h.core.events.changed('opportunities')
    await flush()
    expect(attentionEvents()).toBe(1)
    expect(h.automation.attentionCount()).toBe(1)

    h.core.events.changed('opportunities')
    await flush()
    expect(attentionEvents()).toBe(1)

    h.core.db.prepare("UPDATE opportunities SET state = 'confirmed' WHERE id = ?").run(id)
    h.core.events.changed('opportunities')
    await flush()
    expect(attentionEvents()).toBe(2)
    expect(h.automation.attentionCount()).toBe(0)

    h.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(h.account.id)
    h.core.events.changed('accounts')
    await flush()
    expect(attentionEvents()).toBeGreaterThanOrEqual(3)
    expect((await list(h)).some((i) => i.kind === 'login')).toBe(true)
  })
})

describe('Notifications for attention items (REQ-005, settings.notifications)', () => {
  async function started() {
    const h = makeHarness()
    const channel = h.channel({ nextCheckAt: new Date(h.clock.now().getTime() + 24 * HOUR).toISOString() })
    await h.start()
    const add = async (state: 'awaiting_approval' | 'draft' = 'awaiting_approval') => {
      const id = seedOpportunity(h.core, channel.id, { state })
      h.core.events.changed('opportunities')
      await flush()
      return id
    }
    return { h, channel, add }
  }

  it('notifies once per new item and never repeats it', async () => {
    const { h, add } = await started()
    expect(h.sink.sent).toHaveLength(0)

    await add()
    expect(h.sink.sent).toHaveLength(1)
    expect(h.sink.sent[0]).toMatchObject({ kind: 'attention' })
    expect(h.sink.sent[0].title).toContain('Approve reply')

    h.core.events.changed('opportunities')
    h.core.events.changed('channels')
    await flush()
    expect(h.sink.sent).toHaveLength(1)
  })

  it('announces an item again only after it was resolved and came back', async () => {
    const { h, channel, add } = await started()
    const id = await add()
    h.core.db.prepare("UPDATE opportunities SET state = 'confirmed' WHERE id = ?").run(id)
    h.core.events.changed('opportunities')
    await flush()

    h.core.db.prepare("UPDATE opportunities SET state = 'awaiting_approval' WHERE id = ?").run(id)
    h.core.events.changed('opportunities')
    await flush()
    expect(h.sink.sent).toHaveLength(2)
    expect(channel.id).toBeTruthy()
  })

  it('is silent when notifications are switched off in settings', async () => {
    const { h, add } = await started()
    h.core.settings.updateApp({ notifications: false })
    await add()
    expect(h.sink.sent).toHaveLength(0)
  })

  it('honors the per-channel notifications flag', async () => {
    const { h, channel, add } = await started()
    h.core.db.prepare('UPDATE channels SET settings_json = ? WHERE id = ?').run(JSON.stringify({ notifications: false }), channel.id)
    await add()
    expect(h.sink.sent).toHaveLength(0)
    // The item is remembered as seen, so turning the flag on later does not replay it.
    h.core.db.prepare('UPDATE channels SET settings_json = ? WHERE id = ?').run(JSON.stringify({ notifications: true }), channel.id)
    h.core.events.changed('opportunities')
    await flush()
    expect(h.sink.sent).toHaveLength(0)
  })

  it('collapses a burst of new items into one notification instead of spamming', async () => {
    const { h, channel } = await started()
    for (let i = 0; i < 5; i++) seedOpportunity(h.core, channel.id, { state: 'awaiting_approval' })
    h.core.events.changed('opportunities')
    await flush()
    expect(h.sink.sent).toHaveLength(1)
    expect(h.sink.sent[0].title).toBe('5 items need your attention')
  })

  it('does not re-announce items after a restart', async () => {
    const { h, add } = await started()
    await add()
    const items = await list(h)
    expect(h.sink.sent).toHaveLength(1)

    const afterRestart = new AttentionNotifier(h.core, h.sink)
    expect(afterRestart.consider(items)).toBe(0)
    expect(h.sink.sent).toHaveLength(1)
  })
})

describe('Daily digest', () => {
  // Local wall-clock times keep these tests independent of the machine's time zone.
  const at = (hours: number, minutes: number, dayOffset = 0): string => new Date(2026, 10, 8 + dayOffset, hours, minutes).toISOString()

  it('is sent once per local day, at or after the channel digest time, summarizing what happened', async () => {
    const h = makeHarness()
    h.clock.set(at(9, 0))
    const channel = h.channel({ target: 'r/astrology', settings: { digestTime: '10:00' } })
    seedComment(h.core, channel.id, { firstSeenAt: at(8, 0) })
    seedComment(h.core, channel.id, { firstSeenAt: at(8, 30) })
    seedComment(h.core, channel.id, { firstSeenAt: at(8, 30), baseline: true })
    seedComment(h.core, channel.id, { firstSeenAt: at(8, 30), isOwn: true })
    seedOpportunity(h.core, channel.id, { state: 'awaiting_approval' })
    const sent = seedOpportunity(h.core, channel.id, { state: 'confirmed' })
    seedSend(h.core, { opportunityId: sent, accountId: h.account.id, state: 'confirmed', completedAt: at(8, 45) })

    expect(sendDueDigests(h.core, h.sink)).toBe(0)
    h.clock.set(at(10, 0))
    expect(sendDueDigests(h.core, h.sink)).toBe(1)
    expect(h.sink.sent[0]).toMatchObject({ kind: 'digest', title: 'Daily summary: r/astrology', body: '2 new comments, 1 waiting for you, 1 sent.' })

    h.clock.set(at(22, 0))
    expect(sendDueDigests(h.core, h.sink)).toBe(0)
    h.clock.set(at(10, 5, 1))
    expect(sendDueDigests(h.core, h.sink)).toBe(1)
    expect(h.sink.sent[1].body).toBe('1 waiting for you.')
  })

  it('arrives through the scheduler even while automation is paused, and respects the notification switches', async () => {
    const h = makeHarness()
    h.clock.set(at(9, 50))
    h.channel({ target: 'r/a', nextCheckAt: at(9, 50, 3), settings: { digestTime: '10:00' } })
    h.channel({ target: 'r/muted', nextCheckAt: at(9, 50, 3), settings: { digestTime: '10:00', notifications: false } })
    h.core.settings.setRaw('automation.paused', true)
    await h.start()
    await h.elapse(5 * MINUTE_MS)
    expect(h.sink.sent).toHaveLength(0)

    await h.elapse(10 * MINUTE_MS)
    expect(h.sink.sent.map((n) => n.title)).toEqual(['Daily summary: r/a'])
    await h.elapse(2 * HOUR)
    expect(h.sink.sent).toHaveLength(1)
  })

  it('ignores an invalid digest time', () => {
    const h = makeHarness()
    h.clock.set(at(12, 0))
    h.channel({ settings: { digestTime: '25:99' } })
    h.channel({ settings: { digestTime: null } })
    expect(sendDueDigests(h.core, h.sink)).toBe(0)
  })
})
