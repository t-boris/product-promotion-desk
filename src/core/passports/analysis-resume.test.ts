import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AnalysisStage, Claim, Id } from '../../shared/types'
import { AiError } from '../ports'
import { makeTestCore } from '../testing/fakes'
import { deferred, html, json, keysIn, makeHarness, ScriptedEngine, startSite, until, waitForAnalysis, type Harness, type Site } from './testkit'

const PAGES = { '/': html('Natal Mystic', '<h1>Natal Mystic</h1><p>Create your natal chart online.</p>') }
const sites: Site[] = []
afterEach(async () => {
  await Promise.all(sites.splice(0).map((s) => s.close()))
})
const openSite = async (): Promise<Site> => {
  const s = await startSite(PAGES)
  sites.push(s)
  return s
}

const eKeys = (prompt: string): string[] => [...prompt.matchAll(/^(E\d+) /gm)].map((m) => m[1])

/** An engine that answers every stage with a small, valid result. `extra` adds claims to the synthesis. */
function script(engine: ScriptedEngine, extra: { text: string; section?: string }[] = []): ScriptedEngine {
  return engine
    .on('passport.documents', (task) => json({ findings: [{ section: 'offer', kind: 'fact', text: 'Calculates natal charts', evidence: keysIn(task.prompt).slice(0, 1) }] }))
    .on('passport.synthesize', (task) =>
      json({
        claims: [
          { section: 'identity', kind: 'fact', text: 'The product is called Natal Mystic', evidence: keysIn(task.prompt).slice(0, 1) },
          ...eKeys(task.prompt).map((key) => ({ section: 'offer', kind: 'fact', text: 'Calculates natal charts', evidence: [key] })),
          ...extra.map((e) => ({ section: e.section ?? 'audience', kind: 'assumption', text: e.text, evidence: [] }))
        ]
      })
    )
    .on('passport.contradictions', json({ conflicts: [] }))
}

async function start(h: Harness, productId: Id): Promise<void> {
  await h.call('analysis.start', { productId })
  await waitForAnalysis(h.core, productId)
}

const stages = async (h: Harness, productId: Id): Promise<Record<string, AnalysisStage>> =>
  Object.fromEntries((await h.call('passport.get', { productId })).stages.map((s) => [s.name, s]))

async function productWithSite(h: Harness, site: Site): Promise<Id> {
  return (await h.call('products.create', { name: 'Natal Mystic', websiteUrl: site.url, description: 'Natal chart calculator' })).id
}

describe('analysis can be resumed and keeps completed stages (REQ-001)', () => {
  it('resumes after a failure without repeating the finished stages', async () => {
    const h = makeHarness([script(new ScriptedEngine())])
    const site = await openSite()
    const productId = await productWithSite(h, site)
    let broken = true
    h.engine.on('passport.synthesize', (task) => {
      if (broken) throw new AiError('failed', 'engine crashed')
      return json({
        claims: [
          { section: 'identity', kind: 'fact', text: 'The product is called Natal Mystic', evidence: keysIn(task.prompt).slice(0, 1) },
          { section: 'audience', kind: 'assumption', text: 'Hobby astrologers', evidence: [] }
        ]
      })
    })

    await start(h, productId)
    let s = await stages(h, productId)
    expect(s.read_site.status).toBe('done')
    expect(s.analyze_documents.status).toBe('done')
    expect(s.synthesize.status).toBe('failed')
    expect(s.synthesize.detail).toMatch(/engine crashed/)
    expect(s.find_contradictions.status).toBe('skipped')
    expect(h.core.repos.product(productId).analysisStatus).toBe('failed')
    const fetched = site.hits.length
    const documentCalls = h.engine.callsFor('passport.documents').length

    broken = false
    await start(h, productId)
    s = await stages(h, productId)
    expect(Object.values(s).map((x) => x.status)).toEqual(['done', 'done', 'skipped', 'done', 'done'])
    expect(h.core.repos.product(productId).analysisStatus).toBe('complete')
    expect(site.hits.length).toBe(fetched) // the site was not read again
    expect(h.engine.callsFor('passport.documents')).toHaveLength(documentCalls) // nor the documents analyzed again
  })

  it('a changed source makes only the affected stages run again', async () => {
    const h = makeHarness([script(new ScriptedEngine())])
    const site = await openSite()
    const productId = await productWithSite(h, site)
    let broken = true
    h.engine.on('passport.synthesize', (task) => {
      if (broken) throw new AiError('failed', 'engine crashed')
      return json({
        claims: [
          { section: 'identity', kind: 'fact', text: 'The product is called Natal Mystic', evidence: keysIn(task.prompt).slice(0, 1) },
          { section: 'audience', kind: 'assumption', text: 'Hobby astrologers', evidence: [] }
        ]
      })
    })
    await start(h, productId)
    const fetched = site.hits.length
    await h.call('sources.add', { productId, kind: 'text', ref: 'Also supports synastry charts.', label: 'Notes' })
    broken = false
    await start(h, productId)
    expect(h.engine.callsFor('passport.documents')).toHaveLength(2) // re-analyzed: its input changed
    expect(site.hits.length).toBe(fetched) // the website did not change
    expect(h.core.repos.product(productId).analysisStatus).toBe('complete')
  })

  it('stops on request, keeps the finished stages, and continues from where it stopped', async () => {
    const engine = script(new ScriptedEngine())
    const h = makeHarness([engine])
    const site = await openSite()
    const productId = await productWithSite(h, site)
    const gate = deferred()
    engine.on('passport.documents', async (task) => {
      await gate.promise
      return json({ findings: [{ section: 'offer', kind: 'fact', text: 'Calculates natal charts', evidence: keysIn(task.prompt).slice(0, 1) }] })
    })

    await h.call('analysis.start', { productId })
    await until(() => engine.callsFor('passport.documents').length === 1)
    expect(h.core.repos.product(productId).analysisStatus).toBe('running')
    const stopped = await h.call('analysis.stop', { productId })

    expect(stopped.product.analysisStatus).toBe('paused')
    const s = await stages(h, productId)
    expect(s.read_site.status).toBe('done') // completed work survives
    expect(s.analyze_documents).toMatchObject({ status: 'pending' })
    expect(s.analyze_documents.detail).toMatch(/Stopped/)
    expect(s.synthesize.status).toBe('pending')
    const run = (await h.call('runs.list', {})).find((r) => r.kind === 'analysis')
    expect(run).toMatchObject({ status: 'suspended' })
    expect(run?.summary).toMatch(/stopped by the user/)

    const fetched = site.hits.length
    gate.resolve()
    await start(h, productId)
    expect(h.core.repos.product(productId).analysisStatus).toBe('complete')
    expect(site.hits.length).toBe(fetched)
    expect((await stages(h, productId)).synthesize.status).toBe('done')
  })

  it('stopping when nothing runs is harmless, and starting twice runs only once', async () => {
    const engine = script(new ScriptedEngine())
    const h = makeHarness([engine])
    const productId = (await h.call('products.create', { name: 'P', description: 'Natal chart calculator' })).id
    expect((await h.call('analysis.stop', { productId })).product.analysisStatus).toBe('idle')
    await Promise.all([h.call('analysis.start', { productId }), h.call('analysis.start', { productId })])
    await waitForAnalysis(h.core, productId)
    expect(engine.callsFor('passport.documents')).toHaveLength(1)
    expect((await h.call('runs.list', {})).filter((r) => r.kind === 'analysis')).toHaveLength(1)
  })

  it('persists the output of finished stages in the database', async () => {
    const h = makeHarness([script(new ScriptedEngine())])
    const productId = await productWithSite(h, await openSite())
    await start(h, productId)
    const rows = h.core.db.prepare('SELECT name, status, output_json FROM analysis_stages WHERE product_id = ? ORDER BY name').all(productId) as { name: string; status: string; output_json: string | null }[]
    expect(rows.map((r) => r.name)).toEqual(['analyze_documents', 'find_contradictions', 'read_site', 'scan_code', 'synthesize'])
    for (const row of rows.filter((r) => r.status === 'done')) {
      expect(JSON.parse(row.output_json as string)).toHaveProperty('inputHash')
    }
    const site = JSON.parse(rows.find((r) => r.name === 'read_site')?.output_json as string) as { data: { pages: { text: string }[] } }
    expect(site.data.pages[0].text).toContain('natal chart online')
  })

  it('a finished analysis starts over when run again, without duplicating claims', async () => {
    const engine = script(new ScriptedEngine())
    const h = makeHarness([engine])
    const productId = await productWithSite(h, await openSite())
    await start(h, productId)
    const first = (await h.call('passport.get', { productId })).claims
    await start(h, productId)
    expect(engine.callsFor('passport.documents')).toHaveLength(2)
    const second = (await h.call('passport.get', { productId })).claims
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id))
  })
})

describe('analysis survives restarts and shutdown (REQ-001, REQ-005)', () => {
  it('after a crash the product and finished stages are intact and the analysis can be resumed', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'ppd-crash-')), 'app.sqlite')
    const site = await openSite()
    const gate = deferred()
    const first = new ScriptedEngine()
    script(first).on('passport.documents', async () => {
      await gate.promise
      return json({ findings: [] })
    })
    const one = makeTestCore({ dbPath, engines: [first] })
    const productId = (await one.core.router.call('products.create', { name: 'Natal Mystic', websiteUrl: site.url, description: 'Natal chart calculator' })).id
    await one.core.router.call('analysis.start', { productId })
    await until(() => first.callsFor('passport.documents').length === 1)
    // "Crash": a second process opens the same database while the first one is stuck mid-analysis.
    const second = script(new ScriptedEngine())
    const two = makeTestCore({ dbPath, engines: [second] })
    const view = await two.core.router.call('passport.get', { productId })
    expect(view.product.analysisStatus).toBe('paused')
    expect(view.stages.find((s) => s.name === 'read_site')?.status).toBe('done')
    expect(view.stages.find((s) => s.name === 'analyze_documents')).toMatchObject({ status: 'pending' })
    expect(view.stages.find((s) => s.name === 'analyze_documents')?.detail).toMatch(/Interrupted/)

    const fetched = site.hits.length
    await two.core.router.call('analysis.start', { productId })
    await waitForAnalysis(two.core, productId)
    expect(two.core.repos.product(productId).analysisStatus).toBe('complete')
    expect(site.hits.length).toBe(fetched)
    gate.resolve()
    await one.core.shutdown()
    await two.core.shutdown()
  })

  it('shutting the core down stops a running analysis and leaves it resumable', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'ppd-shutdown-')), 'app.sqlite')
    const site = await openSite()
    const gate = deferred()
    const engine = script(new ScriptedEngine()).on('passport.documents', async () => {
      await gate.promise
      return json({ findings: [] })
    })
    const one = makeTestCore({ dbPath, engines: [engine] })
    const productId = (await one.core.router.call('products.create', { name: 'Natal Mystic', websiteUrl: site.url, description: 'Natal chart calculator' })).id
    await one.core.router.call('analysis.start', { productId })
    await until(() => engine.callsFor('passport.documents').length === 1)
    await one.core.shutdown()

    const two = makeTestCore({ dbPath, engines: [script(new ScriptedEngine())] })
    const view = await two.core.router.call('passport.get', { productId })
    expect(view.product.analysisStatus).toBe('paused')
    expect(view.stages.find((s) => s.name === 'read_site')?.status).toBe('done')
    gate.resolve()
    await two.core.shutdown()
  })

  it('deleting a product stops its analysis without errors', async () => {
    const engine = script(new ScriptedEngine())
    const h = makeHarness([engine])
    const productId = await productWithSite(h, await openSite())
    const gate = deferred()
    engine.on('passport.documents', async () => {
      await gate.promise
      return json({ findings: [] })
    })
    await h.call('analysis.start', { productId })
    await until(() => engine.callsFor('passport.documents').length === 1)
    await h.call('products.delete', { id: productId })
    gate.resolve()
    expect(await h.call('products.list', undefined)).toEqual([])
    expect(h.core.log.list(50, 'error')).toEqual([])
  })
})

describe('analysis needs an engine, manual entry does not (REQ-006)', () => {
  it('refuses to start without a working engine and changes nothing', async () => {
    const engine = script(new ScriptedEngine())
    const h = makeHarness([engine])
    const productId = (await h.call('products.create', { name: 'P', description: 'Natal chart calculator' })).id
    await h.call('passport.claim.save', { productId, claim: { section: 'offer', text: 'Calculates natal charts' } })
    const before = await h.call('passport.get', { productId })

    h.core.settings.updateApp({ engineId: null })
    await expect(h.call('analysis.start', { productId })).rejects.toMatchObject({ code: 'engine_unavailable' })
    h.core.settings.updateApp({ engineId: 'claude' })
    engine.installed = false
    await expect(h.call('analysis.start', { productId })).rejects.toMatchObject({ code: 'engine_unavailable' })

    expect(await h.call('passport.get', { productId })).toEqual({ ...before, stages: expect.any(Array) })
    expect(h.core.db.prepare('SELECT COUNT(*) AS n FROM analysis_stages').get()).toEqual({ n: 0 })
    expect(engine.calls).toEqual([])
  })

  it('an engine that disappears mid-analysis fails the AI stages cleanly, keeps what was read, and skips the rest', async () => {
    const engine = script(new ScriptedEngine())
    const h = makeHarness([engine])
    const productId = await productWithSite(h, await openSite())
    engine.on('passport.documents', () => {
      throw new AiError('unavailable', 'claude is not signed in')
    })
    await start(h, productId)
    const s = await stages(h, productId)
    expect(s.read_site.status).toBe('done')
    expect(s.analyze_documents.status).toBe('failed')
    expect(s.analyze_documents.detail).toMatch(/not available/)
    expect(s.synthesize).toMatchObject({ status: 'skipped' })
    expect(s.synthesize.detail).toMatch(/AI engine is not available/)
    expect(engine.callsFor('passport.synthesize')).toEqual([])
    expect(h.core.repos.product(productId).analysisStatus).toBe('failed')
  })
})

describe('switching the AI engine keeps all product data (REQ-006)', () => {
  it('products, claims, versions and knowledge are unchanged after the switch; analysis with the other engine adds to them', async () => {
    const claude = script(new ScriptedEngine('claude', 'Claude Code'))
    const codex = script(new ScriptedEngine('codex', 'Codex'), [{ text: 'Seen only by Codex: hobby astrologers' }])
    const h = makeHarness([claude, codex])
    const site = await openSite()
    const productId = await productWithSite(h, site)
    await h.call('products.saveGoal', { id: productId, goal: { targetAction: 'Create a chart', successMetrics: ['charts'], notes: '' } })
    await start(h, productId)

    // The user reviews and approves part of the passport.
    const analyzed = (await h.call('passport.get', { productId })).claims
    const name = analyzed.find((c) => c.text === 'The product is called Natal Mystic') as Claim
    const banned = await h.call('passport.claim.save', { productId, claim: { section: 'communication', text: 'Guarantees predictions' } })
    await h.call('passport.claim.setStatus', { claimId: name.id, status: 'approved' })
    await h.call('passport.claim.setStatus', { claimId: banned.id, status: 'prohibited' })
    const v1 = await h.call('passport.approve', { productId })

    const snapshot = async () => ({
      products: await h.call('products.list', undefined),
      view: await h.call('passport.get', { productId }),
      versions: await h.call('passport.versions', { productId }),
      approved: h.core.services.knowledge?.approvedClaims(productId),
      prohibited: h.core.services.knowledge?.prohibitedClaims(productId),
      active: h.core.services.knowledge?.activeVersionId(productId)
    })
    const before = await snapshot()
    expect(before.approved).toHaveLength(1)

    const settings = await h.call('engines.select', { id: 'codex' })
    expect(settings.engineId).toBe('codex')
    expect(await snapshot()).toEqual(before) // switching alone changes nothing

    // Analysing with the other engine only adds proposals; the approved passport and its history stay.
    await start(h, productId)
    expect(codex.callsFor('passport.synthesize')).toHaveLength(1)
    const draft = await h.call('passport.get', { productId })
    expect(draft.version).toMatchObject({ version: 2, status: 'draft' })
    expect(draft.claims.find((c) => c.text.startsWith('Seen only by Codex'))).toMatchObject({ status: 'proposed', kind: 'assumption' })
    expect(draft.claims.find((c) => c.lineageId === name.lineageId)).toMatchObject({ status: 'approved' })
    expect(draft.claims.find((c) => c.lineageId === banned.lineageId)).toMatchObject({ status: 'prohibited' })
    expect(h.core.services.knowledge?.activeVersionId(productId)).toBe(v1.id)
    expect(h.core.services.knowledge?.approvedClaims(productId)).toEqual(before.approved)
    expect((await h.call('passport.versions', { productId })).find((v) => v.id === v1.id)).toMatchObject({ status: 'approved' })
    expect((await h.call('products.list', undefined))[0].goals.map((g) => g.targetAction)).toEqual(['Create a chart'])
  })

  it('re-analysis shows new findings as proposals to review; nothing approved is overwritten', async () => {
    const engine = script(new ScriptedEngine(), [{ text: 'Brand new audience hypothesis' }])
    const h = makeHarness([engine])
    const productId = await productWithSite(h, await openSite())
    const claim = await h.call('passport.claim.save', { productId, claim: { section: 'identity', text: 'The product is called Natal Mystic' } })
    await h.call('passport.claim.setStatus', { claimId: claim.id, status: 'approved' })
    const v1 = await h.call('passport.approve', { productId })

    await start(h, productId)
    const view = await h.call('passport.get', { productId })
    expect(view.version).toMatchObject({ version: 2, status: 'draft' })
    expect(view.claims.filter((c) => c.status === 'approved').map((c) => c.lineageId)).toEqual([claim.lineageId])
    const fresh = view.claims.filter((c) => c.status === 'proposed')
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.map((c) => c.text)).toContain('Brand new audience hypothesis')
    // The identical statement already in the passport was not proposed a second time.
    expect(view.claims.filter((c) => c.text === 'The product is called Natal Mystic')).toHaveLength(1)
    expect((await h.call('passport.versions', { productId })).find((v) => v.id === v1.id)?.status).toBe('approved')
  })
})
