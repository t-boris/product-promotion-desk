import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

/** Opens (and migrates) the application database. Use ':memory:' in tests. */
export function openDatabase(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: number }).id))
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, new Date().toISOString())
    })()
  }
}

export function newId(): string {
  return randomUUID()
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value)
}

/** Runs `fn` inside a transaction; the transaction rolls back if `fn` throws. */
export function tx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)()
}
