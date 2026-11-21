// Migration 320 (DEC-050): what a community's rules text said about AI or promotion is forgotten. A channel stored what the application thought of the rules as
// a restriction, a note in a detail and a capability of its own; none of it exists any more, and what is stored must not go on saying it.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, newId } from './database'
import { MIGRATIONS } from './migrations'

const NOW = '2026-11-01T00:00:00.000Z'
const AI_BAN = 'Community rules appear to forbid automation or AI-generated content — "No AI generated content.": Chat GPT and other AI tools are being used more and more.'
const PROMOTION = 'Rules mention promotion — read them before posting: "No self promotion": Do not advertise. The form is reachable.'

type Cap = { key: string; status: string; detail: string; checkedAt: string | null }
const cap = (key: string, status: string, detail: string): Cap => ({ key, status, detail, checkedAt: NOW })

/** A database as 0.38.0 left it: every migration before 320 applied. */
function olderDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
  for (const m of MIGRATIONS.filter((x) => x.id < 320)) {
    db.exec(m.sql)
    db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
  }
  const product = newId()
  const account = newId()
  db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(product, 'P', NOW, NOW)
  db.prepare("INSERT INTO accounts (id, platform, label, partition, status, created_at) VALUES (?, 'reddit', 'A', ?, 'ready', ?)").run(account, `persist:${account}`, NOW)
  const channel = (target: string, capabilities: string): string => {
    const id = newId()
    db.prepare(
      "INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, mode, settings_json, capabilities_json, created_at) VALUES (?, ?, ?, 'reddit', 'reddit', ?, 'https://www.reddit.com/r/x', 'approval', '{}', ?, ?)"
    ).run(id, product, account, target, capabilities, NOW)
    return id
  }
  const read = (id: string): Cap[] => JSON.parse((db.prepare('SELECT capabilities_json AS c FROM channels WHERE id = ?').get(id) as { c: string }).c) as Cap[]
  return { db, channel, read }
}

describe('migration 320: the rules text of a community is forgotten', () => {
  it('turns a restriction that only said the rules forbid AI back into needs_check, and drops the rules capability, keeping the order of the rest', () => {
    const { db, channel, read } = olderDatabase()
    const id = channel('r/astrology', JSON.stringify([
      cap('read_posts', 'verified', 'Read 25 posts.'),
      cap('rules', 'verified', 'Read 8 community rules (automation/AI rule found).'),
      cap('publish_post', 'restricted', AI_BAN),
      cap('publish_reply', 'restricted', AI_BAN),
      cap('membership', 'verified', 'Member.')
    ]))
    migrate(db)
    expect(read(id)).toEqual([
      cap('read_posts', 'verified', 'Read 25 posts.'),
      cap('publish_post', 'needs_check', 'Not checked yet.'),
      cap('publish_reply', 'needs_check', 'Not checked yet.'),
      cap('membership', 'verified', 'Member.')
    ])
  })

  it('keeps the status of a capability whose detail carries the promotion note, at its start or after the sentence of the form check, and says "Not checked yet." instead', () => {
    const { db, channel, read } = olderDatabase()
    const afterForm = `The submit form is reachable. ${PROMOTION} No restriction found for posting. It is confirmed by the first authorized send, never by a test message.`
    const id = channel('r/AskAstrologers', JSON.stringify([cap('rules', 'verified', '1 rule(s) mention promotion'), cap('publish_post', 'needs_check', afterForm), cap('publish_reply', 'verified', 'Reply works.')]))
    const other = channel('r/other', JSON.stringify([cap('publish_post', 'needs_check', PROMOTION)]))
    migrate(db)
    expect(read(id)).toEqual([cap('publish_post', 'needs_check', 'Not checked yet.'), cap('publish_reply', 'verified', 'Reply works.')])
    expect(read(other)).toEqual([cap('publish_post', 'needs_check', 'Not checked yet.')])
  })

  it('does not touch a restriction the site itself enforces: banned, or only approved users', () => {
    const { db, channel, read } = olderDatabase()
    const banned = 'This account is banned from r/x.'
    const approved = 'Only approved users can post in r/x; this account is not approved.'
    const before = [cap('publish_post', 'restricted', approved), cap('publish_reply', 'restricted', banned), cap('membership', 'restricted', banned)]
    const id = channel('r/x', JSON.stringify(before))
    migrate(db)
    expect(read(id)).toEqual(before)
  })

  it('removes a rules capability from a channel the application does not read, and leaves what it said of the rest', () => {
    const { db, channel, read } = olderDatabase()
    const id = channel('www.instagram.com', JSON.stringify([cap('rules', 'unavailable', 'The app does not read this site.'), cap('read_posts', 'unavailable', 'The app does not read this site.')]))
    migrate(db)
    expect(read(id)).toEqual([cap('read_posts', 'unavailable', 'The app does not read this site.')])
  })

  it('leaves a channel with nothing of the kind exactly as it was, byte for byte, and one never assessed (an empty list) too', () => {
    const { db, channel } = olderDatabase()
    const plain = JSON.stringify([cap('read_posts', 'verified', 'Read 25 posts.'), cap('publish_reply', 'needs_check', 'The form is reachable.')])
    const a = channel('r/plain', plain)
    const b = channel('r/new', '[]')
    migrate(db)
    const text = (id: string): string => (db.prepare('SELECT capabilities_json AS c FROM channels WHERE id = ?').get(id) as { c: string }).c
    expect(text(a)).toBe(plain)
    expect(text(b)).toBe('[]')
  })

  it('leaves what it cannot read alone: a record that is not a list is not touched, and the migration does not fail on it', () => {
    const { db, channel } = olderDatabase()
    const broken = channel('r/broken', '{not json "rules"')
    const object = channel('r/object', '{"rules":"x"}')
    expect(() => migrate(db)).not.toThrow()
    const text = (id: string): string => (db.prepare('SELECT capabilities_json AS c FROM channels WHERE id = ?').get(id) as { c: string }).c
    expect(text(broken)).toBe('{not json "rules"')
    expect(text(object)).toBe('{"rules":"x"}')
  })

  it('a channel that held only the rules capability is left with an empty list', () => {
    const { db, channel, read } = olderDatabase()
    const id = channel('r/only', JSON.stringify([cap('rules', 'verified', 'Read 3 community rules.')]))
    migrate(db)
    expect(read(id)).toEqual([])
  })

  it('is applied once: the schema record says so, and migrating again changes nothing', () => {
    const { db, channel } = olderDatabase()
    const id = channel('r/astrology', JSON.stringify([cap('publish_reply', 'restricted', AI_BAN)]))
    migrate(db)
    const once = (db.prepare('SELECT capabilities_json AS c FROM channels WHERE id = ?').get(id) as { c: string }).c
    migrate(db)
    expect((db.prepare('SELECT capabilities_json AS c FROM channels WHERE id = ?').get(id) as { c: string }).c).toBe(once)
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 320').get()).toEqual({ n: 1 })
  })
})
