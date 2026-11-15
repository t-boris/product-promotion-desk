// The account's inbox on Reddit (DEC-039). Everything here follows Reddit's DOCUMENTED listing shapes through fakes: no real Reddit is contacted, so
// what a live account's /message/inbox.json looks like, and how often it may be read, is not proven by these tests.

import { describe, expect, it } from 'vitest'
import type { BrowserPage } from '../../core/ports'
import { makeTestCore } from '../../core/testing/fakes'
import { LoginRequiredError } from '../errors'
import { listing, routeHealthyReddit, seedChannel } from '../test-helpers'
import { RedditApi } from './api'
import { assessSubreddit } from './assess'
import { RedditConnector } from './connector'
import { mapInbox } from './mapping'

const T = 1_762_700_000

interface InboxFixture {
  id: string
  author?: string
  body?: string
  /** comment_reply | post_reply | username_mention */
  type?: string
  subreddit?: string
  postId?: string
  title?: string
  parent?: string
  context?: string | null
  linkId?: string | null
  created?: number
}

/** A t1 child of /message/inbox.json as Reddit documents it. */
function inboxThing(o: InboxFixture): unknown {
  const subreddit = o.subreddit ?? 'test'
  const postId = o.postId ?? 'p1'
  return {
    kind: 't1',
    data: {
      name: `t1_${o.id}`,
      id: o.id,
      author: o.author ?? 'curious_user',
      body: o.body ?? 'Thanks! How does it handle birth times?',
      type: o.type ?? 'comment_reply',
      subreddit,
      parent_id: o.parent ?? 't1_mine',
      ...(o.linkId === null ? {} : { link_id: o.linkId ?? `t3_${postId}` }),
      link_title: o.title ?? 'Thread one',
      context: o.context === null ? undefined : (o.context ?? `/r/${subreddit}/comments/${postId}/thread_one/${o.id}/?context=3`),
      created_utc: o.created ?? T,
      new: true
    }
  }
}

const privateMessage = { kind: 't4', data: { name: 't4_pm1', author: 'someone', subject: 'hello', body: 'a private message' } }

describe('mapInbox', () => {
  it('maps a reply to the account with where it lives', () => {
    const entries = mapInbox(listing([inboxThing({ id: 'r1', parent: 't1_c1' })]), false)!
    expect(entries).toHaveLength(1)
    expect(entries[0].subreddit).toBe('test')
    expect(entries[0].item).toEqual({
      kind: 'reply_to_me',
      discussionExternalId: 't3_p1',
      discussionUrl: 'https://www.reddit.com/r/test/comments/p1/thread_one/',
      discussionTitle: 'Thread one',
      comment: {
        externalId: 't1_r1',
        parentExternalId: 't1_c1',
        author: 'curious_user',
        body: 'Thanks! How does it handle birth times?',
        url: 'https://www.reddit.com/r/test/comments/p1/thread_one/r1/',
        postedAt: new Date(T * 1000).toISOString()
      }
    })
  })

  it('tells a mention from a reply by its type, and everything read from the mentions list is a mention', () => {
    const list = listing([inboxThing({ id: 'm1', type: 'username_mention' }), inboxThing({ id: 'r1', type: 'post_reply' })])
    expect(mapInbox(list, false)!.map((e) => [e.item.comment.externalId, e.item.kind])).toEqual([
      ['t1_m1', 'mention'],
      ['t1_r1', 'reply_to_me']
    ])
    expect(mapInbox(listing([inboxThing({ id: 'r2', type: 'comment_reply' })]), true)![0].item.kind).toBe('mention')
  })

  it('leaves out private messages, deleted authors, deleted or removed or empty bodies and non-comments', () => {
    const list = listing([
      privateMessage,
      inboxThing({ id: 'gone1', author: '[deleted]' }),
      inboxThing({ id: 'gone2', body: '[deleted]' }),
      inboxThing({ id: 'gone3', body: '[removed]' }),
      inboxThing({ id: 'blank', body: '   ' }),
      { kind: 't3', data: { name: 't3_x' } },
      'garbage',
      null,
      inboxThing({ id: 'ok' })
    ])
    expect(mapInbox(list, false)!.map((e) => e.item.comment.externalId)).toEqual(['t1_ok'])
  })

  it('takes only comments: a message is left out whatever fields it carries', () => {
    const asMessage = { ...(inboxThing({ id: 'pm2' }) as { data: object }), kind: 't4' }
    expect(mapInbox(listing([asMessage]), false)).toEqual([])
  })

  it('makes up the post and the community from the context path when the item does not name them', () => {
    const entries = mapInbox(listing([inboxThing({ id: 'r1', linkId: null, subreddit: '', context: '/r/Other/comments/zz9/a_slug/r1/?context=3' })]), false)!
    expect(entries[0].subreddit).toBe('Other')
    expect(entries[0].item.discussionExternalId).toBe('t3_zz9')
    expect(entries[0].item.discussionUrl).toBe('https://www.reddit.com/r/Other/comments/zz9/a_slug/')
    expect(entries[0].item.comment.url).toBe('https://www.reddit.com/r/Other/comments/zz9/a_slug/r1/')
    // A context without a slug still places the post.
    const bare = mapInbox(listing([inboxThing({ id: 'r2', linkId: null, subreddit: '', context: '/r/Other/comments/zz9/' })]), false)!
    expect(bare[0].item.discussionUrl).toBe('https://www.reddit.com/r/Other/comments/zz9/')
  })

  it('skips an item that cannot be placed in a post', () => {
    expect(mapInbox(listing([inboxThing({ id: 'r1', linkId: null, context: null })]), false)).toEqual([])
    expect(mapInbox(listing([inboxThing({ id: 'r1', linkId: 'not-a-post' })]), false)).toEqual([])
  })

  it('lists a comment once, however often the listing repeats it', () => {
    expect(mapInbox(listing([inboxThing({ id: 'r1' }), inboxThing({ id: 'r1' })]), false)).toHaveLength(1)
  })

  it('answers null for something that is not a listing', () => {
    expect(mapInbox({ error: 403 }, false)).toBeNull()
    expect(mapInbox(null, false)).toBeNull()
  })
})

describe('RedditApi.inbox', () => {
  it('asks for a bounded read-only listing that marks nothing as read', async () => {
    const t = makeTestCore({ connectors: [new RedditConnector()] })
    const { page } = seedChannel(t)
    page.route('/message/inbox.json', listing([inboxThing({ id: 'r1' })]))
    const api = new RedditApi(page as unknown as BrowserPage)

    expect((await api.inbox('inbox', 500)).ok).toBe(true)
    expect(page.fetched).toEqual(['/message/inbox.json?limit=100&mark=false&raw_json=1'])
    await api.inbox('mentions', 0)
    expect(page.fetched[1]).toBe('/message/mentions.json?limit=1&mark=false&raw_json=1')
  })

  it('says why Reddit refused, in safe words', async () => {
    const t = makeTestCore({ connectors: [new RedditConnector()] })
    const { page } = seedChannel(t)
    page.route('/message/inbox.json', { message: 'Forbidden', error: 403 }, 403)
    const result = await new RedditApi(page as unknown as BrowserPage).inbox('inbox', 10)
    expect(result).toMatchObject({ ok: false, status: 403 })
    page.route('/message/inbox.json', { not: 'a listing' }, 200)
    expect(await new RedditApi(page as unknown as BrowserPage).inbox('inbox', 10)).toMatchObject({ ok: false, reason: 'unexpected listing format' })
  })
})

function setup(pacingMs = 0, sleeps: number[] = []) {
  const connector = new RedditConnector({ sleep: async (ms: number) => void sleeps.push(ms), pacingMs })
  const t = makeTestCore({ connectors: [connector] })
  const seeded = seedChannel(t)
  routeHealthyReddit(seeded.page)
  return { connector, ...t, ...seeded }
}

describe('RedditConnector.readInbox', () => {
  it('reads the inbox and the mentions list, keeps the channel\'s community, and names each item for what it is', async () => {
    const { connector, ctx, page } = setup()
    page.route('/message/inbox.json', listing([inboxThing({ id: 'r1' }), inboxThing({ id: 'elsewhere', subreddit: 'other', postId: 'x1' }), inboxThing({ id: 'r2', type: 'post_reply', subreddit: 'TEST', postId: 'p2' })]))
    page.route('/message/mentions.json', listing([inboxThing({ id: 'm1', type: 'username_mention' })]))

    const items = await connector.readInbox(ctx, { limit: 25 })

    expect(items.map((i) => [i.comment.externalId, i.kind, i.discussionExternalId])).toEqual([
      ['t1_r1', 'reply_to_me', 't3_p1'],
      ['t1_r2', 'reply_to_me', 't3_p2'],
      ['t1_m1', 'mention', 't3_p1']
    ])
  })

  it('lists a comment once, as a mention when the mentions list says so', async () => {
    const { connector, ctx, page } = setup()
    page.route('/message/inbox.json', listing([inboxThing({ id: 'both', type: 'comment_reply' })]))
    page.route('/message/mentions.json', listing([inboxThing({ id: 'both', type: 'comment_reply' })]))
    const items = await connector.readInbox(ctx, { limit: 25 })
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('mention')
  })

  it('keeps the inbox\'s items when the mentions list is refused', async () => {
    const { connector, ctx, page } = setup()
    page.route('/message/inbox.json', listing([inboxThing({ id: 'r1' })]))
    page.route('/message/mentions.json', { message: 'Forbidden' }, 403)
    expect((await connector.readInbox(ctx, { limit: 25 })).map((i) => i.comment.externalId)).toEqual(['t1_r1'])
  })

  it('takes no more than it was asked for', async () => {
    const { connector, ctx, page } = setup()
    page.route('/message/inbox.json', listing(['a', 'b', 'c', 'd'].map((id) => inboxThing({ id }))))
    page.route('/message/mentions.json', listing([]))
    expect(await connector.readInbox(ctx, { limit: 2 })).toHaveLength(2)
  })

  it('reads and writes nothing else: two listings, no form, no click, no reply, nothing marked as read', async () => {
    const { connector, ctx, page } = setup()
    page.route('/message/inbox.json', listing([inboxThing({ id: 'r1' })]))
    page.route('/message/mentions.json', listing([]))
    await connector.readInbox(ctx, { limit: 25 })
    expect(page.fetched.every((p) => p.startsWith('/message/') && p.includes('mark=false'))).toBe(true)
    expect(page.fetched).toHaveLength(2)
    expect(page.writes).toEqual([])
  })

  it('pauses between its two requests, as the other reads do', async () => {
    const sleeps: number[] = []
    const { connector, ctx, page } = setup(400, sleeps)
    page.route('/message/inbox.json', listing([]))
    page.route('/message/mentions.json', listing([]))
    await connector.readInbox(ctx, { limit: 25 })
    expect(sleeps).toEqual([400])
  })

  it('fails with Reddit\'s own words when the inbox is refused, and with a sign-in error when the account is signed out', async () => {
    const { connector, ctx, page } = setup()
    page.route('/message/inbox.json', { message: 'Server Error' }, 500)
    await expect(connector.readInbox(ctx, { limit: 25 })).rejects.toThrow(/Could not read the inbox: Reddit server error/)

    page.route('/message/inbox.json', { message: 'Forbidden', error: 403 }, 403)
    page.route('/api/me.json', {}, 200)
    await expect(connector.readInbox(ctx, { limit: 25 })).rejects.toBeInstanceOf(LoginRequiredError)
  })

  it('is optional on the contract and present on this connector', () => {
    const { connector } = setup()
    expect(typeof connector.readInbox).toBe('function')
  })
})

describe('the read_inbox row of a Reddit assessment', () => {
  const row = async (configure: (page: ReturnType<typeof setup>['page']) => void) => {
    const { ctx, page } = setup()
    configure(page)
    return (await assessSubreddit(ctx)).find((c) => c.key === 'read_inbox')!
  }

  it('is verified when the inbox can be read', async () => {
    expect(await row((page) => page.route('/message/inbox.json', listing([])))).toMatchObject({ status: 'verified' })
  })

  it('is unavailable when Reddit refuses or hides the inbox, with the reason', async () => {
    const forbidden = await row((page) => page.route('/message/inbox.json', { message: 'Forbidden' }, 403))
    expect(forbidden.status).toBe('unavailable')
    expect(forbidden.detail).toMatch(/access denied/)
    expect(forbidden.detail).toMatch(/replies to it and mentions of it are not collected/)
    expect((await row((page) => page.route('/message/inbox.json', {}, 404))).status).toBe('unavailable')
  })

  it('only needs a check when Reddit failed for another reason, and never touches the other rows', async () => {
    const { ctx, page } = setup()
    page.route('/message/inbox.json', { message: 'Server Error' }, 500)
    const caps = await assessSubreddit(ctx)
    expect(caps.find((c) => c.key === 'read_inbox')?.status).toBe('needs_check')
    expect(caps.find((c) => c.key === 'read_posts')?.status).toBe('verified')
  })

  it('does not write: reading the inbox in an assessment marks nothing as read', async () => {
    const { ctx, page } = setup()
    page.route('/message/inbox.json', listing([]))
    await assessSubreddit(ctx)
    expect(page.fetched.filter((p) => p.startsWith('/message/'))).toEqual(['/message/inbox.json?limit=1&mark=false&raw_json=1'])
    expect(page.writes).toEqual([])
  })
})
