// Migrations 316 and 317: a post of the Feed keeps the numbers its site showed, and the analysis of the Feed is kept with its date.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.33.0 left it: every migration before 316 applied, with one finding already stored. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 316)) {
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
  return { db, finding, product, channel }
}

describe('migration 316: the numbers a site shows for a post', () => {
  it('gives a post that exists no numbers, and a later one can keep them', () => {
    const { db, finding } = olderDatabase()
    migrate(db)
    expect(db.prepare('SELECT reply_count AS r, score AS s, stats_at AS at FROM findings WHERE id = ?').get(finding)).toEqual({ r: null, s: null, at: null })
    db.prepare('UPDATE findings SET reply_count = 12, score = 340, stats_at = ? WHERE id = ?').run(NOW, finding)
    expect(db.prepare('SELECT reply_count AS r, score AS s, stats_at AS at FROM findings WHERE id = ?').get(finding)).toEqual({ r: 12, s: 340, at: NOW })
  })
})

describe('migration 317: the analysis of the Feed', () => {
  it('keeps one analysis per product, channel and period, and replaces it by the next', () => {
    const { db, product, channel } = olderDatabase()
    migrate(db)
    const add = (channelKey: string, days: number) =>
      db.prepare("INSERT INTO feed_analyses (id, product_id, channel_id, channel_key, days, signature, result_json, created_at) VALUES (?, ?, ?, ?, ?, 's', '{}', ?)").run(newId(), product, channelKey === '' ? null : channel, channelKey, days, NOW)
    add('', 7)
    add('', 30)
    add(channel, 7)
    expect(() => add('', 7)).toThrow(/UNIQUE/)
    expect(db.prepare('SELECT COUNT(*) AS n FROM feed_analyses').get()).toEqual({ n: 3 })
  })

  it('goes with the channel or the product it is about', () => {
    const { db, product, channel } = olderDatabase()
    migrate(db)
    db.prepare("INSERT INTO feed_analyses (id, product_id, channel_id, channel_key, days, signature, result_json, created_at) VALUES (?, ?, ?, ?, 7, 's', '{}', ?)").run(newId(), product, channel, channel, NOW)
    db.prepare("INSERT INTO feed_analyses (id, product_id, channel_id, channel_key, days, signature, result_json, created_at) VALUES (?, ?, NULL, '', 7, 's', '{}', ?)").run(newId(), product, NOW)
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel)
    expect(db.prepare('SELECT COUNT(*) AS n FROM feed_analyses').get()).toEqual({ n: 1 })
    db.prepare('DELETE FROM products WHERE id = ?').run(product)
    expect(db.prepare('SELECT COUNT(*) AS n FROM feed_analyses').get()).toEqual({ n: 0 })
  })
})
