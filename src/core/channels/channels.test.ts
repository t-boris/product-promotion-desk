import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHANNEL_SETTINGS, type Channel } from '../../shared/types'
import { newId } from '../db/database'
import { FakeConnector } from '../testing/fake-connector'
import { makeTestCore } from '../testing/fakes'
import { makeReadyWorld, type World } from './test-helpers'

async function connect(w: World, target = 'r/astrology', productId = w.productId): Promise<Channel> {
  return w.call('channels.connect', { productId, accountId: w.account.id, target })
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
    expect(channel.capabilities).toHaveLength(8)
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
    await connect(w, 'r/astrology', other)
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
    expect(updated.settings).toEqual({ languages: ['en', 'es'], style: 'warm, short', topics: ['astrology'], queries: ['birth chart app'], checkIntervalMin: 15, limits: { perHour: 1, perDay: 3 }, autoCategories: ['thanks'], digestTime: '09:00', notifications: false })
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
      .run(JSON.stringify([{ key: 'publish_reply', status: 'restricted', detail: 'The rules ban automated replies.', checkedAt: null }]), channel.id)
    await expect(w.call('channels.setMode', { channelId: channel.id, mode: 'approval' })).rejects.toThrow(/forbidden by the community rules: The rules ban automated replies/)
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

  it('deletes the channel together with its history and frees the account', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    seedSend(w, channel.id, 'confirmed')
    await w.call('channels.remove', { id: channel.id })
    expect(await w.call('channels.list', undefined)).toEqual([])
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toEqual({ n: 0 })
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM send_actions').get()).toEqual({ n: 0 })
    await w.call('accounts.remove', { id: w.account.id })
  })

  it('refuses while a send has no known result: that record may be the only proof of a publication', async () => {
    const w = await makeReadyWorld()
    for (const state of ['unknown', 'sending'] as const) {
      const channel = await connect(w, `r/room-${state}`)
      seedSend(w, channel.id, state as 'unknown')
      expect(await w.refusal('channels.remove', { id: channel.id })).toBe('unresolved_sends')
      expect(w.core.repos.channel(channel.id)).toBeTruthy()
    }
  })

  it('allows removal once the unresolved send has been resolved', async () => {
    const w = await makeReadyWorld()
    const channel = await connect(w)
    seedSend(w, channel.id, 'unknown')
    w.core.db.prepare("UPDATE send_actions SET state = 'failed'").run()
    await w.call('channels.remove', { id: channel.id })
    expect(await w.call('channels.list', undefined)).toEqual([])
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
    const account = await first.core.router.call('accounts.create', { platform: 'fake', label: 'Natal Mystic Reddit' })
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
