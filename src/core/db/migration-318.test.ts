// Migration 318: an approval can carry what the owner knowingly let through ("Send anyway"). Every approval that exists keeps meaning what it meant: nothing. (DEC-050 removed "Send anyway" in 0.38.1: the column is unused now, and stays.)

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.35.0 left it: every migration before 318 applied, with one approval of the owner's already stored. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 318)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  // The rows around the approval are not what is tested: they are put in without their own checks.
  db.pragma('foreign_keys = OFF')
  const approval = newId()
  db.prepare("INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES (?, ?, 'h', ?, 'd', 'user', ?)").run(approval, newId(), newId(), NOW)
  return { db, approval }
}

describe('migration 318: what an approval let through', () => {
  it('gives every approval that exists nothing let through', () => {
    const { db, approval } = olderDatabase()
    migrate(db)
    expect(db.prepare('SELECT acknowledged_json AS a FROM approvals WHERE id = ?').get(approval)).toEqual({ a: '[]' })
  })

  it('gives a new approval nothing let through unless it says so, and keeps what it says', () => {
    const { db } = olderDatabase()
    migrate(db)
    const insert = (acknowledged?: string) => {
      const id = newId()
      if (acknowledged === undefined) db.prepare("INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES (?, ?, 'h', ?, 'd', 'user', ?)").run(id, newId(), newId(), NOW)
      else db.prepare("INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at, acknowledged_json) VALUES (?, ?, 'h', ?, 'd', 'user', ?, ?)").run(id, newId(), newId(), NOW, acknowledged)
      return db.prepare('SELECT acknowledged_json AS a FROM approvals WHERE id = ?').get(id)
    }
    expect(insert()).toEqual({ a: '[]' })
    expect(insert('["community_rules"]')).toEqual({ a: '["community_rules"]' })
  })
})
