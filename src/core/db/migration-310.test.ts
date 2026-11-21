// Migration 310 (DEC-044): every product that exists keeps its site at the end of new posts until the owner switches it off.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'

/** A database as 0.24.1 left it: every migration before 310 applied, with one product that has a site and one that has none. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 310)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const withSite = newId()
  const withoutSite = newId()
  db.prepare('INSERT INTO products (id, name, website_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(withSite, 'P', 'https://p.example/', NOW, NOW)
  db.prepare('INSERT INTO products (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(withoutSite, 'Q', 'text only', NOW, NOW)
  return { db, withSite, withoutSite }
}

describe('migration 310: the product keeps whether its site ends every new post', () => {
  it('turns it on for every product that exists, and for a product made later', () => {
    const { db, withSite, withoutSite } = olderDatabase()
    migrate(db)
    const flag = (id: string) => (db.prepare('SELECT add_site_link AS v FROM products WHERE id = ?').get(id) as { v: number }).v
    expect(flag(withSite)).toBe(1)
    expect(flag(withoutSite)).toBe(1)
    const later = newId()
    db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(later, 'R', NOW, NOW)
    expect(flag(later)).toBe(1)
  })

  it('is recorded once, and running the migrations again changes nothing', () => {
    const { db } = olderDatabase()
    migrate(db)
    migrate(db)
    expect((db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE id = 310').get() as { n: number }).n).toBe(1)
  })
})
