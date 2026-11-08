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

  it('retains the promotion goal and shows it again (REQ-006)', async () => {
    const h = makeHarness()
    const productId = await newProduct(h)
    const goal = { targetAction: 'Create the first natal chart', successMetrics: ['Charts created', '  ', 'Return visits'], notes: 'Start with Reddit' }
    const product = await h.call('products.setGoal', { id: productId, goal })
    expect(product.goal).toEqual({ targetAction: 'Create the first natal chart', successMetrics: ['Charts created', 'Return visits'], notes: 'Start with Reddit' })
    expect((await h.call('products.list', undefined))[0].goal).toEqual(product.goal)
    expect((await h.call('passport.get', { productId })).product.goal).toEqual(product.goal)
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
    await call1('products.setGoal', { id: product.id, goal: { targetAction: 'Create a chart', successMetrics: ['charts'], notes: '' } })
    const claim = await call1('passport.claim.save', { productId: product.id, claim: { section: 'offer', text: 'Calculates a natal chart' } })
    await call1('passport.claim.setStatus', { claimId: claim.id, status: 'approved' })
    await call1('passport.approve', { productId: product.id })
    const viewBefore = await call1('passport.get', { productId: product.id })
    await first.core.shutdown()

    const second = makeTestCore({ dbPath })
    const viewAfter = await second.core.router.call('passport.get', { productId: product.id })
    expect(viewAfter).toEqual(viewBefore)
    expect(viewAfter.product.goal?.targetAction).toBe('Create a chart')
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
