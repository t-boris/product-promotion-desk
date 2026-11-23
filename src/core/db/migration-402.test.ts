// Migration 402: what the community wrote under a removed post is kept beside the send; a removal recorded before it has no such words.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { mapAction } from '../repos'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-23T00:00:00.000Z'

/** A database as 0.48.1 left it: every migration before 402 applied, with one send that a look found removed. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 402)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const actionId = newId()
  db.prepare(
    `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, completed_at, result_url, result_external_id, authorization_basis, standing, standing_note, standing_checked_at)
     VALUES (?, 'o1', 'd1', 'ap1', 'h', 'acc', 'r/x', 'confirmed', ?, ?, 'https://www.reddit.com/r/x/comments/abc/p/', 't3_abc', 'user approval', 'removed', 'A moderator of r/x removed it.', ?)`
  ).run(actionId, NOW, NOW, NOW)
  return { db, actionId }
}

const read = (db: Database.Database, id: string) => mapAction(db.prepare('SELECT * FROM send_actions WHERE id = ?').get(id) as Record<string, unknown>)

describe("migration 402: the community's words under a removed post", () => {
  it('keeps a removal recorded before it as it was, with no words of the community', () => {
    const { db, actionId } = olderDatabase()
    migrate(db)
    expect(read(db, actionId)).toMatchObject({ standing: 'removed', standingNote: 'A moderator of r/x removed it.', standingNotice: null })
  })

  it('stores who wrote the words and the words', () => {
    const { db, actionId } = olderDatabase()
    migrate(db)
    db.prepare('UPDATE send_actions SET standing_notice = ?, standing_notice_by = ? WHERE id = ?').run('Await mod approval.', 'AutoModerator', actionId)
    expect(read(db, actionId).standingNotice).toEqual({ by: 'AutoModerator', text: 'Await mod approval.' })
  })
})
