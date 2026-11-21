// Migration 311: a finding keeps what the AI read in a post worth a reply (the post, the thread, whom to answer, a comment); every finding made before is empty there.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.27.4 left it: every migration before 311 applied, with one finding already stored. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 311)) {
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
  db.prepare("INSERT INTO findings (id, product_id, channel_id, external_id, title, url, stage, relation, created_at, updated_at) VALUES (?, ?, ?, 'e1', 'T', 'https://www.reddit.com/r/x/comments/1', 'read', 'r', ?, ?)").run(finding, product, channel, NOW, NOW)
  return { db, finding }
}

describe('migration 311: what the AI read in a post worth a reply', () => {
  it('gives every finding that exists four empty fields, and one made later can hold text in them', () => {
    const { db, finding } = olderDatabase()
    migrate(db)
    const row = db.prepare('SELECT about, thread, reply_to, suggested_comment FROM findings WHERE id = ?').get(finding)
    expect(row).toEqual({ about: '', thread: '', reply_to: '', suggested_comment: '' })
    db.prepare("UPDATE findings SET about = 'a', thread = 't', reply_to = 'r', suggested_comment = 'c' WHERE id = ?").run(finding)
    expect(db.prepare('SELECT about, thread, reply_to, suggested_comment FROM findings WHERE id = ?').get(finding)).toEqual({ about: 'a', thread: 't', reply_to: 'r', suggested_comment: 'c' })
  })

  it('312: keeps the comments of a thread under the finding, in order, and drops them with it', () => {
    const { db, finding } = olderDatabase()
    migrate(db)
    const insert = db.prepare("INSERT INTO finding_comments (id, finding_id, position, depth, author, text, url, created_at) VALUES (?, ?, ?, ?, ?, ?, '', ?)")
    insert.run(newId(), finding, 1, 1, 'b', 'second', NOW)
    insert.run(newId(), finding, 0, 0, 'a', 'first', NOW)
    expect(db.prepare('SELECT position, text FROM finding_comments WHERE finding_id = ? ORDER BY position').all(finding)).toEqual([
      { position: 0, text: 'first' },
      { position: 1, text: 'second' }
    ])
    expect(() => insert.run(newId(), finding, 1, 0, 'c', 'twice at one place', NOW)).toThrow()
    db.prepare('DELETE FROM findings WHERE id = ?').run(finding)
    expect(db.prepare('SELECT COUNT(*) AS n FROM finding_comments').get()).toEqual({ n: 0 })
  })

  it('is recorded once, and running the migrations again changes nothing', () => {
    const { db } = olderDatabase()
    migrate(db)
    migrate(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 311').get()).toEqual({ n: 1 })
  })
})
