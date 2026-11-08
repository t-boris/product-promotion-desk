// Test-only helpers for connector tests: hand-built Reddit JSON, a scripted page and DB seeding.
// Not imported by production code.

import type { ConnectorContext } from '../core/ports'
import { FakePage, type TestCore } from '../core/testing/fakes'
import { newId } from '../core/db/database'
import type { Channel } from '../shared/types'
import { DEFAULT_CHANNEL_SETTINGS } from '../shared/types'
import type { FetchResult } from './page-scripts'

// ───────────────────────────── Reddit JSON fixtures (documented listing shapes) ─────────────────────────────

export interface PostFixture {
  id: string
  title?: string
  author?: string
  selftext?: string
  created?: number
  numComments?: number
  score?: number
  locked?: boolean
  archived?: boolean
  removedByCategory?: string | null
  subreddit?: string
  isSelf?: boolean
  url?: string
}

const T0 = 1_762_600_000 // 2025-11-08

export function postThing(p: PostFixture): unknown {
  const sub = p.subreddit ?? 'test'
  return {
    kind: 't3',
    data: {
      id: p.id,
      name: `t3_${p.id}`,
      title: p.title ?? `Post ${p.id}`,
      author: p.author ?? 'someone',
      selftext: p.selftext ?? '',
      is_self: p.isSelf ?? true,
      url: p.url ?? `https://www.reddit.com/r/${sub}/comments/${p.id}/post/`,
      permalink: `/r/${sub}/comments/${p.id}/post/`,
      created_utc: p.created ?? T0,
      score: p.score ?? 5,
      upvote_ratio: 0.9,
      num_comments: p.numComments ?? 0,
      locked: p.locked ?? false,
      archived: p.archived ?? false,
      removed_by_category: p.removedByCategory ?? null,
      subreddit: sub
    }
  }
}

export const listing = (children: unknown[]): unknown => ({ kind: 'Listing', data: { after: null, children } })

export interface CommentFixture {
  id: string
  postId?: string
  parent?: string
  author?: string
  body?: string
  created?: number
  replies?: unknown[]
  subreddit?: string
  score?: number
}

export function commentThing(c: CommentFixture): unknown {
  const sub = c.subreddit ?? 'test'
  const postId = c.postId ?? 'p1'
  return {
    kind: 't1',
    data: {
      id: c.id,
      name: `t1_${c.id}`,
      author: c.author ?? 'commenter',
      body: c.body ?? `Comment ${c.id}`,
      parent_id: c.parent ?? `t3_${postId}`,
      link_id: `t3_${postId}`,
      permalink: `/r/${sub}/comments/${postId}/post/${c.id}/`,
      created_utc: c.created ?? T0 + 60,
      score: c.score ?? 1,
      subreddit: sub,
      replies: c.replies ? listing(c.replies) : ''
    }
  }
}

export const moreStub = (ids: string[]): unknown => ({ kind: 'more', data: { count: ids.length, children: ids } })

export function threadJson(post: PostFixture, comments: unknown[]): unknown {
  return [listing([postThing(post)]), listing(comments)]
}

export function aboutJson(over: Record<string, unknown> = {}): unknown {
  return {
    kind: 't5',
    data: { display_name: 'test', subscribers: 1234, accounts_active: 12, subreddit_type: 'public', submission_type: 'any', user_is_banned: false, user_is_contributor: false, over18: false, ...over }
  }
}

export const rulesJson = (rules: { short_name: string; description: string }[]): unknown => ({ rules, site_rules: [] })
export const meJson = (name: string): unknown => ({ kind: 't2', data: { name } })

// ───────────────────────────── Scripted page ─────────────────────────────

type Route = { status: number; json: unknown }

/** A page whose same-origin fetches are answered from a route table (longest matching path prefix wins). */
export class RedditFakePage extends FakePage {
  readonly routes = new Map<string, Route>()
  readonly fetched: string[] = []
  /** Visible form error messages returned by the error probe. */
  formErrors: string[] = []
  /** The reply that appears in the DOM after the save button is clicked. */
  postedReply: { fullname: string; permalink: string } | null = null
  /** URL the page lands on after the post form is submitted. */
  afterSubmitUrl: string | null = null
  gate = { captcha: false, blocked: false, title: 'Reddit' }
  /** Throw this from click() on the submit/save buttons, to simulate a crash after submitting. */
  failOnSubmitClick: Error | null = null
  private submitted = false

  route(prefix: string, json: unknown, status = 200): this {
    this.routes.set(prefix, { status, json })
    return this
  }

  get writes(): string[] {
    return this.log.filter((entry) => /^(fill|click|upload) /.test(entry))
  }

  override async url(): Promise<string> {
    return this.submitted && this.afterSubmitUrl ? this.afterSubmitUrl : this.currentUrl
  }

  override async goto(url: string): Promise<void> {
    this.submitted = false
    await super.goto(url)
  }

  override async click(selector: string): Promise<void> {
    await super.click(selector)
    if (selector.includes('button.save') || selector.includes('button[name="submit"]') || selector.includes('inner-post-submit-button')) {
      if (this.failOnSubmitClick) throw this.failOnSubmitClick
      this.submitted = true
    }
  }

  override async read<T>(script: string): Promise<T> {
    const fetchCall = /fetch\(("(?:[^"\\]|\\.)*")/.exec(script)
    if (fetchCall) {
      const path = JSON.parse(fetchCall[1]) as string
      this.fetched.push(path)
      const key = [...this.routes.keys()].filter((k) => path.startsWith(k)).sort((a, b) => b.length - a.length)[0]
      const route = key ? this.routes.get(key) : undefined
      const result: FetchResult = route ? { status: route.status, json: route.json, text: '' } : { status: 404, json: null, text: 'no route' }
      return result as T
    }
    if (script.includes('recaptcha')) return this.gate as T
    if (script.includes("querySelectorAll('.error")) return this.formErrors as T
    if (script.includes("querySelector('div.thing[data-fullname=")) return (this.submitted ? this.postedReply : null) as T
    return super.read<T>(script)
  }
}

// ───────────────────────────── Seeding ─────────────────────────────

export interface Seeded<P extends FakePage = RedditFakePage> {
  channel: Channel
  ctx: ConnectorContext
  page: P
  accountId: string
  productId: string
}

/** Inserts a product, an account and a channel directly (the channels API is tested separately). */
export function seedChannel<P extends FakePage = RedditFakePage>(
  t: TestCore,
  opts: { target?: string; identity?: string | null; connectorId?: string; url?: string; platform?: string; page?: P } = {}
): Seeded<P> {
  const { core, browser } = t
  const now = core.clock.now().toISOString()
  const productId = newId()
  const accountId = newId()
  const channelId = newId()
  const target = opts.target ?? 'r/test'
  const platform = opts.platform ?? 'reddit'
  core.db.prepare('INSERT INTO products (id, name, analysis_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(productId, 'Natal Mystic', 'idle', now, now)
  core.db
    .prepare('INSERT INTO accounts (id, platform, label, identity, partition, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(accountId, platform, 'Main', opts.identity === undefined ? 'natal_bot' : opts.identity, `persist:ppd-${accountId}`, 'ready', now)
  core.db
    .prepare(
      'INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, mode, settings_json, capabilities_json, status, status_detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(channelId, productId, accountId, platform, opts.connectorId ?? 'reddit', target, opts.url ?? `https://www.reddit.com/${target}/`, 'observe', JSON.stringify(DEFAULT_CHANNEL_SETTINGS), '[]', 'setup', '', now)
  const page = (opts.page ?? new RedditFakePage()) as P
  browser.pages.set(accountId, page)
  const { ctx } = core.connectorContext(channelId)
  return { channel: ctx.channel, ctx, page, accountId, productId }
}

// ───────────────────────────── Common scenarios ─────────────────────────────

/** A healthy, logged-in r/test with two threads, one of which has comments. */
export function routeHealthyReddit(page: RedditFakePage, identity = 'natal_bot'): void {
  page
    .route('/api/me.json', meJson(identity))
    .route(
      '/r/test/new.json',
      listing([postThing({ id: 'p1', title: 'Thread one', numComments: 2, created: T0 + 100 }), postThing({ id: 'p2', title: 'Thread two', created: T0 })])
    )
    .route('/r/test/comments/p1.json', threadJson({ id: 'p1', title: 'Thread one', numComments: 2 }, [commentThing({ id: 'c1', replies: [commentThing({ id: 'c2', parent: 't1_c1' })] })]))
    .route('/r/test/about.json', aboutJson())
    .route('/r/test/about/rules.json', rulesJson([{ short_name: 'Be civil', description: 'No personal attacks.' }]))
    .route('/user/natal_bot/submitted.json', listing([postThing({ id: 'mine1', author: 'natal_bot', score: 7, numComments: 3 })]))
    .route('/user/natal_bot/comments.json', listing([commentThing({ id: 'mc1', author: 'natal_bot', score: 4 })]))
  page.selectors = new Set(['form#newlink', 'div.commentarea form.usertext textarea[name="text"]'])
}
