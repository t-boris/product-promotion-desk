// "Suggest channels with AI" (DEC-009): needs an approved passport and a ready engine; uses approved claims only.

import { describe, expect, it } from 'vitest'
import type { Claim } from '../../shared/types'
import type { KnowledgeProvider } from '../services'
import { AiError } from '../ports'
import { Connectors } from '../connector-registry'
import type { Connector } from '../ports'
import { SuggestionService, connectableSuggestions, type SuggestHelp } from './suggestions'
import { suggestChannels } from './ai-help'
import { makeReadyWorld, type World } from './test-helpers'

const claim = (id: string, section: Claim['section'], text: string): Claim =>
  ({ id, lineageId: `l-${id}`, passportVersionId: 'v1', section, text, kind: 'fact', status: 'approved', sources: [], verifiedAt: null, unconfirmedAvailability: false, contradicts: [] }) as unknown as Claim

function knowledge(approved: Claim[], active: string | null = 'v1'): KnowledgeProvider {
  return { activeVersionId: () => active, approvedClaims: () => approved, prohibitedClaims: () => [claim('x', 'identity', 'SECRET PROHIBITED CLAIM')] }
}

const IDEAS = JSON.stringify({ suggestions: [{ platform: 'fake', target: 'r/astrology', reason: 'Active community; check its rules before posting.' }] })

async function world(): Promise<World> {
  const w = await makeReadyWorld()
  w.core.db.prepare('UPDATE products SET description = ?, website_url = ? WHERE id = ?').run('Birth chart reports', 'https://natal.example.com', w.productId)
  return w
}

describe('channels.suggest', () => {
  it('needs an approved passport first', async () => {
    const w = await world()
    const error = await w.call('channels.suggest', { productId: w.productId }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'no_approved_passport', message: 'Approve the product passport first so the suggestions fit it' })
    w.core.services.knowledge = knowledge([], null)
    expect(await w.refusal('channels.suggest', { productId: w.productId })).toBe('no_approved_passport')
    expect(w.t.engine.calls).toEqual([])
  })

  it('needs a selected engine that is ready', async () => {
    const w = await world()
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports')])
    w.core.settings.updateApp({ engineId: null })
    expect(await w.refusal('channels.suggest', { productId: w.productId })).toBe('engine_unavailable')
    w.core.settings.updateApp({ engineId: w.t.engine.id })
    w.t.engine.installed = false
    const error = await w.call('channels.suggest', { productId: w.productId }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'engine_unavailable', message: 'not installed' })
  })

  it('refuses an unknown product', async () => {
    const w = await world()
    expect(await w.refusal('channels.suggest', { productId: 'nope' })).toBe('not_found')
    expect(await w.refusal('channels.suggest', { productId: ' ' })).toBe('invalid_input')
  })

  it('asks the AI with approved claims only, what is already connected, and the platforms the app can connect', async () => {
    const w = await world()
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports'), claim('c2', 'audience', 'For people who like astrology')])
    await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/tarot' })
    const second = w.addProduct('Other product')
    const other = await w.addAccount('Other login', second)
    await w.call('channels.connect', { productId: second, accountId: other.id, target: 'r/otherproduct' })
    w.t.engine.on('channels.suggest', IDEAS)
    w.changes.length = 0

    const suggestions = await w.call('channels.suggest', { productId: w.productId })

    expect(suggestions).toEqual([{ platform: 'fake', target: 'r/astrology', reason: 'Active community; check its rules before posting.' }])
    const prompt = w.t.engine.calls[0].prompt
    expect(prompt).toContain('Name: Natal Mystic')
    expect(prompt).toContain('Website: https://natal.example.com')
    expect(prompt).toContain('Birth chart reports')
    expect(prompt).toContain('identity: Makes birth chart reports')
    expect(prompt).toContain('audience: For people who like astrology')
    expect(prompt).not.toContain('SECRET PROHIBITED CLAIM')
    expect(prompt).toMatch(/- fake: Fake/)
    expect(prompt).toContain('fake: r/tarot')
    expect(prompt).not.toContain('r/otherproduct')
    expect(w.changes).not.toContain('channels') // an idea is not a channel
    expect(w.core.repos.listChannels()).toHaveLength(2)
  })

  it('passes exactly the data the helper needs, and shows the platform catalog of the connectors', async () => {
    const w = await world()
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports')])
    let seen: Parameters<SuggestHelp['suggestChannels']>[1] | null = null
    const service = new SuggestionService(w.core, {
      suggestChannels: async (_engine, input) => {
        seen = input
        return [{ platform: 'fake', target: 'r/x', reason: 'because' }]
      }
    })
    expect(await service.suggest({ productId: w.productId })).toHaveLength(1)
    expect(seen).toEqual({
      product: { name: 'Natal Mystic', websiteUrl: 'https://natal.example.com', description: 'Birth chart reports' },
      claims: [{ section: 'identity', text: 'Makes birth chart reports' }],
      platforms: [{ connectorId: 'fake', platform: 'fake', label: 'Fake', prepared: true, loginUrl: 'https://fake.test/login' }],
      connected: []
    })
  })

  it('reports a failure of the AI as a plain error, not a crash', async () => {
    const w = await world()
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports')])
    const failing = new SuggestionService(w.core, {
      suggestChannels: async () => {
        throw new AiError('timeout', 'The AI took too long.')
      }
    })
    await expect(failing.suggest({ productId: w.productId })).rejects.toMatchObject({ code: 'suggest_failed', message: 'The AI took too long.' })
    // The real helper retries once, then gives up on an unusable answer.
    const real = new SuggestionService(w.core, { suggestChannels })
    w.t.engine.on('channels.suggest', 'not json at all')
    w.t.engine.on('channels.suggest.repair', 'still not json')
    await expect(real.suggest({ productId: w.productId })).rejects.toMatchObject({ code: 'suggest_failed' })
  })

  it('every idea is only an idea: unsafe or already connected ones are filtered by the helper', async () => {
    const w = await world()
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports')])
    await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'r/tarot' })
    w.t.engine.on(
      'channels.suggest',
      JSON.stringify({
        suggestions: [
          { platform: 'fake', target: 'r/tarot', reason: 'already there' },
          { platform: 'fake', target: 'r/astrology', reason: 'Good fit; read the rules first.' }
        ]
      })
    )
    const suggestions = await w.call('channels.suggest', { productId: w.productId })
    expect(suggestions.map((s) => s.target)).toEqual(['r/astrology'])
  })

  it('leaves out ideas whose address the connector cannot read', async () => {
    const w = await world()
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports')])
    const service = new SuggestionService(w.core, {
      suggestChannels: async () => [
        { platform: 'fake', target: 'r/astrology', reason: 'Real address.' },
        { platform: 'fake', target: 'Reddit: a subreddit for beginner birth chart readings', reason: 'A description, not an address.' },
        { platform: 'other', target: 'https://forum.example.com/', reason: 'No universal connector is registered here.' },
        { platform: 'nowhere', target: 'r/x', reason: 'Unknown platform.' }
      ]
    })
    expect(await service.suggest({ productId: w.productId })).toEqual([{ platform: 'fake', target: 'r/astrology', reason: 'Real address.' }])
  })
})

describe('connectableSuggestions', () => {
  const site = (id: string, platform: string, matches: (s: string) => boolean): Connector =>
    ({
      id,
      platform,
      version: '1',
      matches,
      normalizeTarget: (input: string) => {
        if (!/^https?:\/\//i.test(input)) throw new Error('not an address')
        return { target: input, url: input }
      }
    }) as unknown as Connector

  it('accepts web addresses for other sites through the universal connector only, and never bare words or other schemes', () => {
    const registry = new Connectors([site('universal', 'other', (s) => /^https?:\/\//i.test(s))])
    const ideas = [
      { platform: 'other', target: 'https://www.quora.com/topic/Astrology', reason: 'a' },
      { platform: 'other', target: 'astro.com forum', reason: 'b' },
      { platform: 'other', target: 'ftp://files.example.com/', reason: 'c' },
      { platform: 'other', target: 'Astrodienst (astro.com) user forum or community section', reason: 'd' }
    ]
    expect(connectableSuggestions(registry, ideas).map((i) => i.target)).toEqual(['https://www.quora.com/topic/Astrology'])
  })
})
