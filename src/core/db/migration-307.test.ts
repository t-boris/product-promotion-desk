// Migration 307 (DEC-039): the source of an opportunity, one new-post opportunity per discussion, and the inbox baseline of a channel.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'
import { mapOpportunity } from '../repos'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as the version before the Feed left it: every migration before 307 applied, with one product, channel, discussion, comment and reply. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 307)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const productId = newId()
  const accountId = newId()
  const channelId = newId()
  const discussionId = newId()
  const commentId = newId()
  const oppId = newId()
  db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, 'P', NOW, NOW)
  db.prepare('INSERT INTO accounts (id, platform, label, partition, created_at) VALUES (?, ?, ?, ?, ?)').run(accountId, 'reddit', 'a', 'p1', NOW)
  db.prepare(
    `INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, settings_json, created_at)
     VALUES (?, ?, ?, 'reddit', 'reddit', 'r/x', 'https://reddit.com/r/x', '{}', ?)`
  ).run(channelId, productId, accountId, NOW)
  db.prepare(
    `INSERT INTO discussions (id, channel_id, external_id, url, title, author, body, selected, first_seen_at, last_seen_at) VALUES (?, ?, 't3_a', 'https://reddit.com/r/x/comments/a', 'T', 'op', 'B', 0, ?, ?)`
  ).run(discussionId, channelId, NOW, NOW)
  db.prepare(
    `INSERT INTO comments (id, discussion_id, channel_id, external_id, parent_external_id, author, body, url, baseline, is_own, content_hash, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, 't1_c', 't3_a', 'someone', 'hi', 'u', 0, 0, 'h', ?, ?)`
  ).run(commentId, discussionId, channelId, NOW, NOW)
  db.prepare(
    `INSERT INTO opportunities (id, channel_id, product_id, kind, state, comment_id, discussion_id, destination, created_at, updated_at)
     VALUES (?, ?, ?, 'reply', 'awaiting_approval', ?, ?, 'u', ?, ?)`
  ).run(oppId, channelId, productId, commentId, discussionId, NOW, NOW)
  return { db, productId, channelId, discussionId, commentId, oppId }
}

describe('migration 307: the source of an opportunity', () => {
  it('applies on an existing database and every row from before is a comment', () => {
    const { db, oppId } = olderDatabase()
    expect(db.prepare("SELECT COUNT(*) c FROM pragma_table_info('opportunities') WHERE name = 'source'").get()).toEqual({ c: 0 })

    migrate(db)

    const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(oppId) as Record<string, unknown>
    expect(row.source).toBe('comment')
    expect(mapOpportunity(row).source).toBe('comment')
    expect(db.prepare('SELECT id FROM schema_migrations WHERE id = 307').get()).toEqual({ id: 307 })
  })

  it('is applied once: a second run changes nothing', () => {
    const { db, oppId } = olderDatabase()
    migrate(db)
    migrate(db)
    expect((db.prepare('SELECT COUNT(*) c FROM schema_migrations WHERE id = 307').get() as { c: number }).c).toBe(1)
    expect((db.prepare('SELECT source FROM opportunities WHERE id = ?').get(oppId) as { source: string }).source).toBe('comment')
  })

  it('leaves what was there alone: the reply keeps its comment, state and destination', () => {
    const { db, oppId, commentId } = olderDatabase()
    migrate(db)
    expect(db.prepare('SELECT state, comment_id AS commentId, destination FROM opportunities WHERE id = ?').get(oppId)).toEqual({ state: 'awaiting_approval', commentId, destination: 'u' })
  })

  it('gives a new row the default when nobody says otherwise', () => {
    const { db, productId, channelId } = olderDatabase()
    migrate(db)
    const id = newId()
    db.prepare(`INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, created_at, updated_at) VALUES (?, ?, ?, 'standalone', 'draft', 'd', ?, ?)`).run(id, channelId, productId, NOW, NOW)
    expect((db.prepare('SELECT source FROM opportunities WHERE id = ?').get(id) as { source: string }).source).toBe('comment')
  })

  it('allows one new-post opportunity per discussion, and any number of comment ones next to it', () => {
    const { db, productId, channelId, discussionId } = olderDatabase()
    migrate(db)
    const insert = (source: string) =>
      db
        .prepare(`INSERT INTO opportunities (id, channel_id, product_id, kind, source, state, discussion_id, destination, created_at, updated_at) VALUES (?, ?, ?, 'reply', ?, 'discovered', ?, 'u', ?, ?)`)
        .run(newId(), channelId, productId, source, discussionId, NOW, NOW)
    insert('new_post')
    expect(() => insert('new_post')).toThrow(/UNIQUE/)
    expect(() => insert('comment')).not.toThrow() // the migrated reply already holds this discussion as a comment: the index is only about posts
    expect(() => insert('reply_to_me')).not.toThrow()
  })

  it('records when the inbox of a channel was first read, empty at first', () => {
    const { db, channelId } = olderDatabase()
    migrate(db)
    expect(db.prepare('SELECT inbox_baseline_done_at AS at FROM channels WHERE id = ?').get(channelId)).toEqual({ at: null })
  })
})
