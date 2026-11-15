// DEC-042: a channel of a platform the app has no connector for is looked at in the account's browser, on the schedule, and what the AI judges is kept as
// findings. These tests run the real monitor and its watch flow against a scripted AI agent service, and check what a look may change (the cursor, the
// first-look mark, the next check) and what it must never create (an opportunity, a draft, an approval, a send).

import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import type { WatchItem, WatchMissionRequest, WatchMissionService, WatchOutcome } from '../browser-agent/watch'
import { WATCH_RETRY_MIN } from '../browser-agent/watch'
import { FindingStore } from './findings'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** The AI agent service as the flow sees it: what it is asked, and what it answers. */
class ScriptedWatch implements WatchMissionService {
  readonly requests: WatchMissionRequest[] = []
  readiness: { ready: boolean; reason: string | null } = { ready: true, reason: null }
  /** What the AI does during the look; it records through the flow's own recorder, as the toolbox does. */
  script: (request: WatchMissionRequest) => Promise<WatchOutcome> | WatchOutcome = () => done()
  async watchReady(): Promise<{ ready: boolean; reason: string | null }> {
    return this.readiness
  }
  async watch(request: WatchMissionRequest): Promise<WatchOutcome> {
    this.requests.push(request)
    return this.script(request)
  }
}

const done = (over: Partial<WatchOutcome> = {}): WatchOutcome => ({ ended: 'finished', reported: { status: 'done', reason: 'Looked at it all.' }, humanCheck: null, error: null, ...over })
const item = (n: number | string, over: Partial<WatchItem> = {}): WatchItem => ({ url: `https://www.instagram.com/p/P${n}`, title: `Post ${n}`, author: 'someone', label: 'notice', relation: 'Astrology fans talk about birth charts.', ...over })

interface Watched {
  w: World
  ai: ScriptedWatch
  channelId: string
}

/** A world with one Instagram channel the app does not read, and the AI service scripted. */
function watched(over: { settings?: Record<string, unknown>; status?: 'active' | 'setup' | 'paused'; platform?: string; accountStatus?: 'ready' | 'login_required' } = {}): Watched {
  world = makeWorld({ baselineDone: true })
  const ai = new ScriptedWatch()
  world.core.services.watchMissions = ai
  if (over.accountStatus) world.core.db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(over.accountStatus, world.account.id)
  const channel = world.addChannel({ platform: over.platform ?? 'instagram', reads: false, target: '@natalmystic', status: over.status ?? 'active', settings: { checkIntervalMin: 180, queries: ['natal chart', 'birth chart app', 'astrology', 'a fourth one'], topics: ['astrology'], ...over.settings } })
  return { w: world, ai, channelId: channel.id }
}

const check = (x: Watched) => x.w.monitor.runChannel(x.channelId)
const channelOf = (x: Watched) => x.w.refresh(x.w.core.repos.channel(x.channelId))
const rows = (x: Watched) => x.w.core.db.prepare('SELECT external_id, title, stage, label, relation, first_look, opportunity_id FROM findings WHERE channel_id = ? ORDER BY external_id').all(x.channelId) as { external_id: string; title: string; stage: string; label: string; relation: string; first_look: number; opportunity_id: string | null }[]
const count = (x: Watched, table: string): number => (x.w.core.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c
/** What a look may never create: not one of these exists after any of the tests. */
const nothingToAct = (x: Watched): void => {
  for (const table of ['opportunities', 'drafts', 'approvals', 'send_actions', 'comments', 'discussions']) expect(count(x, table), table).toBe(0)
}
const cursor = (x: Watched): string | null => new FindingStore(x.w.core).listedThrough(x.channelId)

describe('a channel the app only watches in the browser: a whole look', () => {
  it('records what the AI judged as findings, moves the cursor to where the look started and plans the next one', async () => {
    const x = watched()
    const startedAt = x.w.clock.now().toISOString()
    x.ai.script = (request) => {
      x.w.clock.advance(7 * MINUTE)
      request.record([item(1, { label: 'notice', relation: 'Worth a reply: Asks how to read a chart.' }), item(2, { label: 'skip', relation: 'About cooking.' }), item(3)])
      return done()
    }

    const outcome = await check(x)

    expect(outcome).toEqual({ status: 'ok', summary: 'Watched in the browser: 2 noted, 1 judged not relevant, 0 already known', newOpportunities: 0 })
    expect(rows(x)).toEqual([
      { external_id: 'https://www.instagram.com/p/P1', title: 'Post 1', stage: 'read', label: 'notice', relation: 'Worth a reply: Asks how to read a chart.', first_look: 1, opportunity_id: null },
      { external_id: 'https://www.instagram.com/p/P2', title: 'Post 2', stage: 'title', label: 'skip', relation: 'About cooking.', first_look: 1, opportunity_id: null },
      { external_id: 'https://www.instagram.com/p/P3', title: 'Post 3', stage: 'read', label: 'notice', relation: 'Astrology fans talk about birth charts.', first_look: 1, opportunity_id: null }
    ])
    const channel = channelOf(x)
    // the cursor is the START of the look: a post written while the AI was looking is looked at again next time
    expect(cursor(x)).toBe(startedAt)
    expect(channel.lookedBackAt).toBe(startedAt)
    expect(channel.lastRunAt).toBe(x.w.clock.now().toISOString())
    expect(channel.lastSuccessAt).toBe(x.w.clock.now().toISOString())
    expect(channel.nextCheckAt).toBe(new Date(x.w.clock.now().getTime() + 180 * MINUTE).toISOString())
    // it stays a channel the app does not read, and nothing is replied to, measured, drafted or sent
    expect(channel).toMatchObject({ reads: false, watchedInBrowser: true, status: 'active', baselineDoneAt: expect.any(String) })
    nothingToAct(x)
  })

  it('tells the AI where to look, how far back, and what the product is for', async () => {
    const x = watched({ settings: { lookBackDays: 14 } })
    x.w.core.db.prepare('UPDATE products SET goals_json = ? WHERE id = ?').run(JSON.stringify([{ id: 'g1', targetAction: 'Try the free chart', successMetrics: ['signups'], notes: '' }]), x.w.product.id)
    const before = x.w.clock.now().getTime()

    await check(x)

    expect(x.ai.requests).toHaveLength(1)
    const request = x.ai.requests[0] as WatchMissionRequest
    expect(request).toMatchObject({ accountId: x.w.account.id, channelId: x.channelId, hosts: ['instagram.com'] })
    expect(request.brief).toMatchObject({
      platform: 'Instagram',
      channelTarget: '@natalmystic',
      accountIdentity: 'brand_account',
      firstLook: true,
      lookBackDays: 14,
      topics: ['astrology'],
      known: [],
      product: { name: 'Natal Mystic' },
      goals: [{ targetAction: 'Try the free chart', successMetrics: ['signups'] }]
    })
    expect(Date.parse(request.brief.since)).toBe(before - 14 * DAY)
    // the channel's own page, then the platform's search for the first three queries only
    expect(request.brief.queries).toEqual(['natal chart', 'birth chart app', 'astrology'])
    expect(request.brief.places.map((place) => place.url)).toEqual([
      'https://fake.test/@natalmystic',
      'https://www.instagram.com/explore/search/keyword/?q=natal%20chart',
      'https://www.instagram.com/explore/search/keyword/?q=birth%20chart%20app',
      'https://www.instagram.com/explore/search/keyword/?q=astrology'
    ])
  })

  it('looks only at what is new the next time, tells the AI what it judged already and marks no second first look', async () => {
    const x = watched()
    x.ai.script = (request) => {
      request.record([item(1), item(2, { label: 'skip' })])
      return done()
    }
    await check(x)
    const firstCursor = cursor(x) as string
    const lookedBack = channelOf(x).lookedBackAt
    x.w.clock.advance(180 * MINUTE)
    x.ai.script = (request) => {
      const saved = request.record([item(2), item(3)])
      expect(saved).toEqual({ stored: 1, known: 1 })
      return done()
    }

    const outcome = await check(x)

    expect(outcome.summary).toBe('Watched in the browser: 1 noted, 0 judged not relevant, 1 already known')
    const second = x.ai.requests[1] as WatchMissionRequest
    expect(second.brief.firstLook).toBe(false)
    // from the last whole look, less an hour of overlap
    expect(Date.parse(second.brief.since)).toBe(Date.parse(firstCursor) - 60 * MINUTE)
    expect(new Set(second.brief.known)).toEqual(new Set(['https://www.instagram.com/p/P1', 'https://www.instagram.com/p/P2']))
    expect(rows(x).map((r) => [r.external_id.slice(-2), r.first_look])).toEqual([['P1', 1], ['P2', 1], ['P3', 0]])
    // the one-time look-back was made once
    expect(channelOf(x).lookedBackAt).toBe(lookedBack)
    expect(cursor(x)).toBe(x.w.clock.now().toISOString())
    nothingToAct(x)
  })

  it('never records the account\'s own posts, whatever the AI says, and counts nothing for them', async () => {
    const x = watched()
    x.ai.script = (request) => {
      request.record([item(1, { author: 'brand_account' }), item(2, { author: 'Brand_Account' }), item(3)])
      return done()
    }

    const outcome = await check(x)

    expect(outcome.summary).toBe('Watched in the browser: 1 noted, 0 judged not relevant, 0 already known')
    expect(rows(x).map((r) => r.external_id.slice(-2))).toEqual(['P3'])
  })

  it('starts from now, without a look, when the owner asked for no look-back', async () => {
    const x = watched({ settings: { lookBackDays: 0 } })

    const outcome = await check(x)

    expect(outcome).toMatchObject({ status: 'ok', newOpportunities: 0 })
    expect(outcome.summary).toMatch(/no look-back/)
    expect(x.ai.requests).toEqual([])
    expect(cursor(x)).toBe(x.w.clock.now().toISOString())
    expect(channelOf(x).lookedBackAt).toBe(x.w.clock.now().toISOString())
  })

  it('does not look further back than the look-back can go, whatever the age of the cursor', async () => {
    const x = watched()
    new FindingStore(x.w.core).setListedThrough(x.channelId, new Date(x.w.clock.now().getTime() - 400 * DAY).toISOString())
    await check(x)
    const request = x.ai.requests[0] as WatchMissionRequest
    expect(Date.parse(request.brief.since)).toBeGreaterThanOrEqual(x.w.clock.now().getTime() - 90 * DAY)
    expect(request.brief.firstLook).toBe(false)
  })

  it('stops saying it is for own posts only once it is looked at: a channel stored before it was watched says so', async () => {
    const x = watched()
    x.w.core.db.prepare("UPDATE channels SET status_detail = 'Your own posts only.' WHERE id = ?").run(x.channelId)
    await check(x)
    expect(channelOf(x)).toMatchObject({ status: 'active', statusDetail: '' })
  })

  it('heals a channel that was in trouble once a look is whole', async () => {
    const x = watched()
    x.w.core.db.prepare("UPDATE channels SET status = 'needs_user', status_detail = 'The AI needs you: sign in' WHERE id = ?").run(x.channelId)
    await check(x)
    expect(channelOf(x)).toMatchObject({ status: 'active', statusDetail: '' })
  })
})

describe('a look that was not whole', () => {
  const unmoved = (x: Watched): void => {
    expect(cursor(x)).toBeNull()
    expect(channelOf(x).lookedBackAt).toBeNull()
    expect(channelOf(x).lastSuccessAt).toBeNull()
  }

  it('is a failure when the AI says it failed: what it recorded stays, the cursor and the first-look mark do not move, and it is tried again soon', async () => {
    const x = watched()
    x.ai.script = (request) => {
      request.record([item(1)])
      return done({ reported: { status: 'failed', reason: 'The page would not load.' } })
    }

    const outcome = await check(x)

    expect(outcome).toEqual({ status: 'failed', summary: 'The AI could not look at the channel: The page would not load.', newOpportunities: 0 })
    expect(rows(x)).toHaveLength(1)
    unmoved(x)
    expect(channelOf(x)).toMatchObject({ status: 'error', statusDetail: 'The AI could not look at the channel: The page would not load.' })
    // the monitor's own retry for any failed read: ten minutes
    expect(channelOf(x).nextCheckAt).toBe(new Date(x.w.clock.now().getTime() + 10 * MINUTE).toISOString())
    nothingToAct(x)
  })

  it.each([
    ['takes more than twenty minutes', done({ ended: 'timeout' }), /did not finish in 20 minutes/],
    ['stops with an error', done({ ended: 'error', reported: null, error: 'claude exited with code 1' }), /claude exited with code 1/],
    ['ends without saying how it went', done({ reported: null }), /without saying how it went/]
  ])('is a failure when the AI %s, even if it said it was done', async (_what, outcome, reason) => {
    const x = watched()
    x.ai.script = (request) => {
      request.record([item(1)])
      return { ...outcome, reported: outcome.reported ?? null }
    }
    const result = await check(x)
    expect(result.status).toBe('failed')
    expect(result.summary).toMatch(reason)
    unmoved(x)
  })

  it('is a failure, not a crash, when the service throws something unexpected', async () => {
    const x = watched()
    x.ai.script = () => {
      throw new Error('the bridge fell over')
    }
    const result = await check(x)
    expect(result).toMatchObject({ status: 'failed', summary: expect.stringContaining('the bridge fell over') })
    unmoved(x)
  })

  it('is no failure at all when the browser was busy: nothing is suspended, nothing counts, the look is tried again in a few minutes', async () => {
    const x = watched()
    x.ai.script = (request) => {
      request.record([item(1)])
      return done({ ended: 'busy', reported: null })
    }
    const before = channelOf(x)

    const outcome = await check(x)

    expect(outcome.status).toBe('skipped')
    expect(outcome.summary).toMatch(/browser was in use/)
    const retry = new Date(x.w.clock.now().getTime() + WATCH_RETRY_MIN * MINUTE).toISOString()
    expect(outcome.retryAt).toBe(retry)
    expect(channelOf(x)).toMatchObject({ status: 'active', statusDetail: before.statusDetail, nextCheckAt: retry, lastSuccessAt: null })
    unmoved(x)
    // what it had recorded before the owner took the browser stands
    expect(rows(x)).toHaveLength(1)
  })

  it('is no failure when the owner stopped the AI: the channel is looked at again at its next regular check', async () => {
    const x = watched()
    x.ai.script = () => done({ ended: 'stopped', reported: null })
    const outcome = await check(x)
    expect(outcome.status).toBe('skipped')
    expect(channelOf(x)).toMatchObject({ status: 'active', nextCheckAt: new Date(x.w.clock.now().getTime() + 180 * MINUTE).toISOString() })
    unmoved(x)
  })

  it('is deferred, not failed, when the AI service says it cannot start (no engine that can be confined, signed out, not installed)', async () => {
    const x = watched()
    x.ai.readiness = { ready: false, reason: 'Fake engine cannot be held to the browser tools alone, so it is not allowed to read pages of strangers for you.' }

    const outcome = await check(x)

    expect(outcome.status).toBe('skipped')
    expect(outcome.summary).toContain('cannot be held to the browser tools alone')
    expect(x.ai.requests).toEqual([])
    expect(channelOf(x)).toMatchObject({ status: 'active', nextCheckAt: new Date(x.w.clock.now().getTime() + WATCH_RETRY_MIN * MINUTE).toISOString() })
    unmoved(x)
    nothingToAct(x)
  })

  it.each(['agent_running', 'not_ready', 'engine_cannot_confine', 'browser_busy'])('is deferred when the service refuses to start with %s after it said it was ready', async (code) => {
    const x = watched()
    x.ai.script = () => {
      throw new ApiError(code as never, 'Another task is working in this account.')
    }
    const outcome = await check(x)
    expect(outcome.status).toBe('skipped')
    expect(channelOf(x).status).toBe('active')
    unmoved(x)
  })

  it('is deferred when this build has no AI browser at all', async () => {
    const x = watched()
    x.w.core.services.watchMissions = undefined
    const outcome = await check(x)
    expect(outcome.status).toBe('skipped')
    expect(outcome.summary).toMatch(/not available in this build/)
    unmoved(x)
  })
})

describe('a look that needs the owner', () => {
  it('suspends the channel with the AI\'s reason when it asks for something only a person can do', async () => {
    const x = watched()
    x.ai.script = (request) => {
      request.record([item(1)])
      return done({ reported: { status: 'needs_owner', reason: 'Instagram asks to confirm it is you.' } })
    }

    const outcome = await check(x)

    expect(outcome.status).toBe('suspended')
    expect(outcome.summary).toBe('The AI needs you: Instagram asks to confirm it is you.')
    expect(channelOf(x)).toMatchObject({ status: 'needs_user', statusDetail: 'The AI needs you: Instagram asks to confirm it is you.' })
    expect(x.w.core.repos.account(x.w.account.id).status).toBe('ready')
    expect(cursor(x)).toBeNull()
    expect(channelOf(x).lookedBackAt).toBeNull()
  })

  it('tells a signed-out account by the site\'s own answer and marks the account, as for a channel it reads', async () => {
    const x = watched()
    x.w.connector.login = { loggedIn: false, identity: null, captcha: false }
    x.ai.script = () => done({ reported: { status: 'needs_owner', reason: 'A sign-in page stopped me.' } })

    const outcome = await check(x)

    expect(outcome.status).toBe('suspended')
    expect(outcome.summary).toMatch(/is signed out/)
    expect(x.w.core.repos.account(x.w.account.id).status).toBe('login_required')
    expect(cursor(x)).toBeNull()
  })

  it('tells a CAPTCHA by what the page showed, and marks the account', async () => {
    const x = watched()
    x.ai.script = () => done({ reported: { status: 'needs_owner', reason: 'A check.' }, humanCheck: 'a CAPTCHA' })

    const outcome = await check(x)

    expect(outcome.status).toBe('suspended')
    expect(outcome.summary).toMatch(/CAPTCHA/)
    expect(x.w.core.repos.account(x.w.account.id).status).toBe('captcha')
    expect(cursor(x)).toBeNull()
  })

  it('suspends a channel whose account is not signed in without starting the AI at all', async () => {
    const x = watched({ accountStatus: 'login_required' })
    const outcome = await check(x)
    expect(outcome.status).toBe('suspended')
    expect(x.ai.requests).toEqual([])
    expect(channelOf(x).status).toBe('needs_user')
  })
})

describe('what is not looked at', () => {
  it('a channel of a platform that is neither read nor watched in the browser stays skipped, and the AI is never asked', async () => {
    const x = watched({ platform: 'web' })
    expect(channelOf(x)).toMatchObject({ reads: false, watchedInBrowser: false })
    const outcome = await check(x)
    expect(outcome).toEqual({ status: 'skipped', summary: 'The app does not read this channel (your own posts only)', newOpportunities: 0 })
    expect(x.ai.requests).toEqual([])
    expect(channelOf(x)).toMatchObject({ lastRunAt: null, nextCheckAt: null })
  })

  it('a paused channel is not looked at', async () => {
    const x = watched({ status: 'paused' })
    expect((await check(x)).status).toBe('skipped')
    expect(x.ai.requests).toEqual([])
  })

  it.each(['instagram', 'facebook', 'threads', 'x', 'linkedin'])('a channel of %s that the app does not read is looked at in the browser', async (platform) => {
    const x = watched({ platform })
    expect(channelOf(x).watchedInBrowser).toBe(true)
    await check(x)
    expect(x.ai.requests).toHaveLength(1)
    expect((x.ai.requests[0] as WatchMissionRequest).hosts.length).toBeGreaterThan(0)
  })

  it('a channel of one of these platforms that the app does read (it has a site profile) is read, not watched in the browser', async () => {
    const x = watched()
    x.w.core.db.prepare('UPDATE channels SET reads = 1 WHERE id = ?').run(x.channelId)
    expect(channelOf(x)).toMatchObject({ reads: true, watchedInBrowser: false })
    await check(x)
    expect(x.ai.requests).toEqual([])
  })
})
