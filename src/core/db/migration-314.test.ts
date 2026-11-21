// Migration 314: a post the AI read in full keeps the analysis of its thread, the topics it raises and its pictures; a post read before is marked read when it was judged.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.27.4 left it: every migration before 314 applied, with two findings already stored: one with a summary of the post, one without. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 314)) {
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

describe('migration 314: what the AI read in a post, and its pictures', () => {
  it('gives every finding an empty analysis, no topics and no tries, and marks the posts that had a summary as read when they were judged', () => {
    const { db, finding, read } = olderDatabase()
    migrate(db)
    const row = (id: string) => db.prepare('SELECT analysis, topics_json AS topics, read_at AS readAt, read_tries AS tries FROM findings WHERE id = ?').get(id)
    expect(row(finding)).toEqual({ analysis: '', topics: '[]', readAt: null, tries: 0 })
    expect(row(read)).toEqual({ analysis: '', topics: '[]', readAt: '2026-11-02T00:00:00.000Z', tries: 0 })
  })

  it('keeps the pictures of a post in order, one at each place, and drops them with the post', () => {
    const { db, finding } = olderDatabase()
    migrate(db)
    const insert = db.prepare("INSERT INTO finding_images (id, finding_id, position, source_url, created_at) VALUES (?, ?, ?, ?, ?)")
    insert.run(newId(), finding, 1, 'https://i.redd.it/b.png', NOW)
    insert.run(newId(), finding, 0, 'https://i.redd.it/a.png', NOW)
    expect(db.prepare('SELECT position, source_url AS url, alt, file, failure FROM finding_images WHERE finding_id = ? ORDER BY position').all(finding)).toEqual([
      { position: 0, url: 'https://i.redd.it/a.png', alt: '', file: null, failure: '' },
      { position: 1, url: 'https://i.redd.it/b.png', alt: '', file: null, failure: '' }
    ])
    expect(() => insert.run(newId(), finding, 1, 'https://i.redd.it/c.png', NOW)).toThrow()
    db.prepare('DELETE FROM findings WHERE id = ?').run(finding)
    expect(db.prepare('SELECT COUNT(*) AS n FROM finding_images').get()).toEqual({ n: 0 })
  })

  it('is recorded once, and running the migrations again changes nothing', () => {
    const { db } = olderDatabase()
    migrate(db)
    migrate(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 314').get()).toEqual({ n: 1 })
  })
})
