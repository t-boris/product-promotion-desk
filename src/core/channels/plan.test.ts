// "Plan with AI" for one channel (DEC-013): needs an approved passport and a ready engine; advice only; unsafe or ill-fitting steps are dropped.

import { describe, expect, it } from 'vitest'
import type { Claim } from '../../shared/types'
import type { KnowledgeProvider } from '../services'
import { AiError } from '../ports'
import { FakeConnector } from '../testing/fake-connector'
import type { NormalizedTarget } from '../ports'
import { ChannelPlanService } from './plan'
import { planChannel } from './ai-help'
import { makeReadyWorld, type World } from './test-helpers'

class FakeUniversal extends FakeConnector {
  readonly label = 'Other website'
  constructor() {
    super({ id: 'universal', platform: 'web' })
  }
  override matches(input: string): boolean {
    return /^https?:\/\//i.test(input.trim())
  }
  override normalizeTarget(input: string): NormalizedTarget {
    const url = new URL(input.trim())
    return { target: `${url.hostname}${url.pathname}`.replace(/\/+$/, ''), url: url.toString() }
  }
  override loginUrl(): string {
    return ''
  }
}

const claim = (id: string, section: Claim['section'], text: string): Claim =>
  ({ id, lineageId: `l-${id}`, passportVersionId: 'v1', section, text, kind: 'fact', status: 'approved', sources: [], verifiedAt: null, unconfirmedAvailability: false, contradicts: [] }) as unknown as Claim

const knowledge = (approved: Claim[], active: string | null = 'v1'): KnowledgeProvider => ({
  activeVersionId: () => active,
  approvedClaims: () => approved,
  prohibitedClaims: () => [claim('x', 'identity', 'SECRET PROHIBITED CLAIM')]
})

const PLAN = JSON.stringify({
  summary: 'Show the chart in short videos and answer comments.',
  steps: [
    { title: 'Post a short video of a chart being made', detail: 'Screen-record the first chart from birth data to the plain-language reading.', format: 'video', youPrepare: 'A 30 second screen recording', frequency: 'once a week' },
    { title: 'Answer comments under your posts', detail: 'Reply to questions about the reading, saying that you make the app.', format: 'other', youPrepare: null, frequency: 'daily' }
  ],
  watchOut: ['Check the account type needed for posting.', 'The platform restricts automation.']
})

async function world(): Promise<{ w: World; channelId: string }> {
  const w = await makeReadyWorld({ extra: [new FakeUniversal()] })
  w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports'), claim('c2', 'audience', 'For people who like astrology')])
  w.core.db.prepare('UPDATE products SET description = ?, website_url = ?, goals_json = ? WHERE id = ?').run(
    'Birth chart reports',
    'https://natal.example.com',
    JSON.stringify([{ id: 'g1', targetAction: 'Create the first natal chart', successMetrics: ['charts created'], notes: '' }]),
    w.productId
  )
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'Brand on Instagram', role: { name: 'founder', voice: 'The person who makes the app; says so.' } })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: '@natalmystic' })
  return { w, channelId: channel.id }
}

describe('channels.preparePlan', () => {
  it('needs an approved passport, a ready engine and a real channel', async () => {
    const { w, channelId } = await world()
    w.core.services.knowledge = knowledge([], null)
    expect(await w.refusal('channels.preparePlan', { channelId })).toBe('no_approved_passport')
    w.core.services.knowledge = knowledge([claim('c1', 'identity', 'Makes birth chart reports')])
    w.core.settings.updateApp({ engineId: null })
    expect(await w.refusal('channels.preparePlan', { channelId })).toBe('engine_unavailable')
    w.core.settings.updateApp({ engineId: w.t.engine.id })
    expect(await w.refusal('channels.preparePlan', { channelId: 'nope' })).toBe('not_found')
    expect(await w.refusal('channels.preparePlan', { channelId: ' ' })).toBe('invalid_input')
    expect(w.t.engine.calls).toEqual([])
  })

  it('asks with the approved claims, the goals, the platform and the roles, and stores the plan with the channel', async () => {
    const { w, channelId } = await world()
    w.t.engine.on('channels.plan', PLAN)
    w.changes.length = 0

    const channel = await w.call('channels.preparePlan', { channelId })

    expect(channel.plan).toMatchObject({ summary: 'Show the chart in short videos and answer comments.', engineId: w.t.engine.id })
    expect(channel.plan?.generatedAt).toBe(w.core.clock.now().toISOString())
    expect(channel.plan?.steps).toEqual([
      { title: 'Post a short video of a chart being made', detail: 'Screen-record the first chart from birth data to the plain-language reading.', format: 'video', youPrepare: 'A 30 second screen recording', frequency: 'once a week' },
      { title: 'Answer comments under your posts', detail: 'Reply to questions about the reading, saying that you make the app.', format: 'other', youPrepare: null, frequency: 'daily' }
    ])
    expect(channel.plan?.watchOut).toHaveLength(2)
    expect(w.changes).toContain('channels')
    expect((await w.call('channels.list', { productId: w.productId }))[0].plan).toEqual(channel.plan)

    const prompt = w.t.engine.calls[0].prompt
    expect(prompt).toContain('Name: Natal Mystic')
    expect(prompt).toContain('identity: Makes birth chart reports')
    expect(prompt).not.toContain('SECRET PROHIBITED CLAIM')
    expect(prompt).toContain('Create the first natal chart')
    expect(prompt).toContain('judged by: charts created')
    expect(prompt).toContain('Instagram')
    expect(prompt).toContain('can contain: image, video')
    expect(prompt).toContain('does not create media')
    expect(prompt).toContain('founder: The person who makes the app; says so.')
    expect(prompt).toContain('https://www.instagram.com/natalmystic/')
  })

  it('advice only: nothing is assessed, drafted or published, and no other channel changes', async () => {
    const { w, channelId } = await world()
    w.t.engine.on('channels.plan', PLAN)
    const before = w.core.repos.channel(channelId)
    const after = await w.call('channels.preparePlan', { channelId })
    expect({ ...after, plan: null }).toEqual({ ...before, plan: null })
    expect(w.core.db.prepare('SELECT COUNT(*) c FROM drafts').get()).toEqual({ c: 0 })
    expect(w.core.db.prepare('SELECT COUNT(*) c FROM send_actions').get()).toEqual({ c: 0 })
  })

  it('replaces the previous plan, and keeps it when a new attempt fails', async () => {
    const { w, channelId } = await world()
    w.t.engine.on('channels.plan', PLAN)
    const first = await w.call('channels.preparePlan', { channelId })
    w.t.engine.on('channels.plan', JSON.stringify({ summary: 'A different idea.', steps: [{ title: 'Reply to comments', detail: 'Answer questions.', format: 'other', youPrepare: null, frequency: null }], watchOut: [] }))
    const second = await w.call('channels.preparePlan', { channelId })
    expect(second.plan?.summary).toBe('A different idea.')

    const failing = new ChannelPlanService(
      w.core,
      {
        planChannel: async () => {
          throw new AiError('timeout', 'The AI took too long.')
        }
      },
      // the store is only used on success
      undefined as never
    )
    await expect(failing.prepare({ channelId })).rejects.toMatchObject({ code: 'plan_failed', message: 'The AI took too long.' })
    expect(w.core.repos.channel(channelId).plan).toEqual(second.plan)
    expect(first.plan?.summary).not.toBe(second.plan?.summary)
  })

  it('gives up with a plain error when two answers in a row are unusable, and stores nothing', async () => {
    const { w, channelId } = await world()
    w.t.engine.on('channels.plan', 'not json at all')
    w.t.engine.on('channels.plan.repair', 'still not json')
    await expect(w.call('channels.preparePlan', { channelId })).rejects.toMatchObject({ code: 'plan_failed' })
    expect(w.core.repos.channel(channelId).plan).toBeNull()
  })
})

describe('planChannel', () => {
  const platform = { connectorId: 'universal', platform: 'instagram', label: 'Instagram', prepared: false, loginUrl: '', accepts: ['image', 'video'] as ('image' | 'video')[], note: 'Needs media.' }
  const input = {
    product: { name: 'Natal Mystic', websiteUrl: null, description: null },
    claims: [],
    goals: [],
    platform,
    channel: { target: 'x', url: 'https://www.instagram.com/x/' },
    roles: [],
    abilities: []
  }
  const ask = async (answer: unknown) => {
    const w = await makeReadyWorld()
    w.t.engine.on('channels.plan', JSON.stringify(answer))
    return planChannel(w.t.engine, input)
  }
  const step = (extra: Record<string, unknown>) => ({ title: 'A step', detail: 'Do the thing.', format: 'video', youPrepare: null, frequency: null, ...extra })

  it('drops a step the platform cannot take, keeps what is not a post, and keeps the order', async () => {
    const plan = await ask({
      summary: 'S',
      steps: [step({ title: 'Plain text post', format: 'text' }), step({ title: 'Reel', format: 'video' }), step({ title: 'Read the rules', format: 'other' }), step({ title: 'Photo', format: 'image' })],
      watchOut: []
    })
    expect(plan.steps.map((s) => s.title)).toEqual(['Reel', 'Read the rules', 'Photo'])
  })

  it('drops advice that fakes or forces engagement, automates, or promises results', async () => {
    const plan = await ask({
      summary: 'S',
      steps: [
        step({ title: 'Buy followers to look popular' }),
        step({ title: 'Use a fake account to praise the app' }),
        step({ title: 'Bypass the daily limit', detail: 'Work around the checks.' }),
        step({ title: 'Reply automatically to every comment', detail: 'auto-reply to all comments' }),
        step({ title: 'Post a video', detail: 'This is guaranteed to bring 1000 users.' }),
        step({ title: 'Share a behind the scenes video' })
      ],
      watchOut: ['Do not use a bot.', 'Check the rules.']
    })
    expect(plan.steps.map((s) => s.title)).toEqual(['Share a behind the scenes video'])
    expect(plan.watchOut).toEqual(['Check the rules.'])
  })

  it('limits the number and the length of everything, and writes plain text', async () => {
    const many = Array.from({ length: 12 }, (_, i) => step({ title: `Step ${i + 1}` }))
    const plan = await ask({ summary: `**${'x'.repeat(600)}**`, steps: many, watchOut: Array.from({ length: 9 }, (_, i) => `Point ${i + 1}`) })
    expect(plan.steps).toHaveLength(8)
    expect(plan.watchOut).toHaveLength(6)
    expect(plan.summary.length).toBeLessThanOrEqual(400)
    expect(plan.summary).not.toContain('*')
  })

  it('needs at least one usable step and a summary', async () => {
    const w = await makeReadyWorld()
    w.t.engine.on('channels.plan', JSON.stringify({ summary: 'S', steps: [step({ format: 'text' })], watchOut: [] }))
    w.t.engine.on('channels.plan.repair', JSON.stringify({ summary: '', steps: [step({})], watchOut: [] }))
    await expect(planChannel(w.t.engine, input)).rejects.toMatchObject({ kind: 'invalid_output' })
  })
})
