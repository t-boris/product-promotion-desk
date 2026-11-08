import { describe, expect, it } from 'vitest'
import { newId, openDatabase } from './database'

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
