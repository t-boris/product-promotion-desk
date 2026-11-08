import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import { aboutJson, commentThing, listing, moreStub, postThing, routeHealthyReddit, seedChannel, threadJson } from '../test-helpers'
import { RedditConnector } from './connector'

const connector = new RedditConnector({ sleep: async () => undefined, pacingMs: 0 })

function setup() {
  const t = makeTestCore({ connectors: [connector] })
  const seeded = seedChannel(t)
  routeHealthyReddit(seeded.page)
  return { ...t, ...seeded }
}

describe('Reddit login check', () => {
  it('returns the confirmed username when signed in', async () => {
    const { ctx } = setup()
    expect(await connector.checkLogin(ctx)).toEqual({ loggedIn: true, identity: 'natal_bot', captcha: false })
  })

  it('returns logged out without an identity when the session expired', async () => {
    const { ctx, page } = setup()
    page.route('/api/me.json', { message: 'Forbidden', error: 403 }, 403)
    expect(await connector.checkLogin(ctx)).toEqual({ loggedIn: false, identity: null, captcha: false })
  })

  it('detects a CAPTCHA and does not report the account as logged in', async () => {
    const { ctx, page } = setup()
    page.gate = { captcha: true, blocked: false, title: 'Prove your humanity' }
    const state = await connector.checkLogin(ctx)
    expect(state.captcha).toBe(true)
    expect(state.loggedIn).toBe(false)
  })
})

describe('Reddit activity collection', () => {
  it('maps listings and comment trees to discussions, newest first, with parent ids', async () => {
    const { ctx } = setup()
    const batch = await connector.fetchActivity(ctx, { limit: 10 })
    expect(batch.discussions.map((d) => d.externalId)).toEqual(['t3_p1', 't3_p2'])
    const first = batch.discussions[0]
    expect(first).toMatchObject({ title: 'Thread one', author: 'someone', url: 'https://www.reddit.com/r/test/comments/p1/post/' })
    expect(first.comments.map((c) => [c.externalId, c.parentExternalId])).toEqual([
      ['t1_c1', 't3_p1'],
      ['t1_c2', 't1_c1']
    ])
    expect(batch.discussions[1].comments).toEqual([])
    expect(batch.fetchedAt).toBe(ctx.clock.now().toISOString())
  })

  it('does not request the comment tree of threads that have no comments', async () => {
    const { ctx, page } = setup()
    await connector.fetchActivity(ctx, { limit: 10 })
    expect(page.fetched.some((p) => p.includes('/comments/p2.json'))).toBe(false)
  })

  it('skips removed posts', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/new.json', listing([postThing({ id: 'p1', numComments: 2 }), postThing({ id: 'gone', removedByCategory: 'moderator' })]))
    const batch = await connector.fetchActivity(ctx, { limit: 10 })
    expect(batch.discussions.map((d) => d.externalId)).toEqual(['t3_p1'])
  })

  it('expands "load more" stubs and does not duplicate comments', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/comments/p1.json', threadJson({ id: 'p1', numComments: 3 }, [commentThing({ id: 'c1' }), moreStub(['x1', 'c1'])]))
    page.route('/api/morechildren.json', { json: { errors: [], data: { things: [commentThing({ id: 'x1', parent: 't3_p1' }), commentThing({ id: 'c1' })] } } })
    const batch = await connector.fetchActivity(ctx, { limit: 10 })
    expect(batch.discussions[0].comments.map((c) => c.externalId).sort()).toEqual(['t1_c1', 't1_x1'])
  })

  it('fails the whole batch when a thread cannot be read, so a baseline is never built from partial data', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/comments/p1.json', {}, 500)
    await expect(connector.fetchActivity(ctx, { limit: 10 })).rejects.toThrow(/Could not read comments of t3_p1/)
  })

  it('fails with a readable reason when the listing is not accessible', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/new.json', {}, 429)
    await expect(connector.fetchActivity(ctx, { limit: 10 })).rejects.toThrow(/rate limited/)
  })

  it('reads a single thread, returns null for a vanished or removed one', async () => {
    const { ctx, page } = setup()
    expect((await connector.fetchThread(ctx, 't3_p1'))?.comments).toHaveLength(2)
    page.route('/r/test/comments/gone.json', {}, 404)
    expect(await connector.fetchThread(ctx, 't3_gone')).toBeNull()
    page.route('/r/test/comments/rm.json', threadJson({ id: 'rm', removedByCategory: 'moderator' }, []))
    expect(await connector.fetchThread(ctx, 't3_rm')).toBeNull()
  })

  it('refuses to read while the user holds the browser', async () => {
    const { ctx } = setup()
    ctx.session.takeControl()
    await expect(connector.fetchActivity(ctx, { limit: 5 })).rejects.toThrow(/taken control/)
  })
})

describe('Reddit metrics', () => {
  it('returns real values and keeps hidden metrics unavailable instead of zero', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/about.json', aboutJson({ subscribers: null, accounts_active: null }))
    page.route('/user/natal_bot/submitted.json', listing([])) // a genuine zero: nothing posted yet
    const readings = await connector.fetchMetrics(ctx)
    const get = (key: string) => readings.find((r) => r.key === key)
    expect(get('subscribers')).toMatchObject({ value: null, available: false })
    expect(get('active_users')).toMatchObject({ value: null, available: false })
    expect(get('own_posts')).toMatchObject({ value: 0, available: true })
    expect(get('own_post_score')).toMatchObject({ value: 0, available: true })
  })

  it('counts the account activity in this community only', async () => {
    const { ctx, page } = setup()
    page.route(
      '/user/natal_bot/submitted.json',
      listing([postThing({ id: 'a', author: 'natal_bot', score: 7, numComments: 3 }), postThing({ id: 'b', author: 'natal_bot', score: 5, numComments: 1 }), postThing({ id: 'other', subreddit: 'elsewhere', score: 99 })])
    )
    const readings = await connector.fetchMetrics(ctx)
    const get = (key: string) => readings.find((r) => r.key === key)
    expect(get('subscribers')).toMatchObject({ value: 1234, available: true })
    expect(get('own_posts')?.value).toBe(2)
    expect(get('own_post_score')?.value).toBe(12)
    expect(get('own_post_comments')?.value).toBe(4)
  })

  it('reports own-activity metrics as unavailable (not 0) when the history cannot be read', async () => {
    const { ctx, page } = setup()
    page.route('/user/natal_bot/submitted.json', {}, 403)
    page.route('/user/natal_bot/comments.json', {}, 403)
    const readings = await connector.fetchMetrics(ctx)
    for (const key of ['own_posts', 'own_post_score', 'own_post_comments', 'own_comments', 'own_comment_score']) {
      expect(readings.find((r) => r.key === key)).toMatchObject({ value: null, available: false })
    }
  })

  it('treats a score Reddit hides as unavailable instead of under-reporting the sum', async () => {
    const { ctx, page } = setup()
    const hidden = postThing({ id: 'h', author: 'natal_bot' }) as { data: Record<string, unknown> }
    hidden.data.score = null
    page.route('/user/natal_bot/submitted.json', listing([hidden, postThing({ id: 'v', author: 'natal_bot', score: 3 })]))
    const readings = await connector.fetchMetrics(ctx)
    expect(readings.find((r) => r.key === 'own_post_score')).toMatchObject({ value: null, available: false })
  })
})

describe('Reddit connector identity', () => {
  it('recognizes its own addresses and exposes a login page', () => {
    expect(connector.id).toBe('reddit')
    expect(connector.matches('r/astrology')).toBe(true)
    expect(connector.matches('https://example.com')).toBe(false)
    expect(connector.loginUrl()).toMatch(/^https:\/\/www\.reddit\.com\/login/)
  })
})
