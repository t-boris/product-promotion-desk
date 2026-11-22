// Migration 401: a confirmed post can be looked at again; a send that was confirmed before the migration has never been looked at.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { mapAction } from '../repos'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.46.2 left it: every migration before 401 applied, with one confirmed send. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 401)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const actionId = newId()
  db.prepare(
    `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, completed_at, result_url, result_external_id, authorization_basis)
     VALUES (?, 'o1', 'd1', 'ap1', 'h', 'acc', 'r/x', 'confirmed', ?, ?, 'https://www.reddit.com/r/x/comments/abc/p/', 't3_abc', 'user approval')`
  ).run(actionId, NOW, NOW)
  return { db, actionId }
}

describe('migration 401: post standing', () => {
  it('leaves a send confirmed before it never looked at, so nothing is shown for it until the first look', () => {
    const { db, actionId } = olderDatabase()
    migrate(db)
    const action = mapAction(db.prepare('SELECT * FROM send_actions WHERE id = ?').get(actionId) as Record<string, unknown>)
    expect(action.state).toBe('confirmed')
    expect(action.resultExternalId).toBe('t3_abc')
    expect(action.standing).toBeNull()
    expect(action.standingNote).toBeNull()
    expect(action.standingCheckedAt).toBeNull()
  })

  it('stores what a look found beside the send', () => {
    const { db, actionId } = olderDatabase()
    migrate(db)
    db.prepare('UPDATE send_actions SET standing = ?, standing_note = ?, standing_checked_at = ? WHERE id = ?').run('removed', 'Removed.', NOW, actionId)
    const action = mapAction(db.prepare('SELECT * FROM send_actions WHERE id = ?').get(actionId) as Record<string, unknown>)
    expect([action.standing, action.standingNote, action.standingCheckedAt]).toEqual(['removed', 'Removed.', NOW])
  })
})
