import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, newId, openDatabase } from './database'
import { MIGRATIONS } from './migrations'

function seed(db: ReturnType<typeof openDatabase>) {
  const now = new Date().toISOString()
  const productId = newId()
  const accountId = newId()
  const channelId = newId()
  db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, 'P', now, now)
  db.prepare('INSERT INTO accounts (id, platform, label, partition, created_at) VALUES (?, ?, ?, ?, ?)').run(accountId, 'reddit', 'a', 'p1', now)
  db.prepare(
    `INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, settings_json, created_at)
     VALUES (?, ?, ?, 'reddit', 'reddit', 'r/x', 'https://reddit.com/r/x', '{}', ?)`
  ).run(channelId, productId, accountId, now)
  const oppId = newId()
  db.prepare(
    `INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, created_at, updated_at)
     VALUES (?, ?, ?, 'reply', 'ready', 'd', ?, ?)`
  ).run(oppId, channelId, productId, now, now)
  const draftId = newId()
  db.prepare(`INSERT INTO drafts (id, opportunity_id, text, author, created_at) VALUES (?, ?, 't', 'user', ?)`).run(draftId, oppId, now)
  const approvalId = newId()
  db.prepare(
    `INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES (?, ?, 'h', ?, 'd', 'user', ?)`
  ).run(approvalId, draftId, accountId, now)
  return { oppId, draftId, approvalId, accountId, now }
}

function insertAction(db: ReturnType<typeof openDatabase>, s: ReturnType<typeof seed>, state: string) {
  db.prepare(
    `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis)
     VALUES (?, ?, ?, ?, 'h', ?, 'd', ?, ?, 'user approval')`
  ).run(newId(), s.oppId, s.draftId, s.approvalId, s.accountId, state, s.now)
}

describe('database', () => {
  it('carries the single goal of an older database over as the first of several goals (DEC-012)', () => {
    // A database as version 0.1.5 left it: migrations before 101 applied, one product with a goal and one without.
    const db = new Database(':memory:')
    db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    for (const m of MIGRATIONS.filter((x) => x.id < 101)) {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
    }
    const goal = { targetAction: 'Create the first natal chart', successMetrics: ['charts created', 'sign-ups'], notes: 'Launch month' }
    db.prepare('INSERT INTO products (id, name, goal_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('with-goal', 'A', JSON.stringify(goal), 'then', 'then')
    db.prepare('INSERT INTO products (id, name, goal_json, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)').run('no-goal', 'B', 'then', 'then')

    migrate(db)

    const goals = (id: string) => JSON.parse((db.prepare('SELECT goals_json g FROM products WHERE id = ?').get(id) as { g: string }).g) as unknown[]
    expect(goals('with-goal')).toEqual([{ ...goal, id: expect.stringMatching(/^[0-9a-f]{32}$/) }])
    expect(goals('no-goal')).toEqual([])
    expect(db.prepare("SELECT COUNT(*) c FROM pragma_table_info('products') WHERE name = 'goal_json'").get()).toEqual({ c: 0 })
  })

  it('applies migrations once and is idempotent', () => {
    const db = openDatabase(':memory:')
    const count = (db.prepare('SELECT COUNT(*) c FROM schema_migrations').get() as { c: number }).c
    expect(count).toBeGreaterThan(0)
  })

  it('blocks a second in-flight, unknown or confirmed send for the same opportunity', () => {
    const db = openDatabase(':memory:')
    const s = seed(db)
    insertAction(db, s, 'unknown')
    expect(() => insertAction(db, s, 'sending')).toThrow(/UNIQUE/)
    expect(() => insertAction(db, s, 'confirmed')).toThrow(/UNIQUE/)
  })

  it('allows another attempt only after a definitely failed one', () => {
    const db = openDatabase(':memory:')
    const s = seed(db)
    insertAction(db, s, 'failed')
    insertAction(db, s, 'failed')
    expect(() => insertAction(db, s, 'sending')).not.toThrow()
  })

  it('keeps one opportunity per comment so rediscovery cannot duplicate it', () => {
    const db = openDatabase(':memory:')
    const s = seed(db)
    const row = db.prepare('SELECT channel_id, product_id FROM opportunities WHERE id = ?').get(s.oppId) as { channel_id: string; product_id: string }
    const discussionId = newId()
    db.prepare(`INSERT INTO discussions (id, channel_id, external_id, url, title, author, body, first_seen_at, last_seen_at) VALUES (?, ?, 'd1', 'u', 't', 'a', 'b', ?, ?)`).run(discussionId, row.channel_id, s.now, s.now)
    const commentId = newId()
    db.prepare(`INSERT INTO comments (id, discussion_id, channel_id, external_id, author, body, url, content_hash, first_seen_at, last_seen_at) VALUES (?, ?, ?, 'c1', 'a', 'b', 'u', 'h', ?, ?)`).run(commentId, discussionId, row.channel_id, s.now, s.now)
    const add = () =>
      db.prepare(`INSERT INTO opportunities (id, channel_id, product_id, kind, state, comment_id, destination, created_at, updated_at) VALUES (?, ?, ?, 'reply', 'discovered', ?, 'd', ?, ?)`).run(newId(), row.channel_id, row.product_id, commentId, s.now, s.now)
    add()
    expect(add).toThrow(/UNIQUE/)
  })
})
