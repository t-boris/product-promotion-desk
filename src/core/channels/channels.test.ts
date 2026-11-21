import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHANNEL_SETTINGS, type Channel } from '../../shared/types'
import { newId } from '../db/database'
import { FakeConnector } from '../testing/fake-connector'
import { makeTestCore } from '../testing/fakes'
import { nextCheckFor } from '../pipeline/scheduler-timing'
import { makeReadyWorld, type World } from './test-helpers'

async function connect(w: World, target = 'r/astrology', productId = w.productId, reuseAccount = false): Promise<Channel> {
  return w.call('channels.connect', { productId, accountId: w.account.id, target, ...(reuseAccount ? { reuseAccount } : {}) })
}

describe('channels.connect', () => {
  it('creates an unassessed channel in setup and observe mode with default settings', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w, 'https://fake.test/r/astrology')
    expect(channel).toMatchObject({
      productId: w.productId,
      accountId: w.account.id,
      platform: 'fake',
      connectorId: 'fake',
      target: 'r/astrology',
      url: 'https://fake.test/r/astrology',
      mode: 'observe',
      status: 'setup',
      baselineDoneAt: null
    })
    expect(channel.settings).toEqual(DEFAULT_CHANNEL_SETTINGS)
    expect(channel.capabilities).toHaveLength(9)
    expect(channel.capabilities.every((c) => c.status === 'needs_check' && c.checkedAt === null)).toBe(true)
    expect(await w.call('channels.list', undefined)).toEqual([channel])
  })

  it('does nothing on the platform: no page is opened and nothing is sent', async () => {
    const w = await makeReadyWorld()
    await connect(w)
    expect(w.fake.calls).toEqual([])
    expect(w.fake.published).toEqual([])
    expect(w.t.browser.pages.size).toBe(0)
  })

  it('refuses the same product, account and address twice, whatever the spelling', async () => {
    const w = await makeReadyWorld()
    await connect(w, 'r/astrology')
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://fake.test/r/astrology/' })).toBe('duplicate')
    expect(await w.call('channels.list', undefined)).toHaveLength(1)
  })

  it('allows the same address for another product, and one account for several channels', async () => {
    const w = await makeReadyWorld()
    const other = w.addProduct('Another product')
    await connect(w, 'r/astrology')
    await connect(w, 'r/astrology', other, true)
    await connect(w, 'r/tarot')
    const channels = await w.call('channels.list', undefined)
    expect(channels).toHaveLength(3)
    expect(new Set(channels.map((c) => c.accountId)).size).toBe(1)
  })

  it('refuses unknown products and accounts, empty or unusable addresses, and addresses no connector handles', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('channels.connect', { productId: 'nope', accountId: w.account.id, target: 'r/x' })).toBe('not_found')
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: 'nope', target: 'r/x' })).toBe('not_found')
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: w.account.id, target: '  ' })).toBe('invalid_input')
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://unknown.example/forum' })).toBe('no_connector')
    class Picky extends FakeConnector {
      override normalizeTarget(): never {
        throw new Error('That is not a community address')
      }
    }
    const picky = await makeReadyWorld({ fake: new Picky() })
    expect(await picky.refusal('channels.connect', { productId: picky.productId, accountId: picky.account.id, target: 'r/x' })).toBe('invalid_target')
  })

  it('announces the new channel', async () => {
    const w = await makeReadyWorld()
    w.changes.length = 0
    await connect(w)
    expect(w.changes).toContain('channels')
  })
})

describe('channels.updateSettings', () => {
  it('stores validated settings and returns the updated channel', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    const updated = await w.call('channels.updateSettings', {
      channelId: channel.id,
      settings: { languages: ['en', 'es'], style: 'warm, short', topics: ['astrology'], queries: ['birth chart app'], checkIntervalMin: 15, limits: { perHour: 1, perDay: 3 }, digestTime: '09:00', notifications: false, autoCategories: ['thanks'] }
    })
    expect(updated.settings).toEqual({ languages: ['en', 'es'], style: 'warm, short', topics: ['astrology'], queries: ['birth chart app'], checkIntervalMin: 15, lookBackDays: 30, limits: { perHour: 1, perDay: 3 }, autoCategories: ['thanks'], digestTime: '09:00', notifications: false, mix: [] })
    expect((await w.call('channels.list', undefined))[0].settings).toEqual(updated.settings)
  })

  it('refuses invalid values and leaves the stored settings untouched', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    for (const settings of [{ checkIntervalMin: 4 }, { limits: { perHour: -1 } }, { limits: { perDay: 2.5 } }, { digestTime: '25:00' }, { autoCategories: ['refund_request'] }]) {
      expect(await w.refusal('channels.updateSettings', { channelId: channel.id, settings: settings as never })).toBe('invalid_input')
    }
    expect((await w.call('channels.list', undefined))[0].settings).toEqual(DEFAULT_CHANNEL_SETTINGS)
  })

  it('refuses a first look of a negative, fractional or too long number of days', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    for (const lookBackDays of [-1, -5, 1.5, 31]) {
      expect(await w.refusal('channels.updateSettings', { channelId: channel.id, settings: { lookBackDays } })).toBe('invalid_input')
    }
    for (const lookBackDays of [0, 7, 30]) {
      expect((await w.call('channels.updateSettings', { channelId: channel.id, settings: { lookBackDays } })).settings.lookBackDays).toBe(lookBackDays)
    }
  })

  describe('a new interval and the planned check (DEC-040)', () => {
    const MIN = 60_000
    const plan = (w: World, channel: Channel, intervalMin: number, minutesFromNow: number | null, status = 'active'): string | null => {
      const at = minutesFromNow === null ? null : new Date(w.core.clock.now().getTime() + minutesFromNow * MIN).toISOString()
      w.core.db.prepare('UPDATE channels SET status = ?, next_check_at = ?, settings_json = json_set(settings_json, ?, ?) WHERE id = ?').run(status, at, '$.checkIntervalMin', intervalMin, channel.id)
      return at
    }
    const nextCheck = (w: World, channel: Channel): string | null => (w.core.db.prepare('SELECT next_check_at AS at FROM channels WHERE id = ?').get(channel.id) as { at: string | null }).at
    const inMinutes = (w: World, iso: string | null): number => (new Date(iso!).getTime() - w.core.clock.now().getTime()) / MIN

    it('moves the planned check earlier when the interval gets shorter', async () => {
      const w = await makeReadyWorld()
      const channel = await connect(w)
      plan(w, channel, 1440, 1000)
      await w.call('channels.updateSettings', { channelId: channel.id, settings: { checkIntervalMin: 60 } })
      expect(inMinutes(w, nextCheck(w, channel))).toBe(60)
    })

    it('keeps a planned check that is already sooner than the new interval, and one that the interval did not change', async () => {
      const w = await makeReadyWorld()
      const channel = await connect(w)
      const soon = plan(w, channel, 60, 10)
      await w.call('channels.updateSettings', { channelId: channel.id, settings: { checkIntervalMin: 1440 } })
      expect(nextCheck(w, channel)).toBe(soon)
      const later = plan(w, channel, 1440, 900)
      await w.call('channels.updateSettings', { channelId: channel.id, settings: { style: 'warm' } })
      expect(nextCheck(w, channel)).toBe(later)
    })

    it('leaves a channel with no planned check without one (paused, in setup, waiting for the owner)', async () => {
      const w = await makeReadyWorld()
      const channel = await connect(w)
      plan(w, channel, 1440, null, 'paused')
      await w.call('channels.updateSettings', { channelId: channel.id, settings: { checkIntervalMin: 60 } })
      expect(nextCheck(w, channel)).toBeNull()
    })

    it('uses the same time the scheduler would, jitter included, and never plans sooner than a minute', async () => {
      const w = await makeReadyWorld({ scheduleJitter: true })
      const channel = await connect(w)
      plan(w, channel, 1440, 1000)
      const updated = await w.call('channels.updateSettings', { channelId: channel.id, settings: { checkIntervalMin: 60 } })
      const planned = nextCheck(w, channel)
      expect(planned).toBe(nextCheckFor({ id: channel.id, lastRunAt: updated.lastRunAt, settings: updated.settings }, w.core.clock.now().getTime(), true))
      expect(Math.abs(inMinutes(w, planned) - 60)).toBeLessThanOrEqual(6)
    })
  })

  it('does not let automatic categories be emptied while the channel is in automatic mode', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    await w.call('channels.updateSettings', { channelId: channel.id, settings: { autoCategories: ['thanks'] } })
    await w.call('channels.setMode', { channelId: channel.id, mode: 'auto' })
    expect(await w.refusal('channels.updateSettings', { channelId: channel.id, settings: { autoCategories: [] } })).toBe('mode_not_allowed')
    expect((await w.call('channels.list', undefined))[0].settings.autoCategories).toEqual(['thanks'])
    await w.call('channels.updateSettings', { channelId: channel.id, settings: { autoCategories: ['faq'] } })
  })

  it('refuses an unknown channel', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('channels.updateSettings', { channelId: 'nope', settings: {} })).toBe('not_found')
  })
})

describe('channels.setMode (REQ-003)', () => {
  const setCapability = (w: World, channelId: string, key: string, status: string): void => {
    const row = w.core.repos.channel(channelId)
    const capabilities = row.capabilities.map((c) => (c.key === key ? { ...c, status } : c))
    w.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(JSON.stringify(capabilities), channelId)
  }

  it('always allows observing and drafting, even where replying is forbidden or impossible', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    for (const status of ['restricted', 'unavailable']) {
      setCapability(w, channel.id, 'publish_reply', status)
      expect((await w.call('channels.setMode', { channelId: channel.id, mode: 'draft' })).mode).toBe('draft')
      expect((await w.call('channels.setMode', { channelId: channel.id, mode: 'observe' })).mode).toBe('observe')
    }
  })

  it('refuses approval and automatic modes when replying is restricted or unavailable', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    await w.call('channels.updateSettings', { channelId: channel.id, settings: { autoCategories: ['thanks'] } })
    for (const status of ['restricted', 'unavailable']) {
      setCapability(w, channel.id, 'publish_reply', status)
      for (const mode of ['approval', 'auto'] as const) {
        expect(await w.refusal('channels.setMode', { channelId: channel.id, mode })).toBe('mode_not_allowed')
      }
    }
    expect((await w.call('channels.list', undefined))[0].mode).toBe('observe')
  })

  it('explains why in words the person can act on', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    w.core.db
      .prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify([{ key: 'publish_reply', status: 'restricted', detail: 'This account is banned from r/test.', checkedAt: null }]), channel.id)
    await expect(w.call('channels.setMode', { channelId: channel.id, mode: 'approval' })).rejects.toThrow(/not allowed by the community: This account is banned from r\/test/)
  })

  it('allows approval mode where replying still needs checking, and requires categories for automatic mode', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    expect((await w.call('channels.setMode', { channelId: channel.id, mode: 'approval' })).mode).toBe('approval')
    expect(await w.refusal('channels.setMode', { channelId: channel.id, mode: 'auto' })).toBe('mode_not_allowed')
    await w.call('channels.updateSettings', { channelId: channel.id, settings: { autoCategories: ['faq'] } })
    expect((await w.call('channels.setMode', { channelId: channel.id, mode: 'auto' })).mode).toBe('auto')
  })

  it('refuses a mode that does not exist and an unknown channel', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    expect(await w.refusal('channels.setMode', { channelId: channel.id, mode: 'yolo' as never })).toBe('invalid_input')
    expect(await w.refusal('channels.setMode', { channelId: 'nope', mode: 'draft' })).toBe('not_found')
  })
})

describe('core.services.channels.markCapabilityVerified', () => {
  it('is provided to the sending service and verifies a capability by actual use', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    w.t.clock.set('2026-11-09T08:30:00.000Z')
    w.changes.length = 0
    w.core.services.channels?.markCapabilityVerified(channel.id, 'publish_reply', 'Reply confirmed at https://fake.test/r/astrology/c/1')
    const stored = w.core.repos.channel(channel.id).capabilities
    expect(stored.find((c) => c.key === 'publish_reply')).toEqual({ key: 'publish_reply', status: 'verified', detail: 'Reply confirmed at https://fake.test/r/astrology/c/1', checkedAt: '2026-11-09T08:30:00.000Z' })
    expect(stored.filter((c) => c.status === 'verified')).toHaveLength(1)
    expect(w.changes).toContain('channels')
  })

  it('does not fail the sender when the channel has been removed meanwhile', async () => {
    const w = await makeReadyWorld()
    expect(() => w.core.services.channels?.markCapabilityVerified('gone', 'publish_post', 'x')).not.toThrow()
    expect(w.core.log.list(5).some((e) => e.level === 'warn' && /no longer exists/.test(e.message))).toBe(true)
  })
})

describe('channels.remove', () => {
  function seedSend(w: World, channelId: string, state: 'confirmed' | 'unknown' | 'failed'): void {
    const now = w.core.clock.now().toISOString()
    const [opp, draft, approval, action] = [newId(), newId(), newId(), newId()]
    const db = w.core.db
    db.prepare("INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, created_at, updated_at) VALUES (?, ?, ?, 'reply', 'sent', 'https://fake.test/x', ?, ?)").run(opp, channelId, w.productId, now, now)
    db.prepare("INSERT INTO drafts (id, opportunity_id, text, author, created_at) VALUES (?, ?, 'hello', 'ai', ?)").run(draft, opp, now)
    db.prepare("INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES (?, ?, 'h', ?, 'https://fake.test/x', 'user', ?)").run(approval, draft, w.account.id, now)
    db.prepare(
      "INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis) VALUES (?, ?, ?, ?, 'h', ?, 'https://fake.test/x', ?, ?, 'user approval')"
    ).run(action, opp, draft, approval, w.account.id, state, now)
  }

  it('deletes a channel that never sent anything, together with its discussions, and frees the account', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    await w.call('channels.remove', { id: channel.id })
    expect(await w.call('channels.list', undefined)).toEqual([])
    await w.call('accounts.remove', { id: w.account.id })
  })

  it.each(['confirmed', 'failed'] as const)('refuses to remove a channel with a %s send of the last 24 hours: the account\'s limits still count it', async (state) => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    seedSend(w, channel.id, state)
    const error = await w.call('channels.remove', { id: channel.id }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'sent_recently' })
    expect((error as Error).message).toMatch(/can be removed after/)
    expect((error as Error).message).toMatch(/can be paused/)
    expect(w.core.repos.channel(channel.id)).toBeTruthy()
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM send_actions').get()).toEqual({ n: 1 })
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toEqual({ n: 1 })
  })

  it('refuses while a send has no known result with the more specific reason', async () => {
    const w = await makeReadyWorld()
    for (const state of ['unknown', 'sending'] as const) {
      const channel = await connect(w, `r/room-${state}`)
      seedSend(w, channel.id, state as 'unknown')
      expect(await w.refusal('channels.remove', { id: channel.id })).toBe('unresolved_sends')
      expect(w.core.repos.channel(channel.id)).toBeTruthy()
    }
  })

  it('keeps refusing after an unresolved send was resolved, while it is still a send of the last day', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    seedSend(w, channel.id, 'unknown')
    w.core.db.prepare("UPDATE send_actions SET state = 'failed'").run()
    expect(await w.refusal('channels.remove', { id: channel.id })).toBe('sent_recently')
  })

  it('removes an old channel with its history once its last send is more than a day old, and the account stays', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    seedSend(w, channel.id, 'confirmed')
    const old = new Date(w.core.clock.now().getTime() - 25 * 60 * 60 * 1000).toISOString()
    w.core.db.prepare('UPDATE send_actions SET attempted_at = ?').run(old)
    await w.call('channels.remove', { id: channel.id })
    expect(await w.call('channels.list', undefined)).toEqual([])
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM send_actions').get()).toEqual({ n: 0 })
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toEqual({ n: 0 })
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE id = ?').get(w.account.id)).toEqual({ n: 1 })
  })

  it('still refuses an old channel while one of its sends has no known result, however old', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    seedSend(w, channel.id, 'unknown')
    w.core.db.prepare('UPDATE send_actions SET attempted_at = ?').run(new Date(w.core.clock.now().getTime() - 72 * 60 * 60 * 1000).toISOString())
    expect(await w.refusal('channels.remove', { id: channel.id })).toBe('unresolved_sends')
  })

  it('refuses an unknown channel', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('channels.remove', { id: 'nope' })).toBe('not_found')
  })
})

describe('persistence across restarts (REQ-002)', () => {
  it('keeps the account, its session partition, settings and assessed capabilities', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'ppd-restart-')), 'app.db')
    const first = makeTestCore({ dbPath, connectors: [new FakeConnector()] })
    const now = first.clock.now().toISOString()
    first.core.db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Natal Mystic', now, now)
    const account = await first.core.router.call('accounts.create', { productId: 'p1', platform: 'fake', label: 'Natal Mystic Reddit' })
    const channel = await first.core.router.call('channels.connect', { productId: 'p1', accountId: account.id, target: 'r/astrology' })
    await first.core.router.call('channels.updateSettings', { channelId: channel.id, settings: { style: 'warm', checkIntervalMin: 20 } })
    const assessed = await first.core.router.call('channels.assess', { channelId: channel.id })
    await first.core.shutdown()

    const second = makeTestCore({ dbPath, connectors: [new FakeConnector()] })
    const [storedAccount] = await second.core.router.call('accounts.list', undefined)
    const [storedChannel] = await second.core.router.call('channels.list', undefined)
    expect(storedAccount).toMatchObject({ id: account.id, partition: account.partition, label: 'Natal Mystic Reddit' })
    expect(storedChannel.settings).toMatchObject({ style: 'warm', checkIntervalMin: 20 })
    expect(storedChannel.capabilities).toEqual(assessed.capabilities)
    expect(storedChannel.capabilities.find((c) => c.key === 'read_posts')?.checkedAt).not.toBeNull()
    await second.core.shutdown()
  })
})

describe('connector storage', () => {
  it('hands the application database to connectors that keep their own data in it', async () => {
    const bound: unknown[] = []
    class WithStorage extends FakeConnector {
      bindStorage(storage: { db: unknown; clock: unknown }): void {
        bound.push(storage)
      }
    }
    const t = makeTestCore({ connectors: [new WithStorage(), new FakeConnector({ id: 'plain' })] })
    expect(bound).toHaveLength(1)
    expect(bound[0]).toMatchObject({ db: t.core.db, clock: t.core.clock })
  })
})
