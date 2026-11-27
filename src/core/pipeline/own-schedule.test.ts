// A platform that keeps a post and publishes it at its time by itself (DEC-077): handed over ahead, recorded when it went out, taken back when the
// owner no longer wants it as it was handed over, and never sent twice.
import { afterEach, describe, expect, it } from 'vitest'
import type { Opportunity } from '../../shared/types'
import type { SendingService } from '../services'
import { SendBlockedError } from './gate'
import { GONE_FROM_SCHEDULE_REASON, keptNote } from './own-schedule'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))

const MIN = 60_000
const HOUR = 60 * MIN
const sending = (): SendingService => world.core.services.sending as SendingService
const publishCalls = (): number => world.connector.calls.filter((call) => call === 'publish').length
const keptIds = (): string[] => [...world.connector.kept.keys()]
const rows = (): { opportunity_id: string; external_id: string | null; problem: string | null }[] =>
  world.core.db.prepare('SELECT opportunity_id, external_id, problem FROM platform_schedules').all() as never
const actions = (id: string): { state: string; attempted_at: string; result_url: string | null; draft_id: string; authorization_basis: string }[] =>
  world.core.db.prepare('SELECT state, attempted_at, result_url, draft_id, authorization_basis FROM send_actions WHERE opportunity_id = ?').all(id) as never

/** A world whose platform takes a post between 10 minutes and 30 days ahead. */
function scheduleWorld(): void {
  world = makeWorld()
  world.connector.ownSchedule = { minAheadMs: 10 * MIN, maxAheadMs: 30 * 24 * HOUR }
}

/** A post approved before its planned time. */
async function approvedFor(title: string, minutesAhead: number): Promise<Opportunity> {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: `${title} body` } })
  await world.core.router.call('publications.schedule', { id: opportunity.id, at: new Date(world.clock.now().getTime() + minutesAhead * MIN).toISOString() })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  return world.opportunity(opportunity.id)
}

describe('a post handed to its platform\'s own schedule', () => {
  it('is handed over once, ahead of its time, through the gate: the platform holds it, nothing is published and no send is recorded', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)

    expect(await sending().keepOwnSchedules()).toBe(1)

    const held = [...world.connector.kept.values()]
    expect(held.map((k) => k.request.publishAt)).toEqual([post.scheduledAt])
    expect(held[0]?.request.text).toBe('later body')
    expect(world.connector.published).toHaveLength(0)
    expect(actions(post.id)).toEqual([])
    expect(world.opportunity(post.id).state).toBe('ready')
    expect(world.opportunity(post.id).reason).toBe(keptNote('fake'))

    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(publishCalls()).toBe(1)
  })

  it('is recorded as sent at its own time once the platform published it, and this application sends nothing', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    await sending().keepOwnSchedules()
    const [id] = keptIds()

    world.clock.advance(121 * MIN)
    // The platform has not put it out yet: the due send leaves it alone, and so does the look.
    expect(await sending().sendDuePublications()).toBe(0)
    await sending().keepOwnSchedules()
    expect(world.opportunity(post.id).state).toBe('ready')

    const ref = world.connector.publishKept(id as string, post.scheduledAt as string)
    world.clock.advance(2 * MIN)
    await sending().keepOwnSchedules()

    expect(world.opportunity(post.id).state).toBe('confirmed')
    const [action] = actions(post.id)
    expect(action).toMatchObject({ state: 'confirmed', attempted_at: post.scheduledAt, result_url: ref.url })
    expect(action?.authorization_basis).toMatch(/^user approval .*published by .* at the time it was given$/)
    expect(rows()).toEqual([])
    expect(await sending().sendDuePublications()).toBe(0)
    expect(world.connector.published).toHaveLength(1)
    expect(publishCalls()).toBe(1)
  })

  it('is found on the page when the platform gave the published post another id, instead of being called unpublished', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    await sending().keepOwnSchedules()
    const [id] = keptIds()
    world.clock.advance(121 * MIN)
    const ref = world.connector.publishKept(id as string, world.clock.now().toISOString(), { renumbered: true })

    await sending().keepOwnSchedules()

    expect(world.opportunity(post.id).state).toBe('confirmed')
    expect(actions(post.id)[0]).toMatchObject({ state: 'confirmed', result_url: ref.url })
  })

  it('returns to review, never sent by itself, when the platform has it no more and the page does not show it', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    await sending().keepOwnSchedules()
    world.connector.kept.clear()
    world.clock.advance(121 * MIN)

    await sending().keepOwnSchedules()

    expect(world.opportunity(post.id).reason).toBe(GONE_FROM_SCHEDULE_REASON)
    expect(world.opportunity(post.id).state).not.toBe('ready')
    expect(await sending().sendDuePublications()).toBe(0)
    expect(world.connector.published).toHaveLength(0)
  })

  it('is taken back when the owner edits it, and the new words are handed over after the new approval', async () => {
    scheduleWorld()
    const post = await approvedFor('first', 120)
    await sending().keepOwnSchedules()

    await world.core.router.call('opportunities.saveDraft', { id: post.id, draft: { title: 'second', text: 'second body' } })
    await sending().keepOwnSchedules()
    expect(keptIds()).toEqual([])
    expect(rows()).toEqual([])

    await world.core.router.call('opportunities.approve', { id: post.id })
    expect(await sending().keepOwnSchedules()).toBe(1)
    expect([...world.connector.kept.values()].map((k) => k.request.text)).toEqual(['second body'])
  })

  it('is taken back when the owner moves it to another time, and handed over for the new time', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    await sending().keepOwnSchedules()
    const moved = new Date(world.clock.now().getTime() + 5 * HOUR).toISOString()
    await world.core.router.call('publications.schedule', { id: post.id, at: moved })

    // One look: the post kept for the old time is taken back, then the post is handed over for the new one.
    expect(await sending().keepOwnSchedules()).toBe(1)

    expect(world.connector.calls.filter((call) => call === 'withdrawScheduled')).toHaveLength(1)
    expect([...world.connector.kept.values()].map((k) => k.request.publishAt)).toEqual([moved])
  })

  it('is taken back when the owner deletes it', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    await sending().keepOwnSchedules()

    await world.core.router.call('opportunities.reject', { id: post.id })
    await sending().keepOwnSchedules()

    expect(keptIds()).toEqual([])
    expect(rows()).toEqual([])
    world.clock.advance(3 * HOUR)
    await sending().keepOwnSchedules()
    expect(world.connector.published).toHaveLength(0)
  })

  it('is taken back while automation is paused, not handed over meanwhile, and handed over again after', async () => {
    scheduleWorld()
    await approvedFor('later', 120)
    await sending().keepOwnSchedules()

    world.core.settings.setRaw('automation.paused', true)
    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(keptIds()).toEqual([])

    world.core.settings.setRaw('automation.paused', false)
    expect(await sending().keepOwnSchedules()).toBe(1)
    expect(keptIds()).toHaveLength(1)
  })

  it('is taken back when the owner pauses the channel', async () => {
    scheduleWorld()
    await approvedFor('later', 120)
    await sending().keepOwnSchedules()

    world.core.db.prepare("UPDATE channels SET status = 'paused' WHERE id = ?").run(world.channel.id)
    expect(await sending().keepOwnSchedules()).toBe(0)

    expect(keptIds()).toEqual([])
    expect(rows()).toEqual([])
  })

  it('is taken back first when the owner presses Send before its time: one post goes out, from this application', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    await sending().keepOwnSchedules()

    const action = await sending().send(post.id)

    expect(action.state).toBe('confirmed')
    expect(keptIds()).toEqual([])
    expect(rows()).toEqual([])
    expect(world.connector.published).toHaveLength(1)
    expect(world.connector.published[0]?.request.publishAt).toBeUndefined()
  })

  it('is not sent by this application while the platform cannot take it back: the press is refused in words and nothing goes out', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    await sending().keepOwnSchedules()
    world.connector.withdrawError = new Error('the platform refused')

    const refused = await sending().send(post.id).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(SendBlockedError)
    expect((refused as SendBlockedError).block.code).toBe('kept_by_platform')
    expect((refused as SendBlockedError).block.reasons[0]).toMatch(/could not be taken back.*Nothing was sent/)
    expect(world.connector.published).toHaveLength(0)
    expect(keptIds()).toHaveLength(1)
  })

  it('says on the item that an edited post is still kept when it cannot be taken back, and asks the platform again only after a while', async () => {
    scheduleWorld()
    const post = await approvedFor('first', 120)
    await sending().keepOwnSchedules()
    world.connector.withdrawError = new Error('the platform refused')
    await world.core.router.call('opportunities.saveDraft', { id: post.id, draft: { title: 'second', text: 'second body' } })

    await sending().keepOwnSchedules()
    await sending().keepOwnSchedules()

    expect(world.connector.calls.filter((call) => call === 'withdrawScheduled')).toHaveLength(1)
    expect(world.opportunity(post.id).reason).toMatch(/still keeps an earlier version.*could not be taken back/)
    expect(rows()[0]?.problem).toMatch(/could not be taken back/)

    world.connector.withdrawError = null
    world.clock.advance(6 * MIN)
    await sending().keepOwnSchedules()
    expect(keptIds()).toEqual([])
    expect(rows()).toEqual([])
    expect(world.opportunity(post.id).reason).toBe('')
  })

  it('is recorded as published as it was handed over when the owner\'s change came after the platform had put it out', async () => {
    scheduleWorld()
    const post = await approvedFor('first', 120)
    const handed = world.core.repos.latestDraft(post.id)?.id
    await sending().keepOwnSchedules()
    const [id] = keptIds()
    world.clock.advance(119 * MIN)
    world.connector.publishKept(id as string, world.clock.now().toISOString())
    await world.core.router.call('opportunities.saveDraft', { id: post.id, draft: { title: 'second', text: 'second body' } })

    await sending().keepOwnSchedules()

    expect(world.opportunity(post.id).state).toBe('confirmed')
    expect(actions(post.id).map((a) => a.draft_id)).toEqual([handed])
    expect(world.connector.published.map((p) => p.request.text)).toEqual(['first body'])
    expect(world.opportunity(post.id).reason).toMatch(/had already published this post as it was approved .* what was changed after that was not published/)
  })
})

describe('a hand-over that did not end plainly', () => {
  it('whose answer was lost is kept as "not known": it is not offered again, and the due send leaves the post alone', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    world.connector.publishScript.push({ kind: 'unknown', visible: true })
    world.connector.readScheduledError = new Error('no answer')

    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(rows()).toMatchObject([{ opportunity_id: post.id, external_id: null }])
    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(publishCalls()).toBe(1)

    world.clock.advance(121 * MIN)
    expect(await sending().sendDuePublications()).toBe(0)
    expect(world.connector.published).toHaveLength(0)
  })

  it('whose answer was lost: the next look finds the kept post and takes its id', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    world.connector.publishScript.push({ kind: 'throw', visible: true })
    await sending().keepOwnSchedules()

    world.clock.advance(6 * MIN)
    await sending().keepOwnSchedules()

    expect(rows()).toMatchObject([{ opportunity_id: post.id, external_id: keptIds()[0], problem: null }])
    expect(publishCalls()).toBe(1)
  })

  it('whose answer was lost and the platform took nothing: it is offered again only after ten minutes of the platform showing no such post', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    world.connector.publishScript.push({ kind: 'unknown', visible: false })
    await sending().keepOwnSchedules()

    world.clock.advance(6 * MIN)
    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(rows()).toMatchObject([{ opportunity_id: post.id, external_id: null }])
    expect(publishCalls()).toBe(1)

    world.clock.advance(6 * MIN)
    expect(await sending().keepOwnSchedules()).toBe(1)
    expect(keptIds()).toHaveLength(1)
    expect(rows()).toMatchObject([{ opportunity_id: post.id, external_id: keptIds()[0] }])
    expect(publishCalls()).toBe(2)
  })

  it('that the platform cannot be asked about holds the owner\'s Send, in words', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    world.connector.publishScript.push({ kind: 'unknown', visible: true })
    await sending().keepOwnSchedules()
    world.connector.readScheduledError = new Error('no answer')

    const refused = await sending().send(post.id).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(SendBlockedError)
    expect((refused as SendBlockedError).block.reasons[0]).toMatch(/not known whether .* took this post/)
    expect(world.connector.published).toHaveLength(0)
  })

  it('that the platform refused leaves the post with this application, which sends it at its time', async () => {
    scheduleWorld()
    const post = await approvedFor('later', 120)
    world.connector.publishScript.push({ kind: 'fail', error: 'not taken' })

    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(rows()).toEqual([])
    // Not offered again at once.
    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(publishCalls()).toBe(1)

    world.clock.advance(121 * MIN)
    expect(await sending().sendDuePublications()).toBe(1)
    expect(world.opportunity(post.id).state).toBe('confirmed')
  })
})

describe('what is not handed over', () => {
  it('a post too close to its time, or further than the platform takes: this application sends it at its time', async () => {
    scheduleWorld()
    const soon = await approvedFor('soon', 12)
    world.connector.ownSchedule = { minAheadMs: 10 * MIN, maxAheadMs: HOUR }
    await approvedFor('far', 180)

    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(publishCalls()).toBe(0)

    world.clock.advance(13 * MIN)
    expect(await sending().sendDuePublications()).toBe(1)
    expect(world.opportunity(soon.id).state).toBe('confirmed')
  })

  it('anything on a platform with no schedule of its own', async () => {
    world = makeWorld()
    await approvedFor('later', 120)

    expect(await sending().keepOwnSchedules()).toBe(0)
    expect(publishCalls()).toBe(0)
    expect(rows()).toEqual([])
  })

  it('a second post for the same hour when the account\'s hourly limit is one: the kept post counts as a send at its time', async () => {
    scheduleWorld()
    world.setSettings(world.channel.id, { limits: { perHour: 1, perDay: 6 } })
    await approvedFor('one', 120)
    await approvedFor('two', 130)

    expect(await sending().keepOwnSchedules()).toBe(1)
    expect([...world.connector.kept.values()].map((k) => k.request.title)).toEqual(['one'])
  })
})
