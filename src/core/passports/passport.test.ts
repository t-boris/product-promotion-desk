import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { newId } from '../db/database'
import { makeTestCore } from '../testing/fakes'
import type { Claim, Id, PassportSection } from '../../shared/types'
import { passportsOf } from './index'
import { makeFolder, makeHarness, ScriptedEngine, type Harness } from './testkit'

async function newProduct(h: Harness, name = 'Natal Mystic'): Promise<Id> {
  const product = await h.call('products.create', { name, description: 'Natal chart calculator' })
  return product.id
}

async function addClaim(h: Harness, productId: Id, section: PassportSection, text: string, extra: { kind?: Claim['kind']; approve?: boolean } = {}): Promise<Claim> {
  const claim = await h.call('passport.claim.save', { productId, claim: { section, text, kind: extra.kind } })
  return extra.approve ? h.call('passport.claim.setStatus', { claimId: claim.id, status: 'approved' }) : claim
}

const claimsOf = async (h: Harness, productId: Id): Promise<Claim[]> => (await h.call('passport.get', { productId })).claims

describe('products and sources (REQ-001)', () => {
  it('creates a product from a website address alone or from a description alone', async () => {
    const h = makeHarness()
    const fromUrl = await h.call('products.create', { name: 'A', websiteUrl: 'example.com' })
    const fromText = await h.call('products.create', { name: 'B', description: 'A tool for astrologers' })
    expect(fromUrl.websiteUrl).toBe('https://example.com/')
    expect(fromText.description).toBe('A tool for astrologers')
    const urlSources = (await h.call('passport.get', { productId: fromUrl.id })).sources
    expect(urlSources.map((s) => [s.kind, s.ref])).toEqual([['url', 'https://example.com/']])
    const textSources = (await h.call('passport.get', { productId: fromText.id })).sources
    expect(textSources.map((s) => s.kind)).toEqual(['text'])
    expect((await h.call('products.list', undefined)).map((p) => p.name)).toEqual(['A', 'B'])
  })

  it('needs a name and at least one source, and refuses non-http addresses', async () => {
    const h = makeHarness()
    await expect(h.call('products.create', { name: '  ', description: 'x' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('products.create', { name: 'A' })).rejects.toMatchObject({ code: 'invalid_input' })
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com']) {
      await expect(h.call('products.create', { name: 'A', websiteUrl: bad }), bad).rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(await h.call('products.list', undefined)).toEqual([])
  })

  it('updates the product and keeps the mirrored sources in step', async () => {
    const h = makeHarness()
    const product = await h.call('products.create', { name: 'A', websiteUrl: 'https://old.example/', description: 'old text' })
    const updated = await h.call('products.update', { id: product.id, name: 'Renamed', websiteUrl: 'https://new.example/', description: 'new text' })
    expect(updated).toMatchObject({ name: 'Renamed', websiteUrl: 'https://new.example/', description: 'new text' })
    const sources = (await h.call('passport.get', { productId: product.id })).sources
    expect(sources.map((s) => s.ref).sort()).toEqual(['https://new.example/', 'new text'])
    // The product cannot be left without any source of knowledge.
    await expect(h.call('products.update', { id: product.id, websiteUrl: null, description: null })).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await h.call('passport.get', { productId: product.id })).sources).toHaveLength(2)
  })

  it('adds documents, images and code folders, and refuses secret files and unsafe folders', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const dir = makeFolder({ 'brief.md': '# Brief', 'logo.png': Buffer.from([1, 2, 3]), 'manual.pdf': 'pdf', '.env': 'TOKEN=abc12345', 'project/src/a.ts': 'a' })
    const doc = await h.call('sources.add', { productId, kind: 'document', ref: join(dir, 'brief.md') })
    const image = await h.call('sources.add', { productId, kind: 'image', ref: join(dir, 'logo.png') })
    const pdf = await h.call('sources.add', { productId, kind: 'document', ref: join(dir, 'manual.pdf') })
    const code = await h.call('sources.add', { productId, kind: 'code_folder', ref: join(dir, 'project'), scope: { include: ['src', './src/'], exclude: [] } })
    expect([doc.kind, image.kind, pdf.kind, code.kind]).toEqual(['document', 'image', 'document', 'code_folder'])
    expect(code.scope).toEqual({ include: ['src'], exclude: [] })
    await expect(h.call('sources.add', { productId, kind: 'document', ref: join(dir, '.env') })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('sources.add', { productId, kind: 'document', ref: 'relative/file.md' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('sources.add', { productId, kind: 'image', ref: join(dir, 'manual.pdf') })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('sources.add', { productId, kind: 'code_folder', ref: '/' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('sources.add', { productId, kind: 'code_folder', ref: dir, scope: { include: ['../x'], exclude: [] } })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('sources.add', { productId, kind: 'document', ref: join(dir, 'brief.md') })).rejects.toMatchObject({ code: 'conflict' })
    await h.call('sources.remove', { id: image.id })
    expect((await h.call('passport.get', { productId })).sources.map((s) => s.kind)).not.toContain('image')
  })

  it('corrects a source in place: same id and date, the same checks as adding, and the statements keep citing it (BUG-034)', async () => {
    const h = makeHarness()
    // A product with its own website and description, so the sources added below are not mirrors of them.
    const productId = (await h.call('products.create', { name: 'Natal Mystic', websiteUrl: 'https://natal.example/', description: 'Natal chart calculator' })).id
    const notes = await h.call('sources.add', { productId, kind: 'text', ref: 'Frist reading is free', label: 'Notes' })
    const site = await h.call('sources.add', { productId, kind: 'url', ref: 'https://docs.example/' })
    const claim = await h.call('passport.claim.save', { productId, claim: { section: 'terms', text: 'The first reading is free', kind: 'fact', sources: [{ sourceId: notes.id, ref: notes.ref, verifiedAt: notes.addedAt }] } })

    const fixed = await h.call('sources.update', { id: notes.id, ref: '  First reading is free  ', label: 'Notes' })
    expect(fixed).toMatchObject({ id: notes.id, kind: 'text', ref: 'First reading is free', label: 'Notes', addedAt: notes.addedAt })
    const moved = await h.call('sources.update', { id: site.id, ref: 'docs.example/help' })
    expect(moved).toMatchObject({ id: site.id, ref: 'https://docs.example/help', addedAt: site.addedAt })
    const view = await h.call('passport.get', { productId })
    expect(view.sources.map((x) => x.id).slice(-2)).toEqual([notes.id, site.id])
    expect(view.claims.find((c) => c.id === claim.id)?.sources[0]?.sourceId).toBe(notes.id)

    // The same checks as adding: an empty or unsafe source, a copy of another one, a source that is gone.
    await expect(h.call('sources.update', { id: notes.id, ref: '   ' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('sources.update', { id: site.id, ref: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('sources.update', { id: notes.id, ref: 'Natal chart calculator' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(h.call('sources.update', { id: 'missing', ref: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    // The website and the description are mirrored from the product details and change only there.
    for (const [ref, next] of [['Natal chart calculator', 'Another text'], ['https://natal.example/', 'https://other.example/']]) {
      const mirror = view.sources.find((x) => x.ref === ref)!
      await expect(h.call('sources.update', { id: mirror.id, ref: next }), ref).rejects.toMatchObject({ code: 'invalid_state' })
      expect((await h.call('passport.get', { productId })).sources.find((x) => x.id === mirror.id)?.ref).toBe(ref)
    }
  })

  it('corrects a named text that became the description and keeps the description in step with it (BUG-034)', async () => {
    const h = makeHarness()
    // A product with a website only: the first text added becomes its description too, under the name the owner gave it.
    const product = await h.call('products.create', { name: 'Natal Mystic', websiteUrl: 'https://natal.example/' })
    const notes = await h.call('sources.add', { productId: product.id, kind: 'text', ref: 'Frist reading is free', label: 'Notes' })
    expect((await h.call('products.list', undefined))[0].description).toBe('Frist reading is free')

    const fixed = await h.call('sources.update', { id: notes.id, ref: 'First reading is free', label: 'Notes' })
    expect(fixed).toMatchObject({ id: notes.id, ref: 'First reading is free', label: 'Notes', addedAt: notes.addedAt })
    expect((await h.call('products.list', undefined))[0].description).toBe('First reading is free')
  })

  it('makes a new automatic name for a new address, and keeps a name the owner chose (BUG-034)', async () => {
    const h = makeHarness()
    const productId = (await h.call('products.create', { name: 'Natal Mystic', websiteUrl: 'https://natal.example/', description: 'Natal chart calculator' })).id
    const docs = await h.call('sources.add', { productId, kind: 'url', ref: 'https://docs.example/' })
    expect(docs.label).toBe('docs.example')
    // "Edit" sends back the name it showed; the app's own name follows the address.
    const moved = await h.call('sources.update', { id: docs.id, ref: 'https://help.other.org/start', label: 'docs.example' })
    expect(moved).toMatchObject({ ref: 'https://help.other.org/start', label: 'help.other.org' })
    const named = await h.call('sources.update', { id: docs.id, ref: 'https://help.other.org/start', label: 'Help centre' })
    const movedAgain = await h.call('sources.update', { id: docs.id, ref: 'https://docs.example/', label: 'Help centre' })
    expect([named.label, movedAgain.label]).toEqual(['Help centre', 'Help centre'])
  })

  it('keeps or replaces the scope of a code folder when it is corrected (BUG-034)', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const dir = makeFolder({ 'project/src/a.ts': 'export const a = 1', 'project/docs/b.md': '# b', 'other/c.ts': 'x' })
    const code = await h.call('sources.add', { productId, kind: 'code_folder', ref: join(dir, 'project'), scope: { include: ['src'], exclude: [] } })
    const kept = await h.call('sources.update', { id: code.id, ref: join(dir, 'project'), label: 'App' })
    expect(kept).toMatchObject({ label: 'App', scope: { include: ['src'], exclude: [] } })
    const cleared = await h.call('sources.update', { id: code.id, ref: join(dir, 'other'), label: 'App', scope: null })
    // No scope means the whole folder, stored as empty lists, the same as when a folder is added without one.
    expect(cleared).toMatchObject({ ref: join(dir, 'other'), scope: { include: [], exclude: [] }, addedAt: code.addedAt })
  })

  it('previews what the AI would see for each kind of source, before anything is analyzed', async () => {
    const h = makeHarness()
    const dir = makeFolder({ 'brief.md': '# Brief', 'logo.png': Buffer.from([1]), 'app/src/a.ts': 'a', 'app/node_modules/x/i.js': 'x', 'app/.env': 'K=1' })
    const doc = await h.call('sources.preview', { kind: 'document', ref: join(dir, 'brief.md') })
    expect(doc.included).toEqual([join(dir, 'brief.md')])
    const image = await h.call('sources.preview', { kind: 'image', ref: join(dir, 'logo.png') })
    expect(image.included).toEqual([])
    expect(image.excluded[0].reason).toMatch(/material only/)
    const code = await h.call('sources.preview', { kind: 'code_folder', ref: join(dir, 'app') })
    expect(code.included).toEqual(['src/a.ts'])
    expect(code.excluded.map((e) => e.path).sort()).toEqual(['.env', 'node_modules/'])
    const url = await h.call('sources.preview', { kind: 'url', ref: 'example.com' })
    expect(url.included).toEqual(['https://example.com/'])
    await expect(h.call('sources.preview', { kind: 'url', ref: 'ftp://example.com' })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('retains several promotion goals and shows them again (REQ-006, DEC-012)', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    expect((await h.call('products.list', undefined))[0].goals).toEqual([])

    const first = await h.call('products.saveGoal', { id: productId, goal: { targetAction: 'Create the first natal chart', successMetrics: ['Charts created', '  ', 'Return visits'], notes: 'Start with Reddit' } })
    expect(first.goals).toHaveLength(1)
    expect(first.goals[0]).toMatchObject({ targetAction: 'Create the first natal chart', successMetrics: ['Charts created', 'Return visits'], notes: 'Start with Reddit' })
    const second = await h.call('products.saveGoal', { id: productId, goal: { targetAction: 'Join the newsletter', successMetrics: [], notes: '' } })
    expect(second.goals.map((g) => g.targetAction)).toEqual(['Create the first natal chart', 'Join the newsletter'])
    expect(new Set(second.goals.map((g) => g.id)).size).toBe(2)

    expect((await h.call('products.list', undefined))[0].goals).toEqual(second.goals)
    expect((await h.call('passport.get', { productId })).product.goals).toEqual(second.goals)
  })

  it('edits a goal in place, removes one, and rejects an empty target action or an unknown goal', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    await h.call('products.saveGoal', { id: productId, goal: { targetAction: 'Create a chart', successMetrics: [], notes: '' } })
    const two = await h.call('products.saveGoal', { id: productId, goal: { targetAction: 'Join the waitlist', successMetrics: [], notes: '' } })
    const [a, b] = two.goals

    const edited = await h.call('products.saveGoal', { id: productId, goal: { id: a.id, targetAction: 'Create a chart and share it', successMetrics: ['shares'], notes: 'week 1' } })
    expect(edited.goals.map((g) => g.id)).toEqual([a.id, b.id])
    expect(edited.goals[0]).toMatchObject({ targetAction: 'Create a chart and share it', successMetrics: ['shares'], notes: 'week 1' })

    await expect(h.call('products.saveGoal', { id: productId, goal: { targetAction: '   ', successMetrics: [], notes: '' } })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('products.saveGoal', { id: productId, goal: { id: 'missing', targetAction: 'x', successMetrics: [], notes: '' } })).rejects.toMatchObject({ code: 'not_found' })
    await expect(h.call('products.removeGoal', { id: productId, goalId: 'missing' })).rejects.toMatchObject({ code: 'not_found' })

    const left = await h.call('products.removeGoal', { id: productId, goalId: a.id })
    expect(left.goals.map((g) => g.id)).toEqual([b.id])
    expect((await h.call('products.removeGoal', { id: productId, goalId: b.id })).goals).toEqual([])
  })

  it('limits the number of goals of one product', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    for (let i = 1; i <= 20; i += 1) await h.call('products.saveGoal', { id: productId, goal: { targetAction: `Goal ${i}`, successMetrics: [], notes: '' } })
    await expect(h.call('products.saveGoal', { id: productId, goal: { targetAction: 'One too many', successMetrics: [], notes: '' } })).rejects.toMatchObject({ code: 'conflict' })
    const all = (await h.call('products.list', undefined))[0].goals
    expect(all).toHaveLength(20)
    // An existing goal can still be edited at the limit.
    expect((await h.call('products.saveGoal', { id: productId, goal: { id: all[0].id, targetAction: 'Renamed', successMetrics: [], notes: '' } })).goals[0].targetAction).toBe('Renamed')
  })
})

describe('manual entry without an AI engine (REQ-006)', () => {
  it('lets the user build and approve a passport by hand, and leaves all data intact when AI is requested', async () => {
    const h = makeHarness()
    h.engine.installed = false
    const productId = await newProduct(h)
    const name = await addClaim(h, productId, 'identity', 'The product is called Natal Mystic', { approve: true })
    await addClaim(h, productId, 'offer', 'Calculates a natal chart from birth data', { approve: true })
    const before = await h.call('passport.get', { productId })

    await expect(h.call('analysis.start', { productId })).rejects.toMatchObject({ code: 'engine_unavailable' })

    h.core.settings.updateApp({ engineId: null })
    await expect(h.call('analysis.start', { productId })).rejects.toMatchObject({ code: 'engine_unavailable' })
    const after = await h.call('passport.get', { productId })
    expect(after.claims).toEqual(before.claims)
    expect(after.product.analysisStatus).toBe('idle')
    expect(h.engine.calls).toEqual([])

    const version = await h.call('passport.approve', { productId })
    expect(version).toMatchObject({ version: 1, status: 'approved' })
    expect(h.core.services.knowledge?.approvedClaims(productId).map((c) => c.id)).toContain(name.id)
  })
})

describe('claims: kinds, sources and the rules for approval (REQ-001)', () => {
  it('a claim typed by the user is a fact with a source and a verification date', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const claim = await addClaim(h, productId, 'offer', 'Calculates a natal chart')
    expect(claim).toMatchObject({ kind: 'fact', status: 'proposed', verifiedAt: '2026-11-08T12:00:00.000Z' })
    expect(claim.sources).toEqual([{ sourceId: null, ref: 'Entered by the user', verifiedAt: '2026-11-08T12:00:00.000Z' }])
  })

  it('assumptions and unknowns carry no sources and stay what they are when edited', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const assumption = await addClaim(h, productId, 'audience', 'Probably hobby astrologers', { kind: 'assumption' })
    expect(assumption).toMatchObject({ kind: 'assumption', sources: [], verifiedAt: null })
    const edited = await h.call('passport.claim.save', { productId, claim: { id: assumption.id, section: 'audience', text: 'Probably hobby astrologers and tarot readers' } })
    expect(edited).toMatchObject({ kind: 'assumption', sources: [], verifiedAt: null })
    const confirmed = await h.call('passport.claim.save', {
      productId,
      claim: { id: assumption.id, section: 'audience', text: 'Hobby astrologers', sources: [{ sourceId: null, ref: 'Customer interviews', verifiedAt: '2026-10-01T00:00:00.000Z' }] }
    })
    expect(confirmed).toMatchObject({ kind: 'fact', verifiedAt: '2026-10-01T00:00:00.000Z' })
  })

  it('refuses to approve unknowns, contradictions and unsourced price statements', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const unknown = await addClaim(h, productId, 'terms', 'Price is not known yet', { kind: 'unknown' })
    await expect(h.call('passport.claim.setStatus', { claimId: unknown.id, status: 'approved' })).rejects.toMatchObject({ code: 'claim_not_usable' })
    const guess = await addClaim(h, productId, 'terms', 'The first chart is probably free', { kind: 'assumption' })
    await expect(h.call('passport.claim.setStatus', { claimId: guess.id, status: 'approved' })).rejects.toMatchObject({ code: 'claim_not_usable' })
    // The same statement becomes usable once the user stands behind it with a source.
    const verified = await h.call('passport.claim.save', {
      productId,
      claim: { id: guess.id, section: 'terms', text: 'The first chart is free', sources: [{ sourceId: null, ref: 'Pricing page, checked by the owner', verifiedAt: '2026-11-08T00:00:00.000Z' }] }
    })
    expect((await h.call('passport.claim.setStatus', { claimId: verified.id, status: 'approved' })).status).toBe('approved')
    // Prohibiting needs no source: it only restricts.
    expect((await h.call('passport.claim.setStatus', { claimId: unknown.id, status: 'prohibited' })).status).toBe('prohibited')
  })

  it('editing the words of an approved claim returns it to review; prohibition stays', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const claim = await addClaim(h, productId, 'offer', 'Calculates a natal chart', { approve: true })
    const edited = await h.call('passport.claim.save', { productId, claim: { id: claim.id, section: 'offer', text: 'Calculates natal and synastry charts' } })
    expect(edited.status).toBe('proposed')
    const prohibited = await addClaim(h, productId, 'communication', 'Guarantees accurate predictions')
    await h.call('passport.claim.setStatus', { claimId: prohibited.id, status: 'prohibited' })
    const reworded = await h.call('passport.claim.save', { productId, claim: { id: prohibited.id, section: 'communication', text: 'Guarantees exact predictions' } })
    expect(reworded.status).toBe('prohibited')
  })

  it('rejects malformed claim input', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    await expect(h.call('passport.claim.save', { productId, claim: { section: 'pricing' as PassportSection, text: 'x' } })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('passport.claim.save', { productId, claim: { section: 'offer', text: '   ' } })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.call('passport.claim.setStatus', { claimId: newId(), status: 'approved' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(h.call('passport.claim.setStatus', { claimId: newId(), status: 'bogus' as never })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('passport versions: history is preserved (REQ-001)', () => {
  it('editing an approved passport starts a draft copy; the approved version is never changed', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const a = await addClaim(h, productId, 'offer', 'Calculates a natal chart', { approve: true })
    await addClaim(h, productId, 'identity', 'The product is called Natal Mystic', { approve: true })
    const v1 = await h.call('passport.approve', { productId })
    const v1Claims = await claimsOf(h, productId)

    const edited = await h.call('passport.claim.save', { productId, claim: { id: a.id, section: 'offer', text: 'Calculates natal charts instantly' } })
    expect(edited.id).not.toBe(a.id)
    expect(edited.lineageId).toBe(a.lineageId)
    expect(edited.passportVersionId).not.toBe(v1.id)

    const view = await h.call('passport.get', { productId })
    expect(view.version).toMatchObject({ version: 2, status: 'draft' })
    expect(view.claims).toHaveLength(2)
    expect(view.claims.map((c) => c.lineageId).sort()).toEqual(v1Claims.map((c) => c.lineageId).sort())
    // The untouched claim was copied with a new id and the same lineage, status and sources.
    const copy = view.claims.find((c) => c.lineageId !== a.lineageId)
    const original = v1Claims.find((c) => c.lineageId === copy?.lineageId)
    expect(copy?.id).not.toBe(original?.id)
    expect(copy).toMatchObject({ status: 'approved', text: original?.text, sources: original?.sources })

    // The approved version still has exactly what it had.
    const stored = passportsOf(h.core).repo.claims(v1.id)
    const summary = (claims: Claim[]) => claims.map((c) => [c.id, c.text, c.status]).sort()
    expect(summary(stored)).toEqual(summary(v1Claims))
    expect(h.core.services.knowledge?.approvedClaims(productId).find((c) => c.lineageId === a.lineageId)?.text).toBe('Calculates a natal chart')
  })

  it('approving the draft supersedes the previous version without changing it', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const a = await addClaim(h, productId, 'offer', 'Calculates a natal chart', { approve: true })
    const v1 = await h.call('passport.approve', { productId })
    await h.call('passport.claim.save', { productId, claim: { id: a.id, section: 'offer', text: 'Calculates natal charts instantly' } })
    const draftClaim = (await claimsOf(h, productId))[0]
    await h.call('passport.claim.setStatus', { claimId: draftClaim.id, status: 'approved' })
    const v2 = await h.call('passport.approve', { productId })

    const versions = await h.call('passport.versions', { productId })
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'approved'],
      [1, 'superseded']
    ])
    expect((await h.call('products.list', undefined))[0].activePassportVersionId).toBe(v2.id)
    expect(passportsOf(h.core).repo.claims(v1.id).map((c) => c.text)).toEqual(['Calculates a natal chart'])
    expect(h.core.services.knowledge?.activeVersionId(productId)).toBe(v2.id)
    expect(h.core.services.knowledge?.approvedClaims(productId).map((c) => c.text)).toEqual(['Calculates natal charts instantly'])
    // The superseded version cannot be edited any more.
    await expect(h.call('passport.claim.setStatus', { claimId: a.id, status: 'rejected' })).rejects.toMatchObject({ code: 'read_only' })
    // And nothing is left to approve.
    await expect(h.call('passport.approve', { productId })).rejects.toMatchObject({ code: 'no_draft' })
  })

  it('cannot approve a passport without any approved claim', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    await addClaim(h, productId, 'offer', 'Calculates a natal chart')
    await expect(h.call('passport.approve', { productId })).rejects.toMatchObject({ code: 'nothing_to_approve' })
  })

  it('exposes only the approved version to the rest of the application, never a draft', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const knowledge = h.core.services.knowledge
    expect(knowledge?.activeVersionId(productId)).toBeNull()
    expect(knowledge?.approvedClaims(productId)).toEqual([])
    const ok = await addClaim(h, productId, 'offer', 'Calculates a natal chart', { approve: true })
    const rejected = await addClaim(h, productId, 'offer', 'Predicts the future')
    await h.call('passport.claim.setStatus', { claimId: rejected.id, status: 'rejected' })
    const banned = await addClaim(h, productId, 'communication', 'Promises medical advice')
    await h.call('passport.claim.setStatus', { claimId: banned.id, status: 'prohibited' })
    await addClaim(h, productId, 'audience', 'Hobby astrologers', { kind: 'assumption' })
    expect(knowledge?.approvedClaims(productId)).toEqual([]) // nothing is visible before the first approval
    await h.call('passport.approve', { productId })
    expect(knowledge?.approvedClaims(productId).map((c) => c.id)).toHaveLength(1)
    expect(knowledge?.approvedClaims(productId)[0].lineageId).toBe(ok.lineageId)
    expect(knowledge?.prohibitedClaims(productId).map((c) => c.text)).toEqual(['Promises medical advice'])
    // A pending edit is invisible until it is approved.
    await h.call('passport.claim.save', { productId, claim: { section: 'offer', text: 'Draft-only claim' } })
    expect(knowledge?.approvedClaims(productId).map((c) => c.text)).not.toContain('Draft-only claim')
    expect(knowledge?.approvedClaims(newId())).toEqual([])
  })
})

describe('changed facts go back to review (REQ-001, SRC-001 section 2)', () => {
  async function approvedPassport(h: Harness) {
    const productId = await newProduct(h)
    const price = await addClaim(h, productId, 'terms', 'The first chart is free', { approve: true })
    const offer = await addClaim(h, productId, 'offer', 'Calculates a natal chart', { approve: true })
    const lang = await addClaim(h, productId, 'geo_languages', 'Available in English', { approve: true })
    const kept = await addClaim(h, productId, 'identity', 'The product is called Natal Mystic', { approve: true })
    await h.call('passport.approve', { productId })
    return { productId, price, offer, lang, kept }
  }

  it('reports exactly the lineages whose text changed or that were rejected, prohibited or deleted', async () => {
    const h = makeHarness()
    const invalidate = vi.fn((_productId: Id, _lineageIds: Id[]) => 3)
    h.core.services.pipeline = { invalidateForChangedFacts: invalidate }
    const { productId, price, offer, lang, kept } = await approvedPassport(h)
    expect(invalidate).not.toHaveBeenCalled() // the first approval has no earlier facts to change

    await h.call('passport.claim.save', { productId, claim: { id: price.id, section: 'terms', text: 'The first chart is free of charge' } })
    const draft = await claimsOf(h, productId)
    const draftOf = (lineage: string): Claim => draft.find((c) => c.lineageId === lineage) as Claim
    await h.call('passport.claim.setStatus', { claimId: draftOf(price.lineageId).id, status: 'approved' })
    await h.call('passport.claim.setStatus', { claimId: draftOf(offer.lineageId).id, status: 'rejected' })
    await h.call('passport.claim.setStatus', { claimId: draftOf(lang.lineageId).id, status: 'prohibited' })
    const added = await addClaim(h, productId, 'communication', 'Never promise medical results', { approve: true })
    await h.call('passport.claim.setStatus', { claimId: added.id, status: 'prohibited' })
    await h.call('passport.approve', { productId })

    expect(invalidate).toHaveBeenCalledTimes(1)
    const [calledProduct, lineages] = invalidate.mock.calls[0]
    expect(calledProduct).toBe(productId)
    expect([...lineages].sort()).toEqual([price.lineageId, offer.lineageId, lang.lineageId, added.lineageId].sort())
    expect(lineages).not.toContain(kept.lineageId)
  })

  it('reports a deleted fact, and nothing when only unrelated claims change', async () => {
    const h = makeHarness()
    const invalidate = vi.fn((_productId: Id, _lineageIds: Id[]) => 0)
    h.core.services.pipeline = { invalidateForChangedFacts: invalidate }
    const { productId, offer, kept } = await approvedPassport(h)

    await h.call('passport.claim.save', { productId, claim: { section: 'materials', text: 'A demo video exists' } })
    await h.call('passport.approve', { productId })
    expect(invalidate).not.toHaveBeenCalled()

    const draft = await claimsOf(h, productId)
    await h.call('passport.claim.delete', { claimId: (draft.find((c) => c.lineageId === offer.lineageId) as Claim).id })
    await h.call('passport.approve', { productId })
    expect(invalidate).toHaveBeenCalledWith(productId, [offer.lineageId])
    expect(invalidate.mock.calls[0][1]).not.toContain(kept.lineageId)
  })

  it('works without a pipeline module and survives a failing one; the approval stands', async () => {
    const h = makeHarness()
    const { productId, offer } = await approvedPassport(h)
    h.core.services.pipeline = undefined // the flow module may not be there (yet)
    await h.call('passport.claim.setStatus', { claimId: offer.id, status: 'rejected' })
    await expect(h.call('passport.approve', { productId })).resolves.toMatchObject({ version: 2 })

    h.core.services.pipeline = {
      invalidateForChangedFacts: () => {
        throw new Error('review queue exploded')
      }
    }
    const draftClaim = (await claimsOf(h, productId)).find((c) => c.lineageId === offer.lineageId) as Claim
    await h.call('passport.claim.setStatus', { claimId: draftClaim.id, status: 'proposed' })
    const extra = await addClaim(h, productId, 'offer', 'Another capability', { approve: true })
    await h.call('passport.claim.setStatus', { claimId: extra.id, status: 'prohibited' })
    await expect(h.call('passport.approve', { productId })).resolves.toMatchObject({ version: 3, status: 'approved' })
    expect(h.core.log.list(50, 'error').some((e) => /review queue exploded/.test(e.message))).toBe(true)
  })
})

describe('contradictions stay visible until the user resolves them (REQ-001)', () => {
  async function conflicting(h: Harness) {
    const productId = await newProduct(h)
    const a = await addClaim(h, productId, 'identity', 'The product is called Natal Mystic', { approve: true })
    const b = await addClaim(h, productId, 'identity', 'The product is called AstroWeb')
    const mod = passportsOf(h.core)
    const [contradiction] = mod.claims.addContradictions(productId, [{ claimIds: [a.id, b.id], description: 'The name differs between the site title and the metadata' }])
    return { productId, a, b, contradiction, mod }
  }

  it('links the conflicting claims and refuses approval while unresolved; neither version is picked', async () => {
    const h = makeHarness()
    const { productId, a, b, contradiction } = await conflicting(h)
    expect(contradiction).toMatchObject({ kind: 'contradiction', status: 'proposed', conflictsWith: [a.id, b.id] })
    const claims = await claimsOf(h, productId)
    expect(claims.find((c) => c.id === a.id)?.conflictsWith).toEqual([b.id])
    expect(claims.find((c) => c.id === b.id)?.conflictsWith).toEqual([a.id])
    expect(claims.find((c) => c.id === b.id)?.status).toBe('proposed')
    await expect(h.call('passport.approve', { productId })).rejects.toMatchObject({ code: 'unresolved_contradictions' })
    await expect(h.call('passport.claim.setStatus', { claimId: contradiction.id, status: 'approved' })).rejects.toMatchObject({ code: 'claim_not_usable' })
  })

  it('does not record the same conflict twice', async () => {
    const h = makeHarness()
    const { productId, a, b, mod } = await conflicting(h)
    expect(mod.claims.addContradictions(productId, [{ claimIds: [b.id, a.id], description: 'again' }])).toEqual([])
    expect((await claimsOf(h, productId)).filter((c) => c.kind === 'contradiction')).toHaveLength(1)
  })

  it('is resolved by rejecting it, which clears the links', async () => {
    const h = makeHarness()
    const { productId, a, b, contradiction } = await conflicting(h)
    await h.call('passport.claim.setStatus', { claimId: b.id, status: 'rejected' }) // the user picks a version explicitly
    await h.call('passport.claim.setStatus', { claimId: contradiction.id, status: 'rejected' })
    const claims = await claimsOf(h, productId)
    expect(claims.find((c) => c.id === a.id)?.conflictsWith).toEqual([])
    await expect(h.call('passport.approve', { productId })).resolves.toMatchObject({ status: 'approved' })
  })

  it('is resolved by editing it into a fact', async () => {
    const h = makeHarness()
    const { productId, contradiction } = await conflicting(h)
    const resolved = await h.call('passport.claim.save', {
      productId,
      claim: { id: contradiction.id, section: 'identity', text: 'The official name is Natal Mystic (AstroWeb is the old brand)', kind: 'fact' }
    })
    expect(resolved).toMatchObject({ kind: 'fact', conflictsWith: [] })
    expect(resolved.sources[0].ref).toBe('Entered by the user')
    await h.call('passport.claim.setStatus', { claimId: resolved.id, status: 'approved' })
    await expect(h.call('passport.approve', { productId })).resolves.toMatchObject({ status: 'approved' })
  })

  it('is resolved by removing it, or by removing one of the conflicting claims', async () => {
    const h = makeHarness()
    const first = await conflicting(h)
    await h.call('passport.claim.delete', { claimId: first.contradiction.id })
    expect((await claimsOf(h, first.productId)).find((c) => c.id === first.a.id)?.conflictsWith).toEqual([])
    await expect(h.call('passport.approve', { productId: first.productId })).resolves.toBeDefined()

    const second = await conflicting(h)
    await h.call('passport.claim.delete', { claimId: second.b.id })
    const claims = await claimsOf(h, second.productId)
    expect(claims.some((c) => c.kind === 'contradiction')).toBe(false) // nothing conflicts any more
    expect(claims.find((c) => c.id === second.a.id)?.conflictsWith).toEqual([])
  })
})

describe('products with history and persistence', () => {
  it('deletes a product with its sources, versions and claims', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    await addClaim(h, productId, 'offer', 'x', { approve: true })
    await h.call('passport.approve', { productId })
    await h.call('products.delete', { id: productId })
    expect(await h.call('products.list', undefined)).toEqual([])
    const left = h.core.db.prepare('SELECT (SELECT COUNT(*) FROM claims) AS c, (SELECT COUNT(*) FROM passport_versions) AS v, (SELECT COUNT(*) FROM product_sources) AS s').get()
    expect(left).toEqual({ c: 0, v: 0, s: 0 })
    await expect(h.call('passport.get', { productId })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('refuses to delete a product that has channels or publication history', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const now = new Date().toISOString()
    const accountId = newId()
    const channelId = newId()
    h.core.db.prepare("INSERT INTO accounts (id, platform, label, partition, created_at) VALUES (?, 'reddit', 'a', 'p', ?)").run(accountId, now)
    h.core.db
      .prepare("INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, settings_json, created_at) VALUES (?, ?, ?, 'reddit', 'reddit', 'r/x', 'u', '{}', ?)")
      .run(channelId, productId, accountId, now)
    await expect(h.call('products.delete', { id: productId })).rejects.toMatchObject({ code: 'conflict' })
    expect(await h.call('products.list', undefined)).toHaveLength(1)
  })

  it('keeps products, sources, claims, versions and goal across a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppd-restart-'))
    const dbPath = join(dir, 'app.sqlite')
    writeFileSync(join(dir, 'note.txt'), 'x')
    const first = makeTestCore({ dbPath })
    const call1 = first.core.router.call.bind(first.core.router)
    const product = await call1('products.create', { name: 'Natal Mystic', description: 'Natal charts' })
    await call1('products.saveGoal', { id: product.id, goal: { targetAction: 'Create a chart', successMetrics: ['charts'], notes: '' } })
    const claim = await call1('passport.claim.save', { productId: product.id, claim: { section: 'offer', text: 'Calculates a natal chart' } })
    await call1('passport.claim.setStatus', { claimId: claim.id, status: 'approved' })
    await call1('passport.approve', { productId: product.id })
    const viewBefore = await call1('passport.get', { productId: product.id })
    await first.core.shutdown()

    const second = makeTestCore({ dbPath })
    const viewAfter = await second.core.router.call('passport.get', { productId: product.id })
    expect(viewAfter).toEqual(viewBefore)
    expect(viewAfter.product.goals.map((g) => g.targetAction)).toEqual(['Create a chart'])
    expect(second.core.services.knowledge?.approvedClaims(product.id).map((c) => c.text)).toEqual(['Calculates a natal chart'])
    await second.core.shutdown()
  })

  it('ignores engine problems entirely: manual data does not need the engine', async () => {
    const h = makeHarness([new ScriptedEngine('claude')])
    h.engine.installed = false
    const productId = await newProduct(h)
    await addClaim(h, productId, 'offer', 'Calculates a natal chart', { approve: true })
    expect((await h.call('passport.approve', { productId })).status).toBe('approved')
  })
})
