// Migration 315: a reply the owner sends from a post of the Feed remembers the post it came from; every opportunity made before has none.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.27.4 left it: every migration before 315 applied, with one finding and one opportunity already stored. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 315)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const product = newId()
  const account = newId()
  const channel = newId()
  db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(product, 'P', NOW, NOW)
  db.prepare("INSERT INTO accounts (id, platform, label, partition, status, created_at) VALUES (?, 'reddit', 'A', ?, 'ready', ?)").run(account, `persist:${account}`, NOW)
  db.prepare("INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, mode, settings_json, created_at) VALUES (?, ?, ?, 'reddit', 'reddit', 'r/x', 'https://www.reddit.com/r/x', 'observe', '{}', ?)").run(channel, product, account, NOW)
  const finding = newId()
  const read = newId()
  db.prepare("INSERT INTO findings (id, product_id, channel_id, external_id, title, url, stage, relation, created_at, updated_at) VALUES (?, ?, ?, 'e1', 'T', 'https://www.reddit.com/r/x/comments/1', 'read', 'r', ?, ?)").run(finding, product, channel, NOW, NOW)
  db.prepare("INSERT INTO findings (id, product_id, channel_id, external_id, title, url, stage, relation, about, created_at, updated_at) VALUES (?, ?, ?, 'e2', 'T2', 'https://www.reddit.com/r/x/comments/2', 'read', 'r', 'A summary.', ?, '2026-11-02T00:00:00.000Z')").run(read, product, channel, NOW)
  return { db, finding, read }
}

describe('migration 315: the post of the Feed an answer came from', () => {
  it('gives every opportunity that exists no post of the Feed, and one made later can name it', () => {
    const { db, finding } = olderDatabase()
    const product = (db.prepare('SELECT id FROM products').get() as { id: string }).id
    const channel = (db.prepare('SELECT id FROM channels').get() as { id: string }).id
    const before = newId()
    db.prepare("INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, created_at, updated_at) VALUES (?, ?, ?, 'reply', 'draft', 'https://x.test', ?, ?)").run(before, channel, product, NOW, NOW)
    migrate(db)
    expect(db.prepare('SELECT finding_id AS f FROM opportunities WHERE id = ?').get(before)).toEqual({ f: null })
    const after = newId()
    db.prepare("INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, finding_id, created_at, updated_at) VALUES (?, ?, ?, 'reply', 'draft', 'https://x.test', ?, ?, ?)").run(after, channel, product, finding, NOW, NOW)
    expect(db.prepare('SELECT finding_id AS f FROM opportunities WHERE id = ?').get(after)).toEqual({ f: finding })
  })

  it('lets the answer outlive the post of the Feed: deleting the finding leaves the opportunity, with no post named', () => {
    const { db, finding } = olderDatabase()
    const product = (db.prepare('SELECT id FROM products').get() as { id: string }).id
    const channel = (db.prepare('SELECT id FROM channels').get() as { id: string }).id
    migrate(db)
    const id = newId()
    db.prepare("INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, finding_id, created_at, updated_at) VALUES (?, ?, ?, 'reply', 'confirmed', 'https://x.test', ?, ?, ?)").run(id, channel, product, finding, NOW, NOW)
    db.prepare('DELETE FROM findings WHERE id = ?').run(finding)
    expect(db.prepare('SELECT state, finding_id AS f FROM opportunities WHERE id = ?').get(id)).toEqual({ state: 'confirmed', f: null })
  })

  it('is recorded once, and running the migrations again changes nothing', () => {
    const { db } = olderDatabase()
    migrate(db)
    migrate(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 315').get()).toEqual({ n: 1 })
  })
})
