// RedditConnector.listPosts (DEC-040): the posts of a community since a time, newest first, without their comments. Everything here runs against a
// scripted page that answers the documented listing shape. Nothing contacts Reddit: that `/new.json` really pages with `after=<fullname>` as written,
// and how Reddit rates a month of such reads, are NOT proven by these tests.

import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import { CaptchaRequiredError, LoginRequiredError } from '../errors'
import type { RedditFakePage } from '../test-helpers'
import { isoAt, meJson, postThing, seedChannel, T0 } from '../test-helpers'
import { RedditConnector } from './connector'

const FIRST = '/r/test/new.json?limit=100&raw_json=1'

interface Run {
  children: unknown[]
  after: string | null
}

const pageOf = ({ children, after }: Run): unknown => ({ kind: 'Listing', data: { after, children } })

/** `count` posts, newest first: ids `<prefix>0`, `<prefix>1`...; the first was written `firstAt` seconds after T0, each next one `gap` seconds earlier. */
function batch(prefix: string, count: number, firstAt: number, gap = 10): unknown[] {
  return Array.from({ length: count }, (_, i) => postThing({ id: `${prefix}${i}`, created: T0 + firstAt - i * gap }))
}

const lastName = (children: unknown[]): string => (children[children.length - 1] as { data: { name: string } }).data.name

/** A run that is followed by another one: its token is the fullname of its last post, as Reddit gives it. */
const run = (children: unknown[], more = true): Run => ({ children, after: more ? lastName(children) : null })

/** Routes consecutive pages: the first at the bare address, each next one at `&after=<token of the page before>`. Returns the addresses in order. */
function routePages(page: RedditFakePage, pages: Run[]): string[] {
  return pages.map((p, i) => {
    const address = i === 0 ? FIRST : `${FIRST}&after=${pages[i - 1].after}`
    page.route(address, pageOf(p))
    return address
  })
}

const listingRequests = (page: RedditFakePage): string[] => page.fetched.filter((p) => p.startsWith('/r/test/new.json'))

function world(pacingMs = 0) {
  const sleeps: { ms: number; requestsBefore: number }[] = []
  let current: RedditFakePage | null = null
  const connector = new RedditConnector({
    pacingMs,
    sleep: async (ms) => {
      sleeps.push({ ms, requestsBefore: current?.fetched.length ?? -1 })
    }
  })
  const t = makeTestCore({ connectors: [connector] })
  const seeded = seedChannel(t)
  current = seeded.page
  seeded.page.route('/api/me.json', meJson('natal_bot'))
  return { connector, sleeps, ...seeded }
}

const SINCE = isoAt(0)
const ids = (posts: { externalId: string }[]): string[] => posts.map((p) => p.externalId)

describe('Reddit listPosts: reading a page', () => {
  it('maps the posts of one page, newest first, with the time they were written', async () => {
    const { connector, ctx, page } = world()
    const children = [
      postThing({ id: 'n1', title: 'Newest', author: 'ann', selftext: 'The body', created: T0 + 300 }),
      postThing({ id: 'n2', title: 'Next', created: T0 + 200 }),
      postThing({ id: 'n3', title: 'Third', created: T0 + 100 })
    ]
    routePages(page, [run(children, false)])
    const posts = await connector.listPosts(ctx, { since: SINCE, max: 50 })
    expect(ids(posts)).toEqual(['t3_n1', 't3_n2', 't3_n3'])
    expect(posts[0]).toMatchObject({ title: 'Newest', author: 'ann', body: 'The body', url: 'https://www.reddit.com/r/test/comments/n1/post/', postedAt: isoAt(300) })
    expect(posts.map((p) => p.postedAt)).toEqual([isoAt(300), isoAt(200), isoAt(100)])
    expect(listingRequests(page)).toEqual([FIRST])
  })

  it('returns nothing for a community with no posts, after one request', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run([], false)])
    expect(await connector.listPosts(ctx, { since: SINCE, max: 50 })).toEqual([])
    expect(listingRequests(page)).toEqual([FIRST])
  })

  it('never opens a thread: comments are empty, whatever the post says about them, and the list is not marked partial', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run([postThing({ id: 'busy', numComments: 40, created: T0 + 100 }), postThing({ id: 'quiet', numComments: 0, created: T0 + 50 })], false)])
    const posts = await connector.listPosts(ctx, { since: SINCE, max: 50 })
    expect(posts).toHaveLength(2)
    for (const post of posts) {
      expect(post.comments).toEqual([])
      expect(post).not.toHaveProperty('incomplete')
    }
    expect(page.fetched.some((p) => p.includes('/comments/') || p.includes('morechildren'))).toBe(false)
  })

  it('reads from a reddit.com document: it loads the community page first when the browser is elsewhere, and leaves a Reddit page where it is', async () => {
    const away = world()
    routePages(away.page, [run(batch('a', 2, 100), false)])
    await away.connector.listPosts(away.ctx, { since: SINCE, max: 50 })
    expect(away.page.log.filter((l) => l.startsWith('goto '))).toEqual([`goto ${away.channel.url}`])

    const there = world()
    there.page.currentUrl = 'https://www.reddit.com/r/other/'
    routePages(there.page, [run(batch('a', 2, 100), false)])
    await there.connector.listPosts(there.ctx, { since: SINCE, max: 50 })
    expect(there.page.log.filter((l) => l.startsWith('goto '))).toEqual([])
  })

  it('reads through the AI browser under its own name, and refuses while the owner holds the browser', async () => {
    const { connector, ctx, page, channel } = world()
    routePages(page, [run(batch('a', 2, 100), false)])
    const owners: (string | null)[] = []
    const read = page.read.bind(page)
    page.read = async (script) => {
      owners.push(ctx.session.control().owner)
      return read(script)
    }
    await connector.listPosts(ctx, { since: SINCE, max: 50 })
    expect(owners.length).toBeGreaterThan(0)
    expect(new Set(owners)).toEqual(new Set([`triage:${channel.id}`]))

    ctx.session.takeControl()
    await expect(connector.listPosts(ctx, { since: SINCE, max: 50 })).rejects.toThrow(/taken control/)
  })
})

describe('Reddit listPosts: paging with `after`', () => {
  it('follows the token of each page to the next, and stops when there is none', async () => {
    const { connector, ctx, page } = world()
    const pages = [run(batch('a', 2, 600)), run(batch('b', 2, 400)), run(batch('c', 2, 200), false)]
    const addresses = routePages(page, pages)
    const posts = await connector.listPosts(ctx, { since: SINCE, max: 50 })
    expect(ids(posts)).toEqual(['t3_a0', 't3_a1', 't3_b0', 't3_b1', 't3_c0', 't3_c1'])
    // The exact addresses: a page asked with the wrong token would be answered by the first page's route and show up here.
    expect(listingRequests(page)).toEqual(addresses)
    expect(addresses).toEqual([FIRST, `${FIRST}&after=t3_a1`, `${FIRST}&after=t3_b1`])
  })

  it('stops at a page that has no post, whatever token it carries', async () => {
    const { connector, ctx, page } = world()
    const first = run(batch('a', 2, 600))
    page.route(FIRST, pageOf(first))
    page.route(`${FIRST}&after=${first.after}`, pageOf({ children: [], after: 't3_never' }))
    const posts = await connector.listPosts(ctx, { since: SINCE, max: 50 })
    expect(ids(posts)).toEqual(['t3_a0', 't3_a1'])
    expect(listingRequests(page)).toHaveLength(2)
  })

  it('lists a post that two pages both show once', async () => {
    const { connector, ctx, page } = world()
    const first = run(batch('a', 2, 600))
    routePages(page, [first, run([postThing({ id: 'a1', created: T0 + 590 }), postThing({ id: 'b0', created: T0 + 400 })], false)])
    expect(ids(await connector.listPosts(ctx, { since: SINCE, max: 50 }))).toEqual(['t3_a0', 't3_a1', 't3_b0'])
  })

  it('asks for a token that is not a fullname by failing, not by ending the list', async () => {
    const { connector, ctx, page } = world()
    page.route(FIRST, pageOf({ children: batch('a', 2, 600), after: '../../me/inbox' }))
    await expect(connector.listPosts(ctx, { since: SINCE, max: 50 })).rejects.toThrow(/Could not read page 1 of the posts of r\/test: unexpected listing format/)
    expect(listingRequests(page)).toEqual([FIRST])
  })
})

describe('Reddit listPosts: where it stops', () => {
  it('stops at the first post older than `since` and reads no further page', async () => {
    const { connector, ctx, page } = world()
    const since = isoAt(150)
    const children = [...batch('n', 2, 300, 50), postThing({ id: 'old', created: T0 + 100 }), postThing({ id: 'older', created: T0 + 50 })]
    routePages(page, [run(children), run(batch('z', 2, 40))])
    expect(ids(await connector.listPosts(ctx, { since, max: 50 }))).toEqual(['t3_n0', 't3_n1'])
    expect(listingRequests(page)).toEqual([FIRST])
  })

  it('keeps a post written exactly at `since` and drops the one a second before it', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run([postThing({ id: 'edge', created: T0 + 150 }), postThing({ id: 'before', created: T0 + 149 })])])
    expect(ids(await connector.listPosts(ctx, { since: isoAt(150), max: 50 }))).toEqual(['t3_edge'])
  })

  it('takes the first older post as the end even when a later one on the page is newer again', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run([postThing({ id: 'a', created: T0 + 300 }), postThing({ id: 'old', created: T0 + 100 }), postThing({ id: 'odd', created: T0 + 400 })])])
    expect(ids(await connector.listPosts(ctx, { since: isoAt(150), max: 50 }))).toEqual(['t3_a'])
  })

  it('reads a second page when the first is all newer than `since`, and stops inside it', async () => {
    const { connector, ctx, page } = world()
    const addresses = routePages(page, [run(batch('a', 2, 600)), run([postThing({ id: 'b0', created: T0 + 400 }), postThing({ id: 'b1', created: T0 + 100 })]), run(batch('c', 2, 90))])
    expect(ids(await connector.listPosts(ctx, { since: isoAt(200), max: 50 }))).toEqual(['t3_a0', 't3_a1', 't3_b0'])
    expect(listingRequests(page)).toEqual(addresses.slice(0, 2))
  })

  it('keeps a post whose time is unknown, and does not take it for the end', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run([postThing({ id: 'a', created: T0 + 300 }), postThing({ id: 'blank', created: 0 }), postThing({ id: 'b', created: T0 + 200 }), postThing({ id: 'old', created: T0 + 10 })])])
    const posts = await connector.listPosts(ctx, { since: isoAt(100), max: 50 })
    expect(ids(posts)).toEqual(['t3_a', 't3_blank', 't3_b'])
    expect(posts[1].postedAt).toBeNull()
  })

  it('stops when `max` posts are collected, inside a page, and reads no further page', async () => {
    const { connector, ctx, page } = world()
    const addresses = routePages(page, [run(batch('a', 3, 600)), run(batch('b', 3, 500)), run(batch('c', 3, 400))])
    expect(ids(await connector.listPosts(ctx, { since: SINCE, max: 4 }))).toEqual(['t3_a0', 't3_a1', 't3_a2', 't3_b0'])
    expect(listingRequests(page)).toEqual(addresses.slice(0, 2))
  })

  it('returns exactly `max` posts when the page holds exactly that many, without asking for another page', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run(batch('a', 3, 600)), run(batch('b', 3, 500))])
    expect(ids(await connector.listPosts(ctx, { since: SINCE, max: 3 }))).toEqual(['t3_a0', 't3_a1', 't3_a2'])
    expect(listingRequests(page)).toEqual([FIRST])
    expect(ids(await connector.listPosts(ctx, { since: SINCE, max: 1 }))).toEqual(['t3_a0'])
  })

  it('reads nothing at all when `max` is below one', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run(batch('a', 3, 600), false)])
    expect(await connector.listPosts(ctx, { since: SINCE, max: 0 })).toEqual([])
    expect(await connector.listPosts(ctx, { since: SINCE, max: -5 })).toEqual([])
    expect(page.fetched).toEqual([])
  })

  it('reads at most ten pages, 1000 posts, whatever `max` is and however far back `since` reaches', async () => {
    const { connector, ctx, page } = world()
    // Twelve pages of 100 posts, all newer than `since`, each with a token for the next: nothing but the ceiling ends this.
    const pages = Array.from({ length: 12 }, (_, i) => run(batch(`p${i}x`, 100, 100_000 - i * 1000, 5)))
    const addresses = routePages(page, pages)
    const posts = await connector.listPosts(ctx, { since: SINCE, max: 5000 })
    expect(posts).toHaveLength(1000)
    expect(new Set(ids(posts)).size).toBe(1000)
    expect(listingRequests(page)).toEqual(addresses.slice(0, 10))
  })
})

describe('Reddit listPosts: removed posts', () => {
  it('leaves removed posts out, and they do not count toward `max`', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [
      run([
        postThing({ id: 'a', created: T0 + 500 }),
        postThing({ id: 'gone', created: T0 + 400, removedByCategory: 'moderator' }),
        postThing({ id: 'blank', created: T0 + 350, selftext: '[removed]' }),
        postThing({ id: 'b', created: T0 + 300 }),
        postThing({ id: 'c', created: T0 + 200 })
      ])
    ])
    expect(ids(await connector.listPosts(ctx, { since: SINCE, max: 2 }))).toEqual(['t3_a', 't3_b'])
    expect(ids(await connector.listPosts(ctx, { since: SINCE, max: 10 }))).toEqual(['t3_a', 't3_b', 't3_c'])
  })

  it('still lets a removed post that is older than `since` end the read: it says how far back the listing has gone', async () => {
    const { connector, ctx, page } = world()
    routePages(page, [run([postThing({ id: 'a', created: T0 + 500 }), postThing({ id: 'gone', created: T0 + 50, removedByCategory: 'moderator' })]), run(batch('z', 2, 40))])
    expect(ids(await connector.listPosts(ctx, { since: isoAt(100), max: 50 }))).toEqual(['t3_a'])
    expect(listingRequests(page)).toEqual([FIRST])
  })
})

describe('Reddit listPosts: pacing', () => {
  it('pauses between page requests, never before the first and never after the last', async () => {
    const { connector, ctx, page, sleeps } = world(400)
    routePages(page, [run(batch('a', 2, 600)), run(batch('b', 2, 400)), run(batch('c', 2, 200), false)])
    await connector.listPosts(ctx, { since: SINCE, max: 50 })
    // Each pause comes right after the requests made so far: one before the second page, two before the third.
    expect(sleeps).toEqual([
      { ms: 400, requestsBefore: 1 },
      { ms: 400, requestsBefore: 2 }
    ])
  })

  it('does not pause for a single page, nor for a read that ends inside the second page', async () => {
    const one = world(400)
    routePages(one.page, [run(batch('a', 2, 600), false)])
    await one.connector.listPosts(one.ctx, { since: SINCE, max: 50 })
    expect(one.sleeps).toEqual([])

    const two = world(400)
    routePages(two.page, [run(batch('a', 2, 600)), run([postThing({ id: 'old', created: T0 + 10 })]), run(batch('c', 2, 5))])
    await two.connector.listPosts(two.ctx, { since: isoAt(100), max: 50 })
    expect(two.sleeps).toEqual([{ ms: 400, requestsBefore: 1 }])
  })

  it('does not pause when pacing is switched off', async () => {
    const { connector, ctx, page, sleeps } = world(0)
    routePages(page, [run(batch('a', 2, 600)), run(batch('b', 2, 400), false)])
    await connector.listPosts(ctx, { since: SINCE, max: 50 })
    expect(sleeps).toEqual([])
  })
})

describe('Reddit listPosts: a page that cannot be read', () => {
  it('fails when the first page is refused, naming the community and the page', async () => {
    const { connector, ctx, page } = world()
    page.route(FIRST, {}, 429)
    await expect(connector.listPosts(ctx, { since: SINCE, max: 50 })).rejects.toThrow('Could not read page 1 of the posts of r/test: rate limited by Reddit')
    expect(listingRequests(page)).toEqual([FIRST])
  })

  it('fails the whole read when a later page fails, instead of passing on a list that looks complete but lacks its oldest posts', async () => {
    const { connector, ctx, page } = world()
    const addresses = routePages(page, [run(batch('a', 2, 600)), run(batch('b', 2, 400)), run(batch('c', 2, 200), false)])
    page.route(addresses[1], {}, 500)
    await expect(connector.listPosts(ctx, { since: SINCE, max: 50 })).rejects.toThrow('Could not read page 2 of the posts of r/test: Reddit server error')
    expect(listingRequests(page)).toEqual(addresses.slice(0, 2))
  })

  it('fails when a page is not a listing', async () => {
    const { connector, ctx, page } = world()
    const first = run(batch('a', 2, 600))
    page.route(FIRST, pageOf(first))
    page.route(`${FIRST}&after=${first.after}`, { error: 'odd' })
    await expect(connector.listPosts(ctx, { since: SINCE, max: 50 })).rejects.toThrow(/page 2 of the posts of r\/test: unexpected listing format/)
  })

  it('tells a signed-out account and a human check apart, also on a later page', async () => {
    const out = world()
    const outPages = [run(batch('a', 2, 600)), run(batch('b', 2, 400), false)]
    const outAddresses = routePages(out.page, outPages)
    out.page.route(outAddresses[1], { reason: 'private', error: 403 }, 403)
    out.page.route('/api/me.json', { message: 'Forbidden', error: 403 }, 403)
    await expect(out.connector.listPosts(out.ctx, { since: SINCE, max: 50 })).rejects.toBeInstanceOf(LoginRequiredError)

    const wall = world()
    const wallAddresses = routePages(wall.page, [run(batch('a', 2, 600)), run(batch('b', 2, 400), false)])
    wall.page.route(wallAddresses[1], {}, 403)
    wall.page.gate = { captcha: true, blocked: false, title: 'Prove your humanity' }
    await expect(wall.connector.listPosts(wall.ctx, { since: SINCE, max: 50 })).rejects.toBeInstanceOf(CaptchaRequiredError)
  })

  it('keeps a plain error for a community the signed-in account may not read', async () => {
    const { connector, ctx, page } = world()
    page.route(FIRST, { reason: 'private', error: 403 }, 403)
    const error = await connector.listPosts(ctx, { since: SINCE, max: 50 }).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(LoginRequiredError)
    expect((error as Error).message).toMatch(/page 1 of the posts of r\/test: access denied \(private\)/)
  })
})
