// DEC-009 / REQ-008: accounts and channels belong to the product; another product's login is shared only by consent.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate } from '../db/database'
import { MIGRATIONS } from '../db/migrations'
import { FakeConnector } from '../testing/fake-connector'
import { makeReadyWorld, makeWorld, OtherConnector, OverlapProbe } from './test-helpers'

describe('accounts belong to a product', () => {
  it('creates an account for an existing product and records it', async () => {
    const w = makeWorld()
    const account = await w.addAccount('Brand account')
    expect(account.productId).toBe(w.productId)
    expect(w.core.repos.account(account.id).productId).toBe(w.productId)
  })

  it('refuses an unknown product, a missing product and an unknown platform', async () => {
    const w = makeWorld()
    expect(await w.refusal('accounts.create', { productId: 'nope', platform: 'fake', label: 'X' })).toBe('not_found')
    expect(await w.refusal('accounts.create', { productId: ' ', platform: 'fake', label: 'X' })).toBe('invalid_input')
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'myspace', label: 'X' })).toBe('invalid_input')
    expect(await w.call('accounts.list', undefined)).toEqual([])
  })

  it('gives every account of every product its own browser partition', async () => {
    const w = makeWorld()
    const second = w.addProduct('Second')
    const accounts = [await w.addAccount('A'), await w.addAccount('B', second)]
    expect(new Set(accounts.map((a) => a.partition)).size).toBe(2)
  })

  it('lists one product\'s accounts plus the unassigned ones; without an argument, all', async () => {
    const w = makeWorld()
    const second = w.addProduct('Second')
    const mine = await w.addAccount('Mine')
    const theirs = await w.addAccount('Theirs', second)
    const legacy = await w.addAccount('Legacy')
    w.core.db.prepare('UPDATE accounts SET product_id = NULL WHERE id = ?').run(legacy.id)
    const ids = async (productId?: string) => (await w.call('accounts.list', productId ? { productId } : undefined)).map((a) => a.id).sort()
    expect(await ids(w.productId)).toEqual([mine.id, legacy.id].sort())
    expect(await ids(second)).toEqual([theirs.id, legacy.id].sort())
    expect(await ids()).toEqual([mine.id, theirs.id, legacy.id].sort())
  })
})

describe('channels belong to a product', () => {
  it('lists only the channels of the asked product', async () => {
    const w = makeWorld()
    const second = w.addProduct('Second')
    const a = await w.addAccount('A')
    const b = await w.addAccount('B', second)
    const one = await w.call('channels.connect', { productId: w.productId, accountId: a.id, target: 'r/astrology' })
    const two = await w.call('channels.connect', { productId: second, accountId: b.id, target: 'r/tarot' })
    expect((await w.call('channels.list', { productId: w.productId })).map((c) => c.id)).toEqual([one.id])
    expect((await w.call('channels.list', { productId: second })).map((c) => c.id)).toEqual([two.id])
    expect((await w.call('channels.list', undefined)).map((c) => c.id).sort()).toEqual([one.id, two.id].sort())
  })
})

describe('using another product\'s login', () => {
  async function twoProducts() {
    const w = await makeReadyWorld()
    const second = w.addProduct('Tarot Deck')
    return { w, second }
  }

  it('is refused without confirmation, with a message that names the owner and the way out', async () => {
    const { w, second } = await twoProducts()
    const error = await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot' }).catch((e: unknown) => e)
    expect(error).toMatchObject({
      code: 'account_other_product',
      message: 'This login belongs to "Natal Mystic". Use a separate login for this product, or confirm that you want to share it.'
    })
    expect(await w.call('channels.list', { productId: second })).toEqual([])
  })

  it('is refused when reuseAccount is anything but true', async () => {
    const { w, second } = await twoProducts()
    const args = { productId: second, accountId: w.account.id, target: 'r/tarot' }
    expect(await w.refusal('channels.connect', { ...args, reuseAccount: false })).toBe('account_other_product')
  })

  it('proceeds with consent, logs a warning naming both products, and leaves the owner unchanged', async () => {
    const { w, second } = await twoProducts()
    const channel = await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot', reuseAccount: true })
    expect(channel.productId).toBe(second)
    expect(w.core.repos.account(w.account.id).productId).toBe(w.productId)
    const warning = w.core.log.list(50, 'warn').find((e) => e.message.includes('Tarot Deck'))
    expect(warning?.message).toMatch(/Natal Mystic.*Tarot Deck|Tarot Deck.*Natal Mystic/)
  })

  it('needs no consent for the product that owns the login', async () => {
    const { w } = await twoProducts()
    await expect(w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })).resolves.toMatchObject({ productId: w.productId })
  })

  it('adopts an unassigned (legacy) account for the product that first uses it, and keeps it afterwards', async () => {
    const { w, second } = await twoProducts()
    w.core.db.prepare('UPDATE accounts SET product_id = NULL WHERE id = ?').run(w.account.id)
    await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot' })
    expect(w.core.repos.account(w.account.id).productId).toBe(second)
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })).toBe('account_other_product')
  })

  it('does not adopt or change anything when the connection itself is refused', async () => {
    const { w, second } = await twoProducts()
    w.core.db.prepare('UPDATE accounts SET product_id = NULL WHERE id = ?').run(w.account.id)
    expect(await w.refusal('channels.connect', { productId: second, accountId: w.account.id, target: '   ' })).toBe('invalid_input')
    expect(w.core.repos.account(w.account.id).productId).toBeNull()
  })

  describe('the shared-account rules still hold (REQ-004)', () => {
    it('both products use one browser session, so only one party controls it at a time', async () => {
      const probe = new OverlapProbe()
      const w = await makeReadyWorld({ fake: probe })
      const second = w.addProduct('Tarot Deck')
      const a = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
      const b = await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot', reuseAccount: true })
      expect(w.core.connectorContext(a.id).ctx.session).toBe(w.core.connectorContext(b.id).ctx.session)
      await Promise.all([w.call('channels.assess', { channelId: a.id }), w.call('channels.assess', { channelId: b.id })])
      expect(probe.maxActive).toBe(1)
      expect(w.t.browser.sessions.size).toBe(1)
    })

    it('stops both products when the person takes the shared browser', async () => {
      const w = await makeReadyWorld()
      const second = w.addProduct('Tarot Deck')
      const a = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
      const b = await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot', reuseAccount: true })
      await w.call('accounts.takeControl', { accountId: w.account.id })
      for (const channel of [a, b]) {
        await expect(w.core.connectorContext(channel.id).ctx.session.withAgentControl('monitor', async () => 1)).rejects.toMatchObject({ name: 'TakeoverError' })
      }
    })

    it('counts the sends of both products against the one account (the SendGate sums per account)', async () => {
      // The gate's allowance is computed from send_actions of the account across ALL its channels; core/pipeline/sending.test.ts
      // proves the budget and the one-at-a-time rule end to end. Here: both products' channels really point at one account row.
      const w = await makeReadyWorld()
      const second = w.addProduct('Tarot Deck')
      await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
      await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot', reuseAccount: true })
      const rows = w.core.db.prepare('SELECT DISTINCT account_id FROM channels').all()
      expect(rows).toEqual([{ account_id: w.account.id }])
    })
  })
})

describe('platforms.list (DEC-009: the catalog comes from the connectors)', () => {
  it('lists the registered connectors with a label, whether they are prepared, and the sign-in page', async () => {
    const w = makeWorld({ extra: [new OtherConnector()] })
    const platforms = await w.call('platforms.list', undefined)
    expect(platforms).toEqual(
      expect.arrayContaining([
        { connectorId: 'fake', platform: 'fake', label: 'Fake', prepared: true, loginUrl: 'https://fake.test/login' },
        { connectorId: 'other', platform: 'other', label: 'Other', prepared: true, loginUrl: expect.any(String) }
      ])
    )
  })

  it('uses a connector\'s own label, and marks the universal connector as not prepared', async () => {
    class Labelled extends FakeConnector {
      readonly label = 'Fancy Forum'
    }
    class Universal extends FakeConnector {
      constructor() {
        super({ id: 'universal', platform: 'web' })
      }
      readonly label = 'Other website'
    }
    const w = makeWorld({ fake: new Labelled(), extra: [new Universal()] })
    const platforms = await w.call('platforms.list', undefined)
    expect(platforms.map((p) => [p.label, p.prepared])).toEqual([
      ['Fancy Forum', true],
      ['Other website', false]
    ])
  })
})

describe('legacy data is attached to its product (migration 200)', () => {
  function legacyDatabase() {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    for (const m of MIGRATIONS.filter((m) => m.id < 200)) {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
    }
    const product = (id: string) => db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, id, 't', 't')
    const account = (id: string, identity: string | null) =>
      db.prepare("INSERT INTO accounts (id, platform, label, identity, partition, status, created_at) VALUES (?, 'reddit', ?, ?, ?, 'ready', 't')").run(id, id, identity, `persist:${id}`)
    const channel = (id: string, productId: string, accountId: string, createdAt: string) =>
      db
        .prepare(
          "INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, mode, settings_json, capabilities_json, status, status_detail, created_at) VALUES (?, ?, ?, 'reddit', 'reddit', ?, 'https://x', 'observe', '{}', '[]', 'setup', '', ?)"
        )
        .run(id, productId, accountId, id, createdAt)
    return { db, product, account, channel }
  }

  it('gives an account the product of its channels; with several products the earliest channel decides; without channels it stays unassigned', () => {
    const { db, product, account, channel } = legacyDatabase()
    product('natal')
    product('tarot')
    account('single', 'natal_bot')
    account('shared', null)
    account('unused', null)
    channel('c1', 'natal', 'single', '2026-01-01')
    channel('c2', 'tarot', 'shared', '2026-02-01')
    channel('c3', 'natal', 'shared', '2026-03-01')

    migrate(db)

    const owner = (id: string) => (db.prepare('SELECT product_id AS p FROM accounts WHERE id = ?').get(id) as { p: string | null }).p
    expect(owner('single')).toBe('natal')
    expect(owner('shared')).toBe('tarot')
    expect(owner('unused')).toBeNull()
    // Nothing else changed: every channel keeps its own product and account.
    expect(db.prepare('SELECT id, product_id, account_id FROM channels ORDER BY id').all()).toEqual([
      { id: 'c1', product_id: 'natal', account_id: 'single' },
      { id: 'c2', product_id: 'tarot', account_id: 'shared' },
      { id: 'c3', product_id: 'natal', account_id: 'shared' }
    ])
  })

  it('remembers the identity an account was signed in with', () => {
    const { db, account } = legacyDatabase()
    account('signed', 'natal_bot')
    account('never', null)
    migrate(db)
    const last = (id: string) => (db.prepare('SELECT last_identity AS i FROM accounts WHERE id = ?').get(id) as { i: string | null }).i
    expect(last('signed')).toBe('natal_bot')
    expect(last('never')).toBeNull()
  })

  it('keeps an account (unassigned) when its product is deleted, instead of deleting the login', () => {
    const { db, product, account } = legacyDatabase()
    product('natal')
    account('a1', null)
    migrate(db)
    db.prepare("UPDATE accounts SET product_id = 'natal' WHERE id = 'a1'").run()
    db.prepare("DELETE FROM products WHERE id = 'natal'").run()
    expect(db.prepare('SELECT product_id AS p FROM accounts WHERE id = ?').get('a1')).toEqual({ p: null })
  })
})

describe('a different account signing in after a logout (last known identity)', () => {
  async function activeAccount() {
    const w = await makeReadyWorld()
    const channel = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
    w.core.db.prepare("UPDATE channels SET status = 'active', status_detail = '' WHERE id = ?").run(channel.id)
    w.fake.login = { loggedIn: true, identity: 'natal_bot', captcha: false }
    await w.call('accounts.checkLogin', { accountId: w.account.id })
    return { w, channelId: channel.id }
  }
  const check = (w: Awaited<ReturnType<typeof makeReadyWorld>>) => w.call('accounts.checkLogin', { accountId: w.account.id })

  it('holds the channels when somebody else signs in after the account was logged out', async () => {
    const { w, channelId } = await activeAccount()
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    expect(await check(w)).toMatchObject({ status: 'login_required', identity: null })
    expect(w.core.repos.channel(channelId).status).toBe('active') // a logout alone is not a change of account

    w.changes.length = 0
    w.fake.login = { loggedIn: true, identity: 'someone_else', captcha: false }
    expect(await check(w)).toMatchObject({ status: 'ready', identity: 'someone_else' })
    expect(w.core.repos.channel(channelId)).toMatchObject({ status: 'needs_user', statusDetail: 'The signed-in account changed; review before sending' })
    expect(w.changes).toEqual(expect.arrayContaining(['channels', 'accounts', 'attention']))
  })

  it('does not hold anything when the same account signs in again after a logout, or after a CAPTCHA', async () => {
    const { w, channelId } = await activeAccount()
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    await check(w)
    w.fake.login = { loggedIn: false, identity: null, captcha: true }
    await check(w)
    w.fake.login = { loggedIn: true, identity: 'natal_bot', captcha: false }
    await check(w)
    expect(w.core.repos.channel(channelId)).toMatchObject({ status: 'active', statusDetail: '' })
  })

  it('does not alarm again once the new account was accepted (the new identity is now the expected one)', async () => {
    const { w, channelId } = await activeAccount()
    w.fake.login = { loggedIn: true, identity: 'someone_else', captcha: false }
    await check(w)
    w.core.db.prepare("UPDATE channels SET status = 'active', status_detail = '' WHERE id = ?").run(channelId)
    w.fake.login = { loggedIn: false, identity: null, captcha: false }
    await check(w)
    w.fake.login = { loggedIn: true, identity: 'someone_else', captcha: false }
    await check(w)
    expect(w.core.repos.channel(channelId).status).toBe('active')
  })

  it('keeps the internal last identity out of the account the interface sees', async () => {
    const { w } = await activeAccount()
    expect(Object.keys(w.core.repos.account(w.account.id))).not.toContain('lastIdentity')
    expect(JSON.stringify(await w.call('accounts.list', undefined))).not.toMatch(/last_?identity/i)
  })
})
