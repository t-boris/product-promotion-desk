// Roles of logins (DEC-010): set by the owner, proposed by the AI, never creating a real account.

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { Claim } from '../../shared/types'
import { migrate } from '../db/database'
import { MIGRATIONS } from '../db/migrations'
import { AiError } from '../ports'
import type { KnowledgeProvider } from '../services'
import type { suggestRoles } from './ai-help'
import { MAX_ROLE_NAME, MAX_ROLE_VOICE, parseRole, RoleSuggestionService } from './roles'
import { makeReadyWorld, makeWorld, OtherConnector, type World } from './test-helpers'

const ASTROLOGER = { name: 'Astrologer', voice: 'Calm and practical; talks about birth charts, never predicts the future.' }
const DEVELOPER = { name: 'Developer', voice: 'Technical and brief; explains how the report is calculated.' }

describe('parseRole', () => {
  it('means "no role" for null and undefined', () => {
    expect(parseRole(null)).toBeNull()
    expect(parseRole(undefined)).toBeNull()
  })

  it('trims, and turns runs of white space (line breaks included) into single spaces', () => {
    expect(parseRole({ name: '  Star   gazer \n', voice: ' Warm,\n\tkind \r\n and plain. ' })).toEqual({ name: 'Star gazer', voice: 'Warm, kind and plain.' })
  })

  it('accepts a role without a voice', () => {
    expect(parseRole({ name: 'Astrologer' })).toEqual({ name: 'Astrologer', voice: '' })
    expect(parseRole({ name: 'Astrologer', voice: null })).toEqual({ name: 'Astrologer', voice: '' })
  })

  it('keeps the name between 1 and 40 characters and the voice at most 280 (counted as people count them)', () => {
    expect(parseRole({ name: 'a'.repeat(MAX_ROLE_NAME), voice: 'v'.repeat(MAX_ROLE_VOICE) })).not.toBeNull()
    expect(() => parseRole({ name: 'a'.repeat(MAX_ROLE_NAME + 1), voice: '' })).toThrowError(expect.objectContaining({ code: 'invalid_input', message: expect.stringMatching(/name is too long/) }))
    expect(() => parseRole({ name: 'a', voice: 'v'.repeat(MAX_ROLE_VOICE + 1) })).toThrowError(expect.objectContaining({ code: 'invalid_input', message: expect.stringMatching(/voice is too long/) }))
    expect(() => parseRole({ name: '   ', voice: 'x' })).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
    expect(parseRole({ name: '🔮'.repeat(MAX_ROLE_NAME) })).not.toBeNull() // 40 characters, 80 UTF-16 units
  })

  it.each(['bad\u0000name', 'esc\u001b[31m', 'del\u007f', 'c1\u0085x', 'bell\u0007'])('refuses control characters (%j)', (text) => {
    expect(() => parseRole({ name: text, voice: '' })).toThrowError(expect.objectContaining({ code: 'invalid_input', message: expect.stringMatching(/control characters/) }))
    expect(() => parseRole({ name: 'ok', voice: text })).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })

  it.each([['text'], [42], [[]], [{ voice: 'x' }], [{ name: 5 }], [{ name: 'a', voice: 3 }]])('refuses what is not a role (%j)', (input) => {
    expect(() => parseRole(input)).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })
})

describe('accounts.create with a role', () => {
  it('creates the login with its role, and a login without one has none', async () => {
    const w = makeWorld()
    const withRole = await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'Astro login', role: ASTROLOGER })
    const without = await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'Plain login' })
    const nulled = await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'Null role', role: null })
    expect(withRole.role).toEqual(ASTROLOGER)
    expect(without.role).toBeNull()
    expect(nulled.role).toBeNull()
    expect(w.core.repos.account(withRole.id).role).toEqual(ASTROLOGER)
    expect((await w.call('accounts.list', undefined)).map((a) => a.role?.name ?? null)).toEqual(['Astrologer', null, null])
  })

  it('stores the role as trimmed and refuses an unusable one without creating the login', async () => {
    const w = makeWorld()
    expect((await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'A', role: { name: '  Astrologer ', voice: ' calm ' } })).role).toEqual({ name: 'Astrologer', voice: 'calm' })
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'fake', label: 'B', role: { name: '', voice: 'x' } })).toBe('invalid_input')
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'fake', label: 'C', role: { name: 'x'.repeat(41), voice: '' } })).toBe('invalid_input')
    expect(await w.call('accounts.list', undefined)).toHaveLength(1)
  })

  it('lets an account be made with any role: the same-role rule applies when a channel is connected (DEC-015)', async () => {
    const w = makeWorld()
    await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'A', role: ASTROLOGER })
    await expect(w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'B', role: { name: 'ASTROLOGER ', voice: 'other voice' } })).resolves.toMatchObject({ label: 'B' })
  })

  it('does not let two logins of a product on one platform play the same role in its channels, whatever the case', async () => {
    const w = makeWorld({ extra: [new OtherConnector()] })
    const a = await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'A', role: ASTROLOGER })
    const b = await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'B', role: { name: 'ASTROLOGER ', voice: 'other voice' } })
    await w.call('channels.connect', { productId: w.productId, accountId: a.id, target: 'r/astrology' })
    const error = await w.call('channels.connect', { productId: w.productId, accountId: b.id, target: 'r/tarot' }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'role_exists' })
    expect((error as Error).message).toMatch(/A, another login of "Natal Mystic".*"Astrologer"/)
    expect(await w.call('channels.list', { productId: w.productId })).toHaveLength(1)

    // Another platform, or another product, may use the same role name.
    const c = await w.call('accounts.create', { productId: w.productId, platform: 'other', label: 'C', role: ASTROLOGER })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: c.id, target: 'https://other.test/forum' })).resolves.toMatchObject({ accountId: c.id })
    const second = w.addProduct('Tarot Deck')
    await expect(w.call('channels.connect', { productId: second, accountId: b.id, target: 'r/tarot' })).resolves.toMatchObject({ productId: second })
  })

  it('logs the role name, not the voice', async () => {
    const w = makeWorld()
    await w.call('accounts.create', { productId: w.productId, platform: 'fake', label: 'A', role: ASTROLOGER })
    const entry = w.core.log.list(10).find((e) => e.source === 'accounts' && e.message.includes('Account created'))
    expect(entry?.message).toContain('role "Astrologer"')
    expect(entry?.message).not.toContain(ASTROLOGER.voice)
  })
})

describe('accounts.setRole', () => {
  it('sets, changes and removes a role, logs each change and announces it', async () => {
    const w = await makeReadyWorld()
    w.changes.length = 0
    expect((await w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })).role).toEqual(ASTROLOGER)
    expect((await w.call('accounts.setRole', { accountId: w.account.id, role: { name: 'Astrologer', voice: 'Friendlier now.' } })).role).toEqual({ name: 'Astrologer', voice: 'Friendlier now.' })
    expect((await w.call('accounts.setRole', { accountId: w.account.id, role: null })).role).toBeNull()
    expect(w.core.repos.account(w.account.id).role).toBeNull()
    expect(w.changes).toContain('accounts')
    const messages = w.core.log.list(20).filter((e) => e.source === 'accounts').map((e) => e.message)
    expect(messages).toEqual(expect.arrayContaining(['Role of Natal Mystic Reddit set to "Astrologer".', 'Role of Natal Mystic Reddit removed.']))
    expect(messages.join(' ')).not.toContain('Friendlier')
  })

  it('does not log or announce anything when nothing changes', async () => {
    const w = await makeReadyWorld()
    const plain = await w.addAccount('No role')
    await w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })
    w.changes.length = 0
    const before = w.core.log.list(50).length
    await w.call('accounts.setRole', { accountId: w.account.id, role: { name: ' Astrologer ', voice: ASTROLOGER.voice } })
    await w.call('accounts.setRole', { accountId: plain.id, role: null })
    expect(w.changes).not.toContain('accounts')
    expect(w.core.log.list(50).length).toBe(before)
  })

  it('refuses unusable roles and unknown logins', async () => {
    const w = await makeReadyWorld()
    expect(await w.refusal('accounts.setRole', { accountId: w.account.id, role: { name: '', voice: 'x' } })).toBe('invalid_input')
    expect(await w.refusal('accounts.setRole', { accountId: w.account.id, role: { name: 'a\u0000', voice: '' } })).toBe('invalid_input')
    expect(await w.refusal('accounts.setRole', { accountId: w.account.id, role: { name: 'a', voice: 'v'.repeat(281) } })).toBe('invalid_input')
    expect(await w.refusal('accounts.setRole', { accountId: 'nope', role: ASTROLOGER })).toBe('not_found')
    expect(w.core.repos.account(w.account.id).role).toBeNull()
  })

  it('does not let a login take the role name of another login of a product it works for on the same platform', async () => {
    const w = await makeReadyWorld()
    const other = await w.addAccount('Second login')
    await w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })
    await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
    await w.call('channels.connect', { productId: w.productId, accountId: other.id, target: 'r/tarot' })
    expect(await w.refusal('accounts.setRole', { accountId: other.id, role: { name: 'astrologer', voice: '' } })).toBe('role_exists')
    // Its own name is never a clash: changing only the case or the voice is fine.
    await expect(w.call('accounts.setRole', { accountId: w.account.id, role: { name: 'ASTROLOGER', voice: 'Louder.' } })).resolves.toMatchObject({ role: { name: 'ASTROLOGER' } })
    await expect(w.call('accounts.setRole', { accountId: other.id, role: DEVELOPER })).resolves.toMatchObject({ role: DEVELOPER })
  })

  it('lets a second login of the product connect to the same community; each channel keeps its own login and role', async () => {
    const w = await makeReadyWorld()
    const other = await w.addAccount('Developer login')
    await w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })
    await w.call('accounts.setRole', { accountId: other.id, role: DEVELOPER })
    const first = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/astrology' })
    const second = await w.call('channels.connect', { productId: w.productId, accountId: other.id, target: 'r/astrology' })
    const channels = await w.call('channels.list', { productId: w.productId })
    expect(channels.filter((c) => c.target === first.target).map((c) => c.accountId).sort()).toEqual([w.account.id, other.id].sort())
    expect(second.id).not.toBe(first.id)
    expect(w.core.repos.account(second.accountId).role).toEqual(DEVELOPER)
    expect(w.core.repos.account(first.accountId).role).toEqual(ASTROLOGER)
  })

  it('a login of another product (a shared one) is not special: the role is the account\'s', async () => {
    const w = await makeReadyWorld()
    const second = w.addProduct('Tarot Deck')
    await w.call('channels.connect', { productId: second, accountId: w.account.id, target: 'r/tarot' })
    await expect(w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })).resolves.toMatchObject({ productId: w.productId, role: ASTROLOGER })
    expect((await w.call('accounts.list', undefined)).find((a) => a.id === w.account.id)?.role).toEqual(ASTROLOGER)
  })

  it('a role survives a restart', async () => {
    const w = await makeReadyWorld()
    await w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })
    const row = w.core.db.prepare('SELECT role_name AS n, role_voice AS v FROM accounts WHERE id = ?').get(w.account.id)
    expect(row).toEqual({ n: 'Astrologer', v: ASTROLOGER.voice })
  })
})

describe('roles on data that predates DEC-010 (migration 202)', () => {
  it('adds the role columns and leaves every existing login without a role', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)')
    for (const m of MIGRATIONS.filter((m) => m.id < 202)) {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, 'then')
    }
    db.prepare("INSERT INTO accounts (id, platform, label, identity, partition, status, created_at) VALUES ('a1', 'reddit', 'Old login', NULL, 'persist:a1', 'ready', 't')").run()
    migrate(db)
    expect(db.prepare('SELECT role_name AS n, role_voice AS v FROM accounts WHERE id = ?').get('a1')).toEqual({ n: null, v: null })
    db.prepare("UPDATE accounts SET role_name = 'Astrologer', role_voice = 'Calm.' WHERE id = 'a1'").run()
    expect(db.prepare('SELECT role_name AS n FROM accounts').get()).toEqual({ n: 'Astrologer' })
  })
})

// ───────────────────────────── accounts.suggestRoles ─────────────────────────────

const claim = (id: string, section: Claim['section'], text: string): Claim =>
  ({ id, lineageId: `l-${id}`, passportVersionId: 'v1', section, text, kind: 'fact', status: 'approved', sources: [], verifiedAt: null, unconfirmedAvailability: false, contradicts: [] }) as unknown as Claim

function knowledge(approved: Claim[], active: string | null = 'v1'): KnowledgeProvider {
  return { activeVersionId: () => active, approvedClaims: () => approved, prohibitedClaims: () => [claim('x', 'identity', 'SECRET PROHIBITED CLAIM')] }
}

const IDEAS = JSON.stringify({
  roles: [
    { name: 'Astrologer', voice: 'Calm and practical; talks about birth charts and does not predict the future.', usernameIdeas: ['ChartReader', 'NatalNotes'], reason: 'The audience asks chart questions.' },
    { name: 'Developer', voice: 'Technical and brief; explains how the report is calculated.', usernameIdeas: ['ReportBuilder'], reason: 'Some people ask how it works.' }
  ]
})

async function suggestWorld(extra: boolean = false): Promise<World> {
  const w = extra ? makeWorld({ extra: [new OtherConnector()] }) : makeWorld()
  w.account = await w.addAccount()
  w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports'), claim('c2', 'audience', 'For people who like astrology')])
  return w
}

describe('accounts.suggestRoles', () => {
  it('needs an approved passport, the same way channels.suggest does', async () => {
    const w = await makeReadyWorld()
    const error = await w.call('accounts.suggestRoles', { productId: w.productId }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'no_approved_passport', message: 'Approve the product passport first so the suggestions fit it' })
    w.core.services.knowledge = knowledge([], null)
    expect(await w.refusal('accounts.suggestRoles', { productId: w.productId })).toBe('no_approved_passport')
    expect(w.t.engine.calls).toEqual([])
  })

  it('needs a selected engine that is ready (engine_unavailable)', async () => {
    const w = await suggestWorld()
    w.core.settings.updateApp({ engineId: null })
    expect(await w.refusal('accounts.suggestRoles', { productId: w.productId })).toBe('engine_unavailable')
    w.core.settings.updateApp({ engineId: w.t.engine.id })
    w.t.engine.installed = false
    const error = await w.call('accounts.suggestRoles', { productId: w.productId }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'engine_unavailable', message: 'not installed' })
  })

  it('refuses an unknown or missing product', async () => {
    const w = await suggestWorld()
    expect(await w.refusal('accounts.suggestRoles', { productId: 'nope' })).toBe('not_found')
    expect(await w.refusal('accounts.suggestRoles', { productId: ' ' })).toBe('invalid_input')
  })

  it('returns the ideas of the real helper with approved claims only, and creates nothing', async () => {
    const w = await suggestWorld()
    w.t.engine.on('channels.roles', IDEAS)
    w.changes.length = 0
    const ideas = await w.call('accounts.suggestRoles', { productId: w.productId })
    expect(ideas.map((i) => i.name)).toEqual(['Astrologer', 'Developer'])
    expect(ideas[0]).toMatchObject({ usernameIdeas: ['ChartReader', 'NatalNotes'], reason: 'The audience asks chart questions.' })
    const prompt = w.t.engine.calls[0].prompt
    expect(prompt).toContain('identity: Makes birth chart reports')
    expect(prompt).not.toContain('SECRET PROHIBITED CLAIM')
    expect(await w.call('accounts.list', undefined)).toHaveLength(1)
    expect(w.changes).not.toContain('accounts')
    expect(w.core.log.list(5).some((e) => e.source === 'accounts' && /Suggested 2 roles/.test(e.message))).toBe(true)
  })

  it('suggests for the platform of the most recent login, and tells the helper which roles exist there', async () => {
    const w = await suggestWorld(true)
    await w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })
    w.t.clock.advance(60_000)
    const other = await w.call('accounts.create', { productId: w.productId, platform: 'other', label: 'Other login', role: DEVELOPER })
    let seen: Parameters<typeof suggestRoles>[1] | null = null
    const service = new RoleSuggestionService(w.core, {
      suggestRoles: async (_engine, input) => {
        seen = input
        return []
      }
    })
    await service.suggest({ productId: w.productId })
    expect(seen).toMatchObject({ platform: { platform: 'other', label: 'Other' }, existingRoles: ['Developer'] })
    expect(other.platform).toBe('other')

    w.t.clock.advance(60_000)
    await w.addAccount('Newest fake login')
    await service.suggest({ productId: w.productId })
    expect(seen).toMatchObject({ platform: { platform: 'fake' }, existingRoles: ['Astrologer'] })
  })

  it('without any login of the product, uses the first prepared platform', async () => {
    const w = makeWorld({ extra: [new OtherConnector()] })
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports')])
    let seen: Parameters<typeof suggestRoles>[1] | null = null
    const service = new RoleSuggestionService(w.core, {
      suggestRoles: async (_engine, input) => {
        seen = input
        return []
      }
    })
    await service.suggest({ productId: w.productId })
    expect(seen).toMatchObject({ platform: { platform: 'fake', prepared: true }, existingRoles: [] })
  })

  it('leaves out ideas the role rules would refuse or that repeat a role already in use', async () => {
    const w = await suggestWorld()
    await w.call('accounts.setRole', { accountId: w.account.id, role: ASTROLOGER })
    const service = new RoleSuggestionService(w.core, {
      suggestRoles: async () => [
        { name: 'astrologer', voice: 'Same role, other case.', usernameIdeas: ['a'], reason: 'r' },
        { name: 'x'.repeat(41), voice: 'Too long a name.', usernameIdeas: ['b'], reason: 'r' },
        { name: 'Bad\u0000', voice: 'Control character.', usernameIdeas: ['c'], reason: 'r' },
        { name: 'Teacher', voice: 'Patient and clear.', usernameIdeas: ['d'], reason: 'r' }
      ]
    })
    expect((await service.suggest({ productId: w.productId })).map((i) => i.name)).toEqual(['Teacher'])
  })

  it('reports an AI failure as a plain error', async () => {
    const w = await suggestWorld()
    const failing = new RoleSuggestionService(w.core, {
      suggestRoles: async () => {
        throw new AiError('timeout', 'The AI took too long.')
      }
    })
    await expect(failing.suggest({ productId: w.productId })).rejects.toMatchObject({ code: 'suggest_failed', message: 'The AI took too long.' })
    w.t.engine.on('channels.roles', 'not json')
    w.t.engine.on('channels.roles.repair', 'still not json')
    expect(await w.refusal('accounts.suggestRoles', { productId: w.productId })).toBe('suggest_failed')
  })
})
