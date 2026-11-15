import type {
  ActivityBatch,
  BrowserPage,
  ChannelGuide,
  Connector,
  ConnectorContext,
  LoginState,
  Membership,
  NormalizedTarget,
  PublishedRef,
  PublishOutcome,
  PublishRequest,
  RemoteComment,
  RemoteDiscussion,
  RemoteInboxItem,
  SendTicket
} from '../../core/ports'
import type { Capability, IsoTime, MetricReading } from '../../shared/types'
import { gateProbeScript, type GateProbe } from '../page-scripts'
import { ensureRedditOrigin, RedditApi } from './api'
import { refusalError } from './auth'
import { assessSubreddit } from './assess'
import { membershipOf, toDiscussion, REDDIT_ORIGIN, type RedditPost } from './mapping'
import { collectMetrics } from './metrics'
import { DEFAULT_RUNTIME, findOwnPublication, publishToReddit, type RedditRuntime } from './publish'
import { isRedditAddress, normalizeRedditTarget, parseSubreddit } from './target'

export const REDDIT_CONNECTOR_VERSION = '1'

/** Pause between consecutive thread reads, to stay well below Reddit's request limits. */
const DEFAULT_PACING_MS = 400

/** Posts asked for in one page of `listPosts` (Reddit's own maximum), and the most pages it reads whatever `max` and `since` say: 1000 posts. */
const LIST_PAGE_SIZE = 100
const LIST_MAX_PAGES = 10

export interface RedditConnectorOptions extends Partial<RedditRuntime> {
  /** Pause between thread reads while collecting activity, and between the pages of a post list. */
  pacingMs?: number
}

/**
 * Prepared connector for Reddit. Reading uses the site's JSON endpoints from inside the account's logged-in
 * page; writing drives the real forms. All network access goes through the controlled browser session.
 */
export class RedditConnector implements Connector {
  readonly id = 'reddit'
  readonly platform = 'reddit'
  readonly version = REDDIT_CONNECTOR_VERSION
  readonly label = 'Reddit'

  private readonly runtime: RedditRuntime
  private readonly pacingMs: number

  constructor(options: RedditConnectorOptions = {}) {
    const { pacingMs, ...runtime } = options
    this.runtime = { ...DEFAULT_RUNTIME, ...runtime }
    this.pacingMs = pacingMs ?? DEFAULT_PACING_MS
  }

  matches(input: string): boolean {
    return isRedditAddress(input)
  }

  normalizeTarget(input: string): NormalizedTarget {
    return normalizeRedditTarget(input)
  }

  loginUrl(): string {
    return `${REDDIT_ORIGIN}/login/`
  }

  signupUrl(): string {
    return `${REDDIT_ORIGIN}/register/`
  }

  /** DEC-028: the page where communities are found, and what to give as the address (the community, not the site). */
  channelGuide(): ChannelGuide {
    return {
      browseUrl: `${REDDIT_ORIGIN}/subreddits/`,
      example: 'r/yourcommunity',
      hint: 'The community, not the whole site: r/astrology or https://www.reddit.com/r/astrology/. Feeds such as r/all or r/popular and user pages (u/…) are not accepted.'
    }
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    return ctx.session.withAgentControl(`login:${ctx.account.id}`, async (page) => {
      await page.goto(`${REDDIT_ORIGIN}/`, { timeoutMs: 30_000 })
      const gate = await page.read<GateProbe>(gateProbeScript())
      if (gate.captcha) return { loggedIn: false, identity: null, captcha: true, signal: gate.signal }
      const identity = await new RedditApi(page).me()
      return { loggedIn: identity !== null, identity, captcha: false }
    })
  }

  assess(ctx: ConnectorContext): Promise<Capability[]> {
    return assessSubreddit(ctx)
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const sub = this.subreddit(ctx)
    return ctx.session.withAgentControl(`monitor:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      const api = new RedditApi(page)
      const listing = await api.listing(sub, options.limit)
      if (!listing.ok) throw await refusalError(page, api, listing, `Could not read the r/${sub} listing: ${listing.reason}`)

      const discussions: RemoteDiscussion[] = []
      for (const post of listing.value.filter((p) => !p.removed).slice(0, options.limit)) {
        // Partial results would make a later cycle look like "new" activity for old comments (REQ-003),
        // so any failure to read a thread fails the whole batch instead of dropping it silently.
        const read = await this.readComments(page, api, sub, post, discussions.length > 0)
        discussions.push(toDiscussion(post, read.comments, read.incomplete))
      }
      return { discussions, fetchedAt: ctx.clock.now().toISOString() }
    })
  }

  /**
   * DEC-040: the posts of the community written since `since`, newest first, at most `max` (and never more than LIST_MAX_PAGES pages of
   * LIST_PAGE_SIZE), each WITHOUT its comments. Read-only, through the account's signed-in page; no thread is ever opened.
   *
   * Not probed against live Reddit: that `/new.json` pages with `after=<fullname of the last post>` as written here, that the listing is strictly
   * newest first, and how Reddit rates a month of such reads are all unproven until the owner runs it on a real account.
   *
   * It stops at the first of: a post older than `since` (compared by `created_utc`; a post with no time is never older and is kept; the listing is
   * taken as newest first, so one out-of-order post ends the read there and the posts after it are not read), `max` posts collected, no next page,
   * the page ceiling. Removed posts are left out, as `fetchActivity` leaves them out.
   *
   * All or nothing: a page that cannot be read fails the whole call (through `refusalError`, so a signed-out account or a human check is told
   * apart), also after earlier pages were read. The result cannot say that it is partial, and the posts a partial list leaves out are the OLDEST of
   * the window: a caller that took it for the whole window would move its "last look" past them and they would never be judged. This is the same
   * rule as `fetchActivity` (a partial read is never passed on as a whole one); the cost of a failed read is a repeat of at most 10 cheap requests.
   */
  async listPosts(ctx: ConnectorContext, options: { since: IsoTime; max: number }): Promise<RemoteDiscussion[]> {
    const sub = this.subreddit(ctx)
    if (!(options.max >= 1)) return []
    const sinceMs = Date.parse(options.since)
    return ctx.session.withAgentControl(`triage:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      const api = new RedditApi(page)
      const posts: RemoteDiscussion[] = []
      const seen = new Set<string>()
      let after: string | null = null
      for (let number = 1; number <= LIST_MAX_PAGES; number += 1) {
        if (number > 1 && this.pacingMs > 0) await this.runtime.sleep(this.pacingMs)
        const read = await api.listingPage(sub, LIST_PAGE_SIZE, after)
        if (!read.ok) throw await refusalError(page, api, read, `Could not read page ${number} of the posts of r/${sub}: ${read.reason}`)
        for (const post of read.value.posts) {
          if (post.createdAt !== null && Date.parse(post.createdAt) < sinceMs) return posts
          if (post.removed || seen.has(post.fullname)) continue
          seen.add(post.fullname)
          posts.push(toDiscussion(post, [], false))
          if (posts.length >= options.max) return posts
        }
        // A page with no post cannot lead anywhere: stop, whatever token it carries.
        if (read.value.after === null || read.value.posts.length === 0) break
        after = read.value.after
      }
      return posts
    })
  }

  /** The comments of a post and whether the read is partial (stubs left unexpanded, nesting cut off, a call failed). */
  private async readComments(page: BrowserPage, api: RedditApi, sub: string, post: RedditPost, paced: boolean): Promise<{ comments: RemoteComment[]; incomplete: boolean }> {
    if ((post.numComments ?? 0) === 0) return { comments: [], incomplete: false }
    if (paced && this.pacingMs > 0) await this.runtime.sleep(this.pacingMs)
    const thread = await api.thread(sub, post.fullname)
    if (!thread.ok) throw await refusalError(page, api, thread, `Could not read comments of ${post.fullname}: ${thread.reason}`)
    const { mapped } = thread.value
    const comments = [...mapped.comments]
    let incomplete = mapped.incomplete
    if (mapped.moreIds.length > 0) {
      const more = await api.expandMore(post.fullname, mapped.moreIds, post.permalink)
      const seen = new Set(comments.map((c) => c.externalId))
      for (const comment of more.comments) if (!seen.has(comment.externalId)) comments.push(comment)
      incomplete = incomplete || more.incomplete
    }
    return { comments, incomplete }
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    const sub = this.subreddit(ctx)
    return ctx.session.withAgentControl(`thread:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      const api = new RedditApi(page)
      const thread = await api.thread(sub, discussionExternalId)
      if (!thread.ok) {
        if (thread.status === 404) return null
        throw await refusalError(page, api, thread, `Could not read the thread ${discussionExternalId}: ${thread.reason}`)
      }
      const { post } = thread.value
      if (post.removed) return null
      const read = await this.readComments(page, api, sub, post, false)
      return toDiscussion(post, read.comments, read.incomplete)
    })
  }

  /**
   * Replies to the account and mentions of it that belong to the channel's community (DEC-039). Two read-only listings through the signed-in page: the
   * inbox, then the mentions list (paced, a second call). A refused mentions list does not lose the inbox's items: mentions are listed in the inbox too.
   * Nothing is marked as read and nothing is written.
   */
  async readInbox(ctx: ConnectorContext, options: { limit: number } = { limit: 25 }): Promise<RemoteInboxItem[]> {
    const sub = this.subreddit(ctx).toLowerCase()
    return ctx.session.withAgentControl(`inbox:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      const api = new RedditApi(page)
      const inbox = await api.inbox('inbox', options.limit)
      if (!inbox.ok) throw await refusalError(page, api, inbox, `Could not read the inbox: ${inbox.reason}`)
      if (this.pacingMs > 0) await this.runtime.sleep(this.pacingMs)
      const mentions = await api.inbox('mentions', options.limit)

      const byId = new Map<string, RemoteInboxItem>()
      for (const entry of [...inbox.value, ...(mentions.ok ? mentions.value : [])]) {
        if (entry.subreddit.toLowerCase() !== sub) continue
        const known = byId.get(entry.item.comment.externalId)
        // Seen in both lists: it is a mention (the mentions list is the one that says so).
        if (!known || entry.item.kind === 'mention') byId.set(entry.item.comment.externalId, entry.item)
      }
      return [...byId.values()].slice(0, options.limit)
    })
  }

  async fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]> {
    const sub = this.subreddit(ctx)
    return ctx.session.withAgentControl(`metrics:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      return collectMetrics(new RedditApi(page), sub, ctx.account.identity)
    })
  }

  /** Whether the account has joined the community, read from the community's own page with the account's cookies; nothing is changed (DEC-029). */
  async membership(ctx: ConnectorContext): Promise<Membership> {
    const sub = this.subreddit(ctx)
    return ctx.session.withAgentControl(`membership:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      const api = new RedditApi(page)
      const about = await api.about(sub)
      if (!about.ok) throw await refusalError(page, api, about, `Could not read r/${sub}: ${about.reason}`)
      return membershipOf(about.value)
    })
  }

  publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    return publishToReddit(ctx, ticket, request, this.runtime)
  }

  findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    return findOwnPublication(ctx, request)
  }

  private subreddit(ctx: ConnectorContext): string {
    const sub = parseSubreddit(ctx.channel.target)
    if (!sub) throw new Error(`Channel target is not a subreddit: ${ctx.channel.target}`)
    return sub
  }
}

