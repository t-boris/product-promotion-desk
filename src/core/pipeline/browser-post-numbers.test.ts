// Numbers under the owner's posts on a channel worked in the browser (DEC-075): read by the AI on the account's own page, kept by the application.
import { afterEach, describe, expect, it } from 'vitest'
import type { WatchMissionRequest, WatchMissionService, WatchOutcome } from '../browser-agent/watch'
import type { SendingService } from '../services'
import { BROWSER_NUMBERS_GAP_MS, sameWords } from './browser-post-numbers'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))

const HOUR = 3_600_000
const TEXT = 'The moon in the eighth house is not a curse. Here is what it asks of you.'

class ScriptedWatch implements WatchMissionService {
  readonly requests: WatchMissionRequest[] = []
  readiness: { ready: boolean; reason: string | null } = { ready: true, reason: null }
  script: (request: WatchMissionRequest) => WatchOutcome = () => done()
  async watchReady(): Promise<{ ready: boolean; reason: string | null }> {
    return this.readiness
  }
  async watch(request: WatchMissionRequest): Promise<WatchOutcome> {
    this.requests.push(request)
    return this.script(request)
  }
}
const done = (over: Partial<WatchOutcome> = {}): WatchOutcome => ({ ended: 'finished', reported: { status: 'done', reason: 'Read them.' }, humanCheck: null, error: null, said: '', outOfCalls: false, ...over })
const sending = (): SendingService => world.core.services.sending as SendingService

/** A world whose channel's connector cannot read numbers (as on Instagram), with the AI service scripted. */
function browserWorld(): ScriptedWatch {
  world = makeWorld()
  ;(world.connector as unknown as { readPostNumbers?: unknown }).readPostNumbers = undefined
  const ai = new ScriptedWatch()
  world.core.services.watchMissions = ai
  return ai
}

/** A post the owner sent in the browser: the application could not read it back, and the owner said it is there. No id of the platform, no address. */
async function sentInBrowser(text = TEXT): Promise<string> {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: null, text } })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  world.connector.publishScript.push({ kind: 'unknown', visible: false })
  const action = await sending().send(opportunity.id)
  expect(action.state).toBe('unknown')
  await world.core.router.call('opportunities.resolveUnknown', { id: opportunity.id, outcome: 'published' })
  return action.id
}
const numbersOf = (actionId: string) => world.core.db.prepare('SELECT likes, comments, views, result_url AS url FROM send_actions WHERE id = ?').get(actionId)

describe('numbers under posts on a channel worked in the browser', () => {
  it('are read by the AI on the account\'s own page: the brief names the sent posts, the numbers are kept, and the address only when the page shows the sent text', async () => {
    const ai = browserWorld()
    const actionId = await sentInBrowser()
    expect(await world.core.router.call('results.posts', { channelId: world.channel.id })).toMatchObject({ readable: true, byAi: true, posts: [{ actionId, numbers: null, url: null }] })
    // Too fresh: a post has nothing to show in its first minutes.
    expect(await sending().readPostNumbers()).toBe(0)
    expect(ai.requests).toHaveLength(0)

    world.clock.advance(HOUR)
    ai.script = (request) => {
      expect(request.brief).toMatchObject({ mode: 'numbers', maxCalls: 60, places: [{ url: world.channel.url }], ownPosts: [{ n: 1, url: null }] })
      expect(request.brief.ownPosts?.[0]?.text).toContain('The moon in the eighth house')
      const kept = request.numbers!.record([{ post: 1, likes: 48, comments: 5, views: null, url: 'https://fake.test/p/Moon8', body: `${TEXT} #astrology` }])
      expect(kept).toEqual({ stored: 1, refused: [] })
      return done()
    }
    expect(await sending().readPostNumbers()).toBe(1)
    expect(numbersOf(actionId)).toEqual({ likes: 48, comments: 5, views: null, url: 'https://fake.test/p/Moon8' })
    const view = await world.core.router.call('results.posts', { channelId: world.channel.id })
    expect(view.posts[0]).toMatchObject({ url: 'https://fake.test/p/Moon8', numbers: { likes: 48, comments: 5, views: null }, readings: [{ likes: 48, comments: 5 }] })

    // One look per channel in most of a day, however the post's own schedule runs; the next one knows the address.
    world.clock.advance(3 * HOUR)
    expect(await sending().readPostNumbers()).toBe(0)
    expect(ai.requests).toHaveLength(1)
    world.clock.advance(BROWSER_NUMBERS_GAP_MS)
    ai.script = (request) => {
      expect(request.brief.places.map((p) => p.url)).toEqual([world.channel.url, 'https://fake.test/p/Moon8'])
      request.numbers!.record([{ post: 1, likes: 61, comments: 7, views: 900, url: null, body: null }])
      return done()
    }
    expect(await sending().readPostNumbers()).toBe(1)
    expect(numbersOf(actionId)).toMatchObject({ likes: 61, comments: 7, views: 900 })
    expect((await world.core.router.call('results.posts', { channelId: world.channel.id })).posts[0]?.readings).toHaveLength(2)
  })

  it('keeps nothing from a page that shows another text, and says so to the AI', async () => {
    const ai = browserWorld()
    const actionId = await sentInBrowser()
    world.clock.advance(HOUR)
    let answer: { stored: number; refused?: string[] } | null = null
    ai.script = (request) => {
      answer = request.numbers!.record([{ post: 1, likes: 9000, comments: 300, views: null, url: 'https://fake.test/p/Other', body: 'Somebody else wrote this about Mercury.' }])
      return done()
    }
    expect(await sending().readPostNumbers()).toBe(0)
    expect(answer).toMatchObject({ stored: 0, refused: [expect.stringMatching(/shows another text/)] })
    expect(numbersOf(actionId)).toEqual({ likes: null, comments: null, views: null, url: null })
  })

  it('on the owner\'s "Read now" says in words why nothing was read; by itself it waits when the account is not ready', async () => {
    const ai = browserWorld()
    await sentInBrowser()
    world.clock.advance(HOUR)
    ai.readiness = { ready: false, reason: 'The account is not signed in.' }
    expect(await sending().readPostNumbers()).toBe(0)
    expect(ai.requests).toHaveLength(0)
    await expect(world.core.router.call('results.readPosts', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'read_failed', message: 'The account is not signed in.' })
    ai.readiness = { ready: true, reason: null }
    ai.script = () => done({ reported: { status: 'needs_owner', reason: 'The page asks to sign in.' } })
    await expect(world.core.router.call('results.readPosts', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'read_failed', message: expect.stringContaining('The page asks to sign in.') })
    ai.script = (request) => {
      request.numbers!.record([{ post: 1, likes: 3, comments: null, views: null, url: null, body: null }])
      return done()
    }
    expect((await world.core.router.call('results.readPosts', { channelId: world.channel.id })).posts[0]?.numbers).toMatchObject({ likes: 3, comments: null })
  })

  it('leaves a channel whose connector reads the numbers itself to the connector', async () => {
    world = makeWorld()
    const ai = new ScriptedWatch()
    world.core.services.watchMissions = ai
    expect(await world.core.router.call('results.posts', { channelId: world.channel.id })).toMatchObject({ readable: true, byAi: false })
  })

  it('tells the sent text on a page by its first words, whatever the page adds around it', () => {
    expect(sameWords(TEXT, `natalmystic  ${TEXT.toUpperCase()}  … more`)).toBe(true)
    expect(sameWords(TEXT, 'Somebody else wrote this about Mercury.')).toBe(false)
    expect(sameWords('🌙✨', 'anything at all')).toBe(true)
  })
})
