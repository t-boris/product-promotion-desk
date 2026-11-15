// Migration 308 (DEC-040): the default check interval moves from 30 minutes to 3 hours, and the application must still start whatever the stored settings look like.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as the version before the watching feature left it: every migration before 308 applied, with one product and one account. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 308)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const productId = newId()
  const accountId = newId()
  db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, 'P', NOW, NOW)
  db.prepare('INSERT INTO accounts (id, platform, label, partition, created_at) VALUES (?, ?, ?, ?, ?)').run(accountId, 'reddit', 'a', 'p1', NOW)
  const addChannel = (target: string, settingsJson: string | null): string => {
    const id = newId()
    // settings_json is NOT NULL in the schema; a test of "no settings at all" is a test of an empty text.
    db.prepare(
      `INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, settings_json, created_at)
       VALUES (?, ?, ?, 'reddit', 'reddit', ?, ?, ?, ?)`
    ).run(id, productId, accountId, target, `https://reddit.com/${target}`, settingsJson ?? '', NOW)
    return id
  }
  const settingsOf = (id: string): string => (db.prepare('SELECT settings_json AS s FROM channels WHERE id = ?').get(id) as { s: string }).s
  return { db, addChannel, settingsOf }
}

describe('migration 308: the default interval and the findings', () => {
  it('moves a channel still on exactly 30 minutes to 180 and leaves every other value alone', () => {
    const { db, addChannel, settingsOf } = olderDatabase()
    const old = addChannel('r/old', JSON.stringify({ checkIntervalMin: 30, style: 'warm' }))
    const chosen = addChannel('r/chosen', JSON.stringify({ checkIntervalMin: 45 }))
    const fast = addChannel('r/fast', JSON.stringify({ checkIntervalMin: 5 }))
    const none = addChannel('r/none', '{}')

    migrate(db)

    expect(JSON.parse(settingsOf(old))).toEqual({ checkIntervalMin: 180, style: 'warm' })
    expect(JSON.parse(settingsOf(chosen))).toEqual({ checkIntervalMin: 45 })
    expect(JSON.parse(settingsOf(fast))).toEqual({ checkIntervalMin: 5 })
    expect(JSON.parse(settingsOf(none))).toEqual({})
  })

  it('does not stop on a channel whose settings are not JSON: it is left as it is and the others still move', () => {
    const { db, addChannel, settingsOf } = olderDatabase()
    const broken = addChannel('r/broken', 'not json')
    const empty = addChannel('r/empty', null)
    const truncated = addChannel('r/truncated', '{"checkIntervalMin": 30')
    const old = addChannel('r/old', JSON.stringify({ checkIntervalMin: 30 }))

    expect(() => migrate(db)).not.toThrow()

    expect(settingsOf(broken)).toBe('not json')
    expect(settingsOf(empty)).toBe('')
    expect(settingsOf(truncated)).toBe('{"checkIntervalMin": 30')
    expect(JSON.parse(settingsOf(old))).toEqual({ checkIntervalMin: 180 })
    expect(db.prepare('SELECT id FROM schema_migrations WHERE id = 308').get()).toEqual({ id: 308 })
  })

  it('adds what the watching needs: the post time, the first-look mark, the listing cursor and an empty findings table', () => {
    const { db, addChannel } = olderDatabase()
    const old = addChannel('r/old', '{}')
    migrate(db)
    const columns = (table: string): string[] => (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map((c) => c.name)
    expect(columns('discussions')).toContain('posted_at')
    expect(columns('channels')).toContain('looked_back_at')
    expect(columns('channels')).toContain('listed_through')
    // A channel from before the upgrade has no cursor: its next pass makes the first look once (and only that: nothing is judged twice).
    expect(db.prepare('SELECT looked_back_at, listed_through FROM channels WHERE id = ?').get(old)).toEqual({ looked_back_at: null, listed_through: null })
    expect(columns('findings')).toEqual(expect.arrayContaining(['channel_id', 'external_id', 'label', 'stage', 'relation', 'first_look', 'opportunity_id', 'attempts']))
    expect(db.prepare('SELECT COUNT(*) c FROM findings').get()).toEqual({ c: 0 })
  })

  it('is applied once: a second run changes nothing', () => {
    const { db, addChannel, settingsOf } = olderDatabase()
    const old = addChannel('r/old', JSON.stringify({ checkIntervalMin: 30 }))
    migrate(db)
    // The owner moves the channel back to 30 minutes after the migration: a later start must not move it again.
    db.prepare("UPDATE channels SET settings_json = json_set(settings_json, '$.checkIntervalMin', 30) WHERE id = ?").run(old)
    migrate(db)
    expect(JSON.parse(settingsOf(old))).toEqual({ checkIntervalMin: 30 })
  })
})
