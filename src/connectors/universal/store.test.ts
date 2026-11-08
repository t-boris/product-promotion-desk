import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import { ProfileStore } from './store'
import { validProfileDefinition } from './test-helpers'

function setup() {
  const t = makeTestCore()
  return { ...t, store: new ProfileStore(t.core.db, t.core.clock) }
}

describe('profile store (connector_profiles)', () => {
  it('versions profiles per host and keeps every version', () => {
    const { store } = setup()
    const v1 = store.save(validProfileDefinition())
    const v2 = store.save(validProfileDefinition({ name: 'Example forum v2' }))
    expect([v1.version, v2.version]).toEqual([1, 2])
    expect(store.list('forum.example.com').map((p) => p.version)).toEqual([2, 1])
    expect(v2.valid).toBe(true)
    expect(v2.profile?.name).toBe('Example forum v2')
  })

  it('stores an invalid definition with the valid flag off and the validation errors, and never uses it', () => {
    const { store } = setup()
    store.save(validProfileDefinition())
    const bad = store.save(validProfileDefinition({ script: 'alert(1)' }))
    expect(bad.valid).toBe(false)
    expect(bad.errors.join('\n')).toMatch(/script/)
    expect(bad.profile).toBeNull()
    const found = store.forHost('forum.example.com')
    expect(found.latest?.version).toBe(2)
    expect(found.valid?.version).toBe(1) // the newest *valid* version is what the connector uses
  })

  it('persists across a reopened store on the same database', () => {
    const { core, store } = setup()
    store.save(validProfileDefinition())
    const again = new ProfileStore(core.db, core.clock)
    expect(again.forHost('forum.example.com').valid?.profile?.host).toBe('forum.example.com')
    const row = core.db.prepare('SELECT valid, validation_json FROM connector_profiles').get() as { valid: number; validation_json: string }
    expect(row.valid).toBe(1)
    expect(row.validation_json).toBe('[]')
  })

  it('finds a profile of the parent domain for a subdomain, and nothing for other sites', () => {
    const { store } = setup()
    store.save(validProfileDefinition())
    expect(store.forHost('eu.forum.example.com').valid).not.toBeNull()
    expect(store.forHost('other.example.org').valid).toBeNull()
    expect(store.forHost('example.com').valid).toBeNull()
  })

  it('files a definition without a usable host under a placeholder instead of failing', () => {
    const { store } = setup()
    const stored = store.save({ nonsense: true })
    expect(stored.valid).toBe(false)
    expect(stored.host).toBe('(invalid)')
    expect(store.save('text').version).toBe(2)
  })
})
