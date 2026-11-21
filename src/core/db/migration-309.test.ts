// Migration 309 (DEC-046): every draft that exists is an article with no card, and a quick post can be stored beside it.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.23.0 left it: every migration before 309 applied, with one old draft. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 309)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const productId = newId()
  const accountId = newId()
  const channelId = newId()
  const oppId = newId()
  db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, 'P', NOW, NOW)
  db.prepare('INSERT INTO accounts (id, platform, label, partition, created_at) VALUES (?, ?, ?, ?, ?)').run(accountId, 'reddit', 'a', 'p1', NOW)
  db.prepare(
    `INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, settings_json, created_at)
     VALUES (?, ?, ?, 'reddit', 'reddit', 'r/x', 'https://reddit.com/r/x', '{}', ?)`
  ).run(channelId, productId, accountId, NOW)
  db.prepare(
    `INSERT INTO opportunities (id, product_id, channel_id, kind, state, destination, created_at, updated_at)
     VALUES (?, ?, ?, 'standalone', 'draft', 'r/x', ?, ?)`
  ).run(oppId, productId, channelId, NOW, NOW)
  const addDraft = (title: string | null, text: string): string => {
    const id = newId()
    db.prepare(`INSERT INTO drafts (id, opportunity_id, title, text, author, created_at) VALUES (?, ?, ?, ?, 'user', ?)`).run(id, oppId, title, text, NOW)
    return id
  }
  return { db, oppId, addDraft }
}

describe('migration 309: the post type and the card of a draft', () => {
  it('makes every existing draft an article with no card, whatever its title', () => {
    const { db, addDraft } = olderDatabase()
    const withTitle = addDraft('A title', 'long text')
    const withoutTitle = addDraft(null, 'a reply or a post that never had a title')
    migrate(db)
    for (const id of [withTitle, withoutTitle]) {
      const row = db.prepare('SELECT post_type, card_json FROM drafts WHERE id = ?').get(id) as { post_type: string; card_json: string | null }
      expect(row).toEqual({ post_type: 'article', card_json: null })
    }
  })

  it('stores a quick post with its card beside the old drafts, and leaves the old ones alone', () => {
    const { db, oppId, addDraft } = olderDatabase()
    const old = addDraft('Old', 'text')
    migrate(db)
    const id = newId()
    db.prepare(`INSERT INTO drafts (id, opportunity_id, title, text, author, created_at, post_type, card_json) VALUES (?, ?, NULL, 'caption', 'user', ?, 'quick', ?)`).run(
      id,
      oppId,
      NOW,
      JSON.stringify({ style: 'bold', colour: 'indigo', shape: 'square', headline: 'H', headlineEdited: false })
    )
    expect((db.prepare('SELECT post_type FROM drafts WHERE id = ?').get(old) as { post_type: string }).post_type).toBe('article')
    expect((db.prepare('SELECT post_type FROM drafts WHERE id = ?').get(id) as { post_type: string }).post_type).toBe('quick')
  })
})
