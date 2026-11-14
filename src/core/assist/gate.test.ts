// The gate every AI help passes: a product, a ready engine and, when the help needs it, an approved passport.

import { describe, expect, it } from 'vitest'
import type { Claim } from '../../shared/types'
import { makeReadyWorld } from '../channels/test-helpers'
import type { KnowledgeProvider } from '../services'
import { prepareAssist, readyEngine } from './gate'

const claim = (id: string, text: string): Claim =>
  ({ id, lineageId: `l-${id}`, passportVersionId: 'v1', section: 'identity', text, kind: 'fact', status: 'approved', sources: [], verifiedAt: null, unconfirmedAvailability: false, contradicts: [] }) as unknown as Claim

const knowledge = (approved: Claim[], active: string | null): KnowledgeProvider => ({
  activeVersionId: () => active,
  approvedClaims: () => approved,
  prohibitedClaims: () => []
})

async function refusal(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(
    () => null,
    (error: unknown) => error
  )
}

describe('prepareAssist', () => {
  it('refuses a missing or unknown product before anything else', async () => {
    const w = await makeReadyWorld()
    expect(await refusal(() => prepareAssist(w.core, ' ', { passport: 'optional' }))).toMatchObject({ code: 'invalid_input' })
    expect(await refusal(() => prepareAssist(w.core, 'nope', { passport: 'optional' }))).toMatchObject({ code: 'not_found' })
  })

  it('needs an approved passport only when the help asks for one', async () => {
    const w = await makeReadyWorld()
    w.core.services.knowledge = knowledge([], null)
    expect(await refusal(() => prepareAssist(w.core, w.productId, { passport: 'required' }))).toMatchObject({ code: 'no_approved_passport' })
    const context = await prepareAssist(w.core, w.productId, { passport: 'optional' })
    expect(context.claims).toEqual([])
    expect(context.product.id).toBe(w.productId)
    expect(context.engine.id).toBe(w.t.engine.id)
  })

  it('hands over the approved statements only, as section and text', async () => {
    const w = await makeReadyWorld()
    w.core.services.knowledge = knowledge([claim('c1', 'Makes birth chart reports')], 'v1')
    for (const passport of ['required', 'optional'] as const) {
      const context = await prepareAssist(w.core, w.productId, { passport })
      expect(context.claims).toEqual([{ section: 'identity', text: 'Makes birth chart reports' }])
    }
  })

  it('refuses without a ready engine whatever the passport says', async () => {
    const w = await makeReadyWorld()
    w.core.services.knowledge = knowledge([claim('c1', 'x')], 'v1')
    w.core.settings.updateApp({ engineId: null })
    expect(await refusal(() => prepareAssist(w.core, w.productId, { passport: 'optional' }))).toMatchObject({ code: 'engine_unavailable' })
    w.core.settings.updateApp({ engineId: w.t.engine.id })
    w.t.engine.installed = false
    expect(await refusal(() => prepareAssist(w.core, w.productId, { passport: 'optional' }))).toMatchObject({ code: 'engine_unavailable', message: 'not installed' })
  })
})

describe('readyEngine', () => {
  it('returns the selected engine when it is ready', async () => {
    const w = await makeReadyWorld()
    expect((await readyEngine(w.core)).id).toBe(w.t.engine.id)
  })
})
