// Migration 319: the post's own text, its translations, the AI's explanation of it, and tags. Every post that exists keeps meaning what it meant: no text, not tagged.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.37.0 left it: every migration before 319 applied, with one finding already stored. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 319)) {
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

describe('migration 319: the text of a post', () => {
  it('gives a post that exists no text and no date, and a later page can keep them', () => {
    const { db, finding } = olderDatabase()
    migrate(db)
    expect(db.prepare('SELECT body, body_at AS at, tagged_at AS tagged FROM findings WHERE id = ?').get(finding)).toEqual({ body: '', at: null, tagged: null })
    db.prepare('UPDATE findings SET body = ?, body_at = ?, tagged_at = ? WHERE id = ?').run('What does my Moon sign mean?', NOW, NOW, finding)
    expect(db.prepare('SELECT body, body_at AS at, tagged_at AS tagged FROM findings WHERE id = ?').get(finding)).toEqual({ body: 'What does my Moon sign mean?', at: NOW, tagged: NOW })
  })
})

describe('migration 319: translations and explanations', () => {
  it('keeps one translation and one explanation per post and language, and loses them with the post', () => {
    const { db, finding } = olderDatabase()
    migrate(db)
    const add = (table: 'finding_translations' | 'finding_assists', language: string) =>
      db.prepare(`INSERT INTO ${table} (finding_id, language, signature, result_json, created_at) VALUES (?, ?, 's', '{}', ?)`).run(finding, language, NOW)
    for (const table of ['finding_translations', 'finding_assists'] as const) {
      add(table, 'Russian')
      add(table, 'English')
      expect(() => add(table, 'Russian')).toThrow(/UNIQUE|PRIMARY/)
    }
    db.prepare('DELETE FROM findings WHERE id = ?').run(finding)
    expect(db.prepare('SELECT COUNT(*) AS n FROM finding_translations').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM finding_assists').get()).toEqual({ n: 0 })
  })
})

describe('migration 319: tags', () => {
  it('keeps one tag name per product, links a post to a tag once, and loses the links with either', () => {
    const { db, finding, product } = olderDatabase()
    migrate(db)
    const tag = newId()
    db.prepare('INSERT INTO tags (id, product_id, name, created_at) VALUES (?, ?, ?, ?)').run(tag, product, 'moon sign', NOW)
    expect(() => db.prepare('INSERT INTO tags (id, product_id, name, created_at) VALUES (?, ?, ?, ?)').run(newId(), product, 'moon sign', NOW)).toThrow(/UNIQUE/)
    db.prepare('INSERT INTO finding_tags (finding_id, tag_id) VALUES (?, ?)').run(finding, tag)
    expect(() => db.prepare('INSERT INTO finding_tags (finding_id, tag_id) VALUES (?, ?)').run(finding, tag)).toThrow(/UNIQUE|PRIMARY/)
    db.prepare('DELETE FROM tags WHERE id = ?').run(tag)
    expect(db.prepare('SELECT COUNT(*) AS n FROM finding_tags').get()).toEqual({ n: 0 })
    const again = newId()
    db.prepare('INSERT INTO tags (id, product_id, name, created_at) VALUES (?, ?, ?, ?)').run(again, product, 'houses', NOW)
    db.prepare('INSERT INTO finding_tags (finding_id, tag_id) VALUES (?, ?)').run(finding, again)
    db.prepare('DELETE FROM findings WHERE id = ?').run(finding)
    expect(db.prepare('SELECT COUNT(*) AS n FROM finding_tags').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags').get()).toEqual({ n: 1 })
  })
})
