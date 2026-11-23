import { afterEach, describe, expect, it } from 'vitest'
import type { SendAction } from '../../shared/types'
import type { SendingFlow } from './sending'
import { FIRST_LOOK_AFTER_MS, STANDING_WINDOW_MS, nextLookDelayMs, standingDue, worthTelling } from './standing'
import { closeWorld, makeWorld, type World } from './test-fixture'

const MIN = 60_000
const T0 = Date.parse('2026-11-22T10:00:00.000Z')

function action(overrides: Partial<SendAction> = {}): SendAction {
  return {
    id: 'a1',
    opportunityId: 'o1',
    draftId: 'd1',
    approvalId: 'ap1',
    contentHash: 'h',
    accountId: 'acc',
    destination: 'r/x',
    state: 'confirmed',
    attemptedAt: new Date(T0).toISOString(),
    completedAt: new Date(T0).toISOString(),
    resultUrl: 'https://www.reddit.com/r/x/comments/abc/p/',
    resultExternalId: 't3_abc',
    authorizationBasis: 'user approval',
    knowledgeVersionId: null,
    error: null,
    standing: null,
    standingNote: null,
    standingCheckedAt: null,
    standingNotice: null,
    ...overrides
  }
}

describe('when a confirmed post is looked at again', () => {
  it('waits a few minutes before the first look, never looks at a send that is not confirmed or has no platform id', () => {
    expect(standingDue(action(), T0 + FIRST_LOOK_AFTER_MS - 1)).toBe(false)
    expect(standingDue(action(), T0 + FIRST_LOOK_AFTER_MS)).toBe(true)
    expect(standingDue(action({ state: 'unknown' }), T0 + 10 * MIN)).toBe(false)
    expect(standingDue(action({ resultExternalId: null }), T0 + 10 * MIN)).toBe(false)
    expect(standingDue(action({ completedAt: null }), T0 + 10 * MIN)).toBe(false)
  })

  it('looks every ten minutes in the first hour, hourly for six hours, then every six hours', () => {
    expect(nextLookDelayMs(5 * MIN)).toBe(10 * MIN)
    expect(nextLookDelayMs(59 * MIN)).toBe(10 * MIN)
    expect(nextLookDelayMs(60 * MIN)).toBe(60 * MIN)
    expect(nextLookDelayMs(5 * 60 * MIN)).toBe(60 * MIN)
    expect(nextLookDelayMs(6 * 60 * MIN)).toBe(6 * 60 * MIN)
    expect(nextLookDelayMs(48 * 60 * MIN)).toBe(6 * 60 * MIN)
  })

  it('looks again only when the delay since the last look has passed', () => {
    const looked = new Date(T0 + 3 * MIN).toISOString()
    const a = action({ standing: 'live', standingCheckedAt: looked })
    expect(standingDue(a, T0 + 3 * MIN + 9 * MIN)).toBe(false)
    expect(standingDue(a, T0 + 3 * MIN + 10 * MIN)).toBe(true)
    const late = action({ standing: 'live', standingCheckedAt: new Date(T0 + 10 * 60 * MIN).toISOString() })
    expect(standingDue(late, T0 + 10 * 60 * MIN + 5 * 60 * MIN)).toBe(false)
    expect(standingDue(late, T0 + 10 * 60 * MIN + 6 * 60 * MIN)).toBe(true)
  })

  it('stops looking after three days', () => {
    expect(standingDue(action(), T0 + STANDING_WINDOW_MS)).toBe(true)
    expect(standingDue(action(), T0 + STANDING_WINDOW_MS + 1)).toBe(false)
  })

  it('tells the owner of a removal and of a post that came back, not of a post that is simply up', () => {
    expect(worthTelling(null, 'live')).toBe(false)
    expect(worthTelling('live', 'removed')).toBe(true)
    expect(worthTelling(null, 'removed')).toBe(true)
    expect(worthTelling('removed', 'live')).toBe(true)
    expect(worthTelling('live', 'live')).toBe(false)
  })
})

describe('looking at confirmed posts again', () => {
  let world: World
  afterEach(async () => {
    await closeWorld(world)
  })
  const sending = (): SendingFlow => world.sending as SendingFlow
  const minutes = (n: number): void => world.clock.advance(n * MIN)
  const logs = (): string[] => world.core.log.list(50).map((l) => l.message)

  async function confirmedPost() {
    world = makeWorld()
    const opp = await world.readyReply()
    const action = await sending().send(opp.id)
    expect(action.state).toBe('confirmed')
    return { opp, action }
  }
  const stored = (id: string): SendAction => world.store.standingCandidates('1970-01-01T00:00:00.000Z').find((a) => a.id === id) as SendAction

  it('does not look before the first few minutes have passed', async () => {
    const { action } = await confirmedPost()
    minutes(1)
    expect(await sending().checkStandings()).toEqual([])
    expect(world.connector.standingRequests).toEqual([])
    expect(stored(action.id).standing).toBeNull()
  })

  it('records that the post is up, and tells nobody', async () => {
    const { action } = await confirmedPost()
    world.connector.standings.set(action.resultExternalId as string, { state: 'live', note: 'The post is up on Reddit.' })
    minutes(4)
    expect(await sending().checkStandings()).toEqual([])
    const now = stored(action.id)
    expect(now.standing).toBe('live')
    expect(now.standingNote).toBe('The post is up on Reddit.')
    expect(now.standingCheckedAt).toBe(world.clock.now().toISOString())
  })

  it('reports a removal once, with where, why and the link, and does not report it again at the next look', async () => {
    const { action } = await confirmedPost()
    const id = action.resultExternalId as string
    world.connector.standings.set(id, { state: 'live', note: 'The post is up on Reddit.' })
    minutes(4)
    await sending().checkStandings()

    world.connector.standings.set(id, { state: 'removed', note: "Reddit's own filters removed it." })
    minutes(11)
    const changes = await sending().checkStandings()
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ actionId: action.id, from: 'live', to: 'removed', note: "Reddit's own filters removed it.", url: action.resultUrl })
    expect(stored(action.id).standing).toBe('removed')
    expect(logs().some((m) => m.includes("Reddit's own filters removed it."))).toBe(true)

    minutes(11)
    expect(await sending().checkStandings()).toEqual([])
    expect(stored(action.id).standing).toBe('removed')
  })

  it('reports a post that is removed at the very first look', async () => {
    const { action } = await confirmedPost()
    world.connector.standings.set(action.resultExternalId as string, { state: 'removed', note: 'A moderator removed it.' })
    minutes(4)
    const changes = await sending().checkStandings()
    expect(changes.map((c) => [c.from, c.to])).toEqual([[null, 'removed']])
  })

  it('reports a post that a moderator put back, and shows it as up again', async () => {
    const { action } = await confirmedPost()
    const id = action.resultExternalId as string
    world.connector.standings.set(id, { state: 'removed', note: 'Removed.' })
    minutes(4)
    await sending().checkStandings()
    world.connector.standings.set(id, { state: 'live', note: 'The post is up on Reddit.' })
    minutes(11)
    const changes = await sending().checkStandings()
    expect(changes.map((c) => [c.from, c.to])).toEqual([['removed', 'live']])
    expect(stored(action.id).standing).toBe('live')
  })

  it("keeps the community's own words with a removal, keeps them when a later look cannot read them, and drops them when the post is up again", async () => {
    const { action } = await confirmedPost()
    const id = action.resultExternalId as string
    const notice = { by: 'AutoModerator', text: 'All posts are removed into a queue to await mod approval (allow 24 hours).' }
    world.connector.standings.set(id, { state: 'removed', note: 'A moderator of r/x or its bot took it down.', notice })
    minutes(4)
    await sending().checkStandings()
    expect(stored(action.id).standingNotice).toEqual(notice)

    world.connector.standings.set(id, { state: 'removed', note: 'A moderator of r/x or its bot took it down.' })
    minutes(11)
    await sending().checkStandings()
    expect(stored(action.id).standingNotice).toEqual(notice)

    world.connector.standings.set(id, null)
    minutes(11)
    await sending().checkStandings()
    expect(stored(action.id).standingNotice).toEqual(notice)

    world.connector.standings.set(id, { state: 'live', note: 'The post is up on Reddit.', notice })
    minutes(61)
    await sending().checkStandings()
    expect(stored(action.id)).toMatchObject({ standing: 'live', standingNotice: null })
  })

  it('tells the owner of a removal through the change event so the card and the list redraw', async () => {
    const { action } = await confirmedPost()
    world.connector.standings.set(action.resultExternalId as string, { state: 'removed', note: 'Removed.' })
    const events: string[] = []
    world.core.events.subscribe((e) => {
      if (e.type === 'changed') events.push(...e.scope.split(','))
    })
    minutes(4)
    await sending().checkStandings()
    expect(events).toContain('opportunities')
  })

  it('keeps what it knew when the platform cannot tell, moves only the time of the look, and tries again later', async () => {
    const { action } = await confirmedPost()
    const id = action.resultExternalId as string
    world.connector.standings.set(id, { state: 'live', note: 'The post is up on Reddit.' })
    minutes(4)
    await sending().checkStandings()
    world.connector.standings.set(id, null)
    minutes(11)
    expect(await sending().checkStandings()).toEqual([])
    const now = stored(action.id)
    expect(now.standing).toBe('live')
    expect(now.standingCheckedAt).toBe(world.clock.now().toISOString())
  })

  it('does not call a failed read a removal, writes the failure to the log once, and tries again later', async () => {
    const { action } = await confirmedPost()
    world.connector.standingError = new Error('the account is not signed in')
    minutes(4)
    expect(await sending().checkStandings()).toEqual([])
    minutes(11)
    expect(await sending().checkStandings()).toEqual([])
    expect(stored(action.id).standing).toBeNull()
    expect(logs().filter((m) => m.includes('Could not look at the post again')).length).toBe(1)

    world.connector.standingError = null
    world.connector.standings.set(action.resultExternalId as string, { state: 'removed', note: 'Removed.' })
    minutes(11)
    expect((await sending().checkStandings()).map((c) => c.to)).toEqual(['removed'])
  })

  it('does not look at a platform whose connector cannot read a post, and writes nothing for it', async () => {
    const { action } = await confirmedPost()
    Object.defineProperty(world.connector, 'readStanding', { value: undefined })
    minutes(4)
    expect(await sending().checkStandings()).toEqual([])
    expect(stored(action.id).standing).toBeNull()
    expect(stored(action.id).standingCheckedAt).toBeNull()
  })

  it('stops between posts when it is told to stop', async () => {
    await confirmedPost()
    minutes(4)
    expect(await sending().checkStandings(() => true)).toEqual([])
    expect(world.connector.standingRequests).toEqual([])
  })
})
