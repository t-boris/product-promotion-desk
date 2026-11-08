import { afterEach, describe, expect, it } from 'vitest'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const count = (sql: string, ...params: unknown[]): number => (world.core.db.prepare(sql).get(...params) as { c: number }).c

describe('registered API surface', () => {
  it('registers exactly the methods this area owns and none that belong to other areas', () => {
    world = makeWorld()
    const mine = [
      'channels.discussions',
      'channels.selectOlder',
      'channels.activate',
      'channels.checkNow',
      'channels.setPaused',
      'opportunities.list',
      'opportunities.get',
      'opportunities.prepareDraft',
      'opportunities.saveDraft',
      'opportunities.approve',
      'opportunities.reject',
      'opportunities.defer',
      'opportunities.send',
      'opportunities.reconcile',
      'publications.suggest',
      'publications.create',
      'publications.schedule'
    ]
    for (const method of mine) expect(world.core.router.has(method), method).toBe(true)
    // Registering any of them again must fail loudly, which is how the router protects each area's ownership.
    expect(() => world.core.router.register({ 'opportunities.send': () => undefined as never })).toThrow(/registered twice/)
  })

  it('exposes the flow services to the rest of the core', () => {
    world = makeWorld()
    expect(world.core.services.pipeline).toBeDefined()
    expect(world.core.services.monitor).toBeDefined()
    expect(world.core.services.drafting).toBeDefined()
    expect(world.core.services.sending).toBeDefined()
  })
})

describe('channels.activate (baseline, REQ-003 criterion 1)', () => {
  it('runs the baseline cycle, records it and marks the channel active without creating opportunities', async () => {
    world = makeWorld({ baselineDone: false })
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'c1' })
    expect(world.channel.status).toBe('setup')

    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })

    expect(channel.status).toBe('active')
    expect(channel.baselineDoneAt).not.toBeNull()
    expect(count('SELECT COUNT(*) c FROM opportunities')).toBe(0)
    expect(count('SELECT COUNT(*) c FROM comments WHERE baseline = 1')).toBe(1)
    const run = world.core.runs.list({ channelId: world.channel.id }).find((r) => r.kind === 'monitor')!
    expect(run.status).toBe('ok')
    expect(run.summary).toMatch(/^Baseline/)
  })

  it('does not activate when the first cycle fails, and says why', async () => {
    world = makeWorld({ baselineDone: false })
    world.connector.fetchActivityError = new Error('layout changed unexpectedly')

    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'activation_failed' })

    expect(world.refresh().status).not.toBe('active')
    expect(world.refresh().baselineDoneAt).toBeNull()
  })

  it('does not activate when the account needs a login', async () => {
    world = makeWorld({ baselineDone: false })
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'activation_failed' })
    expect(world.connector.calls).not.toContain('fetchActivity')
  })

  it('refuses a channel whose comments cannot be read, and a paused channel', async () => {
    world = makeWorld({ baselineDone: false })
    const capabilities = world.channel.capabilities.map((c) => (c.key === 'read_comments' ? { ...c, status: 'restricted' as const, detail: 'private community' } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(JSON.stringify(capabilities), world.channel.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'read_unavailable', message: expect.stringMatching(/private community/) })

    world.core.db.prepare('UPDATE channels SET capabilities_json = ?, status = ? WHERE id = ?').run(JSON.stringify(world.channel.capabilities), 'paused', world.channel.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'channel_paused' })
  })

  it('is idempotent for a channel that already has its baseline: no second baseline cycle', async () => {
    world = makeWorld()
    world.core.db.prepare("UPDATE channels SET status = 'setup' WHERE id = ?").run(world.channel.id)
    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })
    expect(channel.status).toBe('active')
    expect(world.connector.calls).not.toContain('fetchActivity')
  })
})

describe('channels.checkNow', () => {
  it('runs a monitor cycle plus drafting and returns the run record', async () => {
    world = makeWorld({ mode: 'approval' })
    world.engine.on('draft.reply', JSON.stringify({ category: 'product_question', decision: 'reply', reply: 'It builds a natal chart from your birth date, time and place.', rationale: 'claim c1', usedClaimIds: ['c1'] }))
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'c1', body: 'How does it work?' })

    const run = await world.core.router.call('channels.checkNow', { channelId: world.channel.id })

    expect(run.kind).toBe('monitor')
    expect(run.status).toBe('ok')
    expect(run.channelId).toBe(world.channel.id)
    expect(run.summary).toMatch(/1 draft\(s\) prepared/)
    const [opp] = await world.core.router.call('opportunities.list', {})
    expect(opp.opportunity.state).toBe('awaiting_approval')
    expect(opp.draft?.author).toBe('ai')
  })

  it('reports a failed check in the run instead of throwing, and refuses a paused channel', async () => {
    world = makeWorld()
    world.connector.fetchActivityError = new Error('site is down')
    const run = await world.core.router.call('channels.checkNow', { channelId: world.channel.id })
    expect(run.status).not.toBe('ok')
    expect(world.refresh().status).toBe('error')

    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    await expect(world.core.router.call('channels.checkNow', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'channel_paused' })
  })

  it('returns not_found for an unknown channel', async () => {
    world = makeWorld()
    await expect(world.core.router.call('channels.checkNow', { channelId: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('channels.setPaused', () => {
  it('pauses and resumes a channel, and a paused channel is neither read nor written', async () => {
    world = makeWorld()
    const paused = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    expect(paused.status).toBe('paused')
    expect(paused.statusDetail).toBe('Paused by you')
    expect((await world.monitor.runChannel(world.channel.id)).status).toBe('skipped')
    expect(world.connector.calls).not.toContain('fetchActivity')

    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed.status).toBe('active')
    expect(resumed.statusDetail).toBe('')
    expect((await world.monitor.runChannel(world.channel.id)).status).toBe('ok')
  })

  it('resuming a channel that never had its baseline returns it to setup, not to active', async () => {
    world = makeWorld({ baselineDone: false })
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed.status).toBe('setup')
  })
})
