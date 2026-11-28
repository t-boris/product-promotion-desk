import type { Capability, CapabilityKey, CapabilityStatus, Channel, MetricReading } from '../../shared/types'
import { isVideoMime } from '../../shared/types'
import type { PostNumbers } from '../../shared/post-numbers'
import { HttpNoAnswerError } from '../../core/net/http'
import type {
  ActivityBatch,
  ApiAccess,
  ChannelGuide,
  Connector,
  ConnectorContext,
  HttpFile,
  LoginState,
  NormalizedTarget,
  PublishedRef,
  PublishOutcome,
  PublishRequest,
  RemoteComment,
  RemoteDiscussion,
  ScheduledReading,
  SendTicket
} from '../../core/ports'
import { earliestCreation } from '../reconcile'
import { sameText, wordsWithLink } from '../text'
import { GraphApi, looksLikeAccessToken, type GraphAnswer, type GraphComment, type GraphCounts, type GraphFrom, type GraphInsights, type GraphList, type GraphPage, type GraphPost } from './api'

export const FACEBOOK_PAGE_CONNECTOR_ID = 'facebook-page'

/** How many posts of the Page one reading looks at, and how many comments of each. */
const FEED_LIMIT = 25
/** "The number of times your content was played or displayed", counted over the post's whole life: what Meta gives in place of impressions. */
const VIEWS_METRIC = 'post_media_view'
/** Facebook takes a post for a time "between 10 minutes and 30 days from the time of the API request"; the far end is kept an hour short of it. */
const OWN_SCHEDULE = { minAheadMs: 10 * 60_000, maxAheadMs: 30 * 24 * 3_600_000 - 3_600_000 }
const COMMENTS_LIMIT = 100
const PAGE_FIELDS = 'id,name,username,link,category'
const POST_FIELDS = 'id,message,created_time,permalink_url,from{id,name}'
const COMMENT_FIELDS = 'id,message,created_time,permalink_url,from{id,name},parent{id}'
/** The Graph's own codes for "the token is not accepted" and for "try again, it is on our side". */
const TOKEN_REFUSED = 190
const ON_THEIR_SIDE = [1, 2]
const WAIT = [4, 17, 32, 613]

const HOST = /^(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook|fb)\.com\//i
/** First words of an address that are Facebook's own sections, never the name of a Page. */
const NOT_A_PAGE = new Set(
  'groups share sharer pages watch events marketplace login login.php r.php photo photo.php photos story.php permalink.php reel reels hashtag search gaming help settings friends messages notifications stories videos business ads privacy policies home.php me'.split(' ')
)

/**
 * The Page an address names: its name ("natalmystic") or its number. Null for anything that is not the address of a Page itself: a group, a
 * share link, a post. A share link is refused because it does not say which Page it is, and the token is checked against the Page.
 */
export function pageOf(input: string): string | null {
  const typed = input.trim()
  if (!HOST.test(typed)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const first = (parts[0] ?? '').toLowerCase()
  const number = (value: string | null | undefined): string | null => (value && /^\d{5,}$/.test(value) ? value : null)
  if (first === 'profile.php') return number(url.searchParams.get('id'))
  // "people/Some-Name/1000…" and "p/Some-Name-1000…": the number at the end is the Page.
  if (first === 'people') return number(parts[2])
  if (first === 'p') return number(/(?:^|-)(\d+)$/.exec(parts[1] ?? '')?.[1])
  if (parts.length !== 1 || NOT_A_PAGE.has(first)) return null
  const numbered = /^[a-z0-9.-]+-(\d{8,})$/.exec(first)
  if (numbered) return numbered[1] as string
  return /^[a-z0-9.]{3,}$/.test(first) ? first : null
}

/** A post's or a comment's id as the application stores it. The Graph tells the two apart by itself. */
export const externalIdOf = (graphId: string): string => `fb:${graphId}`

export function parseExternalId(id: string | null): string | null {
  return /^fb:(\d+(?:_\d+)*)$/.exec(id ?? '')?.[1] ?? null
}

/** Facebook ignores the case and the dots of a Page's name. */
const sameName = (a: string, b: string): boolean => a.toLowerCase().replaceAll('.', '') === b.toLowerCase().replaceAll('.', '')

/** The Graph writes a time as "2026-12-01T10:00:00+0000". */
function iso(time: string | undefined): string | null {
  if (!time) return null
  const ms = Date.parse(time.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

type Refusal = Extract<GraphAnswer<unknown>, { ok: false }>

/** What Facebook refused, in words. */
function refusal(answer: Refusal): string {
  if (answer.code === TOKEN_REFUSED) return 'Facebook does not accept the Page access token: it ended or was withdrawn. Make a new one (the steps on the account\'s page) and save it there.'
  if (WAIT.includes(answer.code)) return `Facebook asks to wait before the next request (${answer.message}).`
  if (answer.code === 10 || (answer.code >= 200 && answer.code <= 299)) return `Facebook says the token has no permission for this (${answer.message}). Add the permission in your app and make the token again.`
  return `Facebook refused it: ${answer.message}`
}

/** A refusal while reading. The name of a refused token makes the monitor read it as a sign-in problem of the account, which it is. */
function unreadable(answer: Refusal): Error {
  const error = new Error(refusal(answer))
  return answer.code === TOKEN_REFUSED ? Object.assign(error, { name: 'LoginRequiredError' }) : error
}

const failed = (error: string): PublishOutcome => ({ status: 'failed', error })

const DEVELOPERS = 'https://developers.facebook.com'

const API: ApiAccess = {
  accountKind: 'Page',
  keyLabel: 'Page access token',
  steps: [
    {
      text: 'This way is for a Facebook Page only: a personal profile and a group have no API. Sign in to Facebook as the person who manages the Page and register as a developer. It is free.',
      url: `${DEVELOPERS}/async/registration`,
      link: 'Open Meta for Developers'
    },
    {
      text: 'Create an app: any name, and as its use case choose “Manage everything on your Page”. When it asks about a business portfolio, choose “I don’t want to connect a business portfolio yet”.',
      url: `${DEVELOPERS}/apps/creation/`,
      link: 'Open “Create an app”'
    },
    {
      text: 'In the app open “Use cases”, press “Customize” beside “Manage everything on your Page” and add five permissions: pages_manage_posts, pages_read_engagement, pages_manage_engagement, pages_read_user_content and read_insights (the last one is for the views of each post).',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    {
      text: 'In the Graph API Explorer choose your app, add the same five permissions and get a token for yourself (“User Token”). Facebook asks which Page to allow: choose yours. Copy the token it shows.',
      url: `${DEVELOPERS}/tools/explorer/`,
      link: 'Open the Graph API Explorer'
    },
    {
      text: 'Make it last: paste that token into the Access Token Debugger, press “Debug”, then “Extend Access Token”, and copy the long token. A token that was not extended stops working within hours.',
      url: `${DEVELOPERS}/tools/debug/accesstoken/`,
      link: 'Open the Access Token Debugger'
    },
    {
      text: 'Back in the Graph API Explorer paste the long token into “Access Token”, type me/accounts as the request and press “Submit”. The answer lists your Pages: copy the access_token of your Page. That one does not end.',
      url: `${DEVELOPERS}/tools/explorer/`,
      link: 'Open the Graph API Explorer'
    },
    {
      text: 'For everybody to see what the app posts, publish the app: “Publish”, then “Go live”. Facebook asks first for an app icon, a privacy policy address and a data deletion address. Until then only you and the other people of the app see those posts.',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    { text: 'Paste the Page access token below. It is kept in the vault of this Mac and is never shown again. Another Page needs a token of its own: each Page is an account of its own.' }
  ],
  keyLooksValid: looksLikeAccessToken
}

/** How long the request that carries a video may take, and how the post Facebook makes of it is then looked for: every few seconds, for three minutes. */
const VIDEO_TIMEOUT_MS = 30 * 60_000
const VIDEO_LOOK_MS = 5_000
const VIDEO_LOOKS = 36

/**
 * A Facebook Page worked through Meta's Graph API with the Page's own access token (DEC-076): posts with words, a link or photos; the comments
 * under the Page's posts, read from Facebook each time; replies under a comment or a post; reactions and comments counted under a post; a post
 * with a time far enough ahead is given to Facebook's own schedule (DEC-077); one video with the post's words (DEC-088). Nothing is kept here:
 * Facebook holds the posts and gives them again.
 */
export class FacebookPageConnector implements Connector {
  readonly id = FACEBOOK_PAGE_CONNECTOR_ID
  readonly platform = 'facebook'
  readonly version = '1'
  readonly label = 'Facebook'
  readonly api = API
  readonly postNumberKinds = ['likes', 'comments', 'views'] as const
  /**
   * A post with a video is not given to Facebook's schedule: Facebook answers a video with the video's number, and no page of its documentation
   * says that the post it will make shows among the posts it keeps, so the application could not tell a kept video from one it never took.
   */
  readonly ownSchedule = { ...OWN_SCHEDULE, takes: (request: PublishRequest): boolean => !request.attachments.some((file) => isVideoMime(file.mime)) }

  /** The Page each account's token belongs to, as Facebook named it at the last check. */
  private readonly pages = new Map<string, GraphPage>()

  matches(input: string): boolean {
    return pageOf(input) !== null
  }

  normalizeTarget(input: string): NormalizedTarget {
    const page = pageOf(input)
    if (!page) throw new Error('Give the address of the Page itself, like https://www.facebook.com/yourpage: open the Page and copy its address. A share link, a group or a post is not one.')
    return { target: `facebook.com/${page}`, url: /^\d+$/.test(page) ? `https://www.facebook.com/profile.php?id=${page}` : `https://www.facebook.com/${page}` }
  }

  loginUrl(): string {
    return `${DEVELOPERS}/tools/explorer/`
  }

  channelGuide(): ChannelGuide {
    return { browseUrl: 'https://www.facebook.com/pages/', example: 'https://www.facebook.com/yourpage', hint: 'The address of the Page whose access token this account holds.' }
  }

  readsChannel(_channel: Channel): boolean {
    return true
  }

  private async client(ctx: ConnectorContext): Promise<GraphApi | null> {
    const token = await ctx.apiKey()
    return token ? new GraphApi(ctx.http, token) : null
  }

  private async requireClient(ctx: ConnectorContext): Promise<GraphApi> {
    const api = await this.client(ctx)
    if (!api) throw Object.assign(new Error('No Page access token is saved for this account. Save it on the account\'s page.'), { name: 'LoginRequiredError' })
    return api
  }

  /** Whose token it is: asked from Facebook, and remembered until the next sign-in check. */
  private async page(ctx: ConnectorContext, api: GraphApi): Promise<GraphPage> {
    const kept = this.pages.get(ctx.account.id)
    if (kept) return kept
    const me = await api.get<GraphPage>('me', { fields: PAGE_FIELDS })
    if (!me.ok) throw unreadable(me)
    this.pages.set(ctx.account.id, me.result)
    return me.result
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    this.pages.delete(ctx.account.id)
    const api = await this.client(ctx)
    if (!api) return { loggedIn: false, identity: null, captcha: false, signal: 'no Page access token is saved' }
    const me = await api.get<GraphPage>('me', { fields: PAGE_FIELDS })
    if (!me.ok) {
      // A token of a person has none of a Page's fields, and Facebook says so with its "wrong field" code.
      const signal =
        me.code === TOKEN_REFUSED
          ? 'Facebook does not accept the token (it ended or was withdrawn)'
          : me.code === 100
            ? `this is not the token of a Page (Facebook: ${me.message}). Ask for me/accounts in the Graph API Explorer and copy the access_token of your Page`
            : refusal(me)
      return { loggedIn: false, identity: null, captcha: false, signal }
    }
    this.pages.set(ctx.account.id, me.result)
    return { loggedIn: true, identity: me.result.name ?? me.result.id, captcha: false }
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const all = (status: CapabilityStatus, detail: string): Capability[] =>
      (['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics'] as CapabilityKey[]).map((key) => cap(key, status, detail)).concat(notOffered(cap))
    const api = await this.client(ctx)
    if (!api) return all('needs_user', 'Save the Page access token on the account\'s page first.')
    this.pages.delete(ctx.account.id)
    let page: GraphPage
    try {
      page = await this.page(ctx, api)
    } catch (error) {
      return all('needs_user', error instanceof Error ? error.message : String(error))
    }
    const name = page.name ?? page.id
    // The channel's address says which Page was meant (its short name is the platform's own form of it, "@name").
    const wanted = pageOf(ctx.channel.url) ?? ''
    const same = /^\d+$/.test(wanted) ? wanted === page.id : page.username !== undefined && sameName(wanted, page.username)
    if (!same) {
      const own = page.link ?? (page.username ? `https://www.facebook.com/${page.username}` : `https://www.facebook.com/profile.php?id=${page.id}`)
      return all('needs_user', `The token of this account belongs to the Page “${name}” (${own}), and this channel is ${ctx.channel.url}. Connect the address of that Page, or save the token of this one.`)
    }
    const feed = await api.get<GraphList<GraphPost>>(`${page.id}/feed`, { fields: POST_FIELDS, limit: '1' })
    const newest = feed.ok ? feed.result.data?.[0] : undefined
    const comments = newest ? await api.get<GraphList<GraphComment>>(`${newest.id}/comments`, { fields: COMMENT_FIELDS, filter: 'stream', limit: '1' }) : null
    const reads: [CapabilityStatus, string] = !feed.ok
      ? ['needs_user', refusal(feed)]
      : ['verified', `The posts of the Page “${name}” are read from Facebook.`]
    const talks: [CapabilityStatus, string] = !feed.ok
      ? ['needs_user', refusal(feed)]
      : !comments
        ? ['needs_check', 'The Page has no post yet, so reading comments was not tried.']
        : comments.ok
          ? ['verified', 'Comments under the Page\'s posts are read from Facebook. The name of a commenter needs the permission pages_read_user_content.']
          : ['needs_user', refusal(comments)]
    return [
      cap('read_posts', ...reads),
      cap('read_comments', ...talks),
      cap('detect_changes', ...reads),
      cap('publish_post', 'verified', `Posts go out as the Page “${name}”: words, a link, photos, or one video (Facebook publishes a video once it has processed it, which can take minutes; a post with a video and a time goes out from this application at that time, with this Mac on). A post with a time a quarter of an hour or more ahead is given to Facebook, which publishes it at that time even with this Mac off. It needs the permission pages_manage_posts. Until the app is published (“Go live”), only the people of the app see them.`),
      cap('publish_reply', 'verified', 'A reply goes under the comment or the post, as the Page. It needs the permission pages_manage_engagement.'),
      cap('verify_send', 'verified', 'Facebook returns the post or the comment it made.'),
      cap('metrics', 'verified', 'The number of followers; under each post, reactions, comments and views. Facebook gives views only with the permission read_insights, and only for a Page with 100 or more likes.'),
      ...notOffered(cap)
    ]
  }

  private author(ctx: ConnectorContext, page: GraphPage, from: GraphFrom | undefined): string {
    // What the Page itself wrote is the account's own, whoever of its people typed it: nobody to answer.
    if (from?.id === page.id) return ctx.account.identity ?? page.name ?? page.id
    return from?.name ?? 'Somebody on Facebook'
  }

  private async discussion(ctx: ConnectorContext, api: GraphApi, page: GraphPage, post: GraphPost): Promise<RemoteDiscussion> {
    const url = post.permalink_url ?? `https://www.facebook.com/${post.id}`
    const list = await api.get<GraphList<GraphComment>>(`${post.id}/comments`, { fields: COMMENT_FIELDS, filter: 'stream', order: 'chronological', limit: String(COMMENTS_LIMIT) })
    if (!list.ok) throw unreadable(list)
    const postId = externalIdOf(post.id)
    const comments: RemoteComment[] = (list.result.data ?? []).map((c) => ({
      externalId: externalIdOf(c.id),
      parentExternalId: c.parent?.id ? externalIdOf(c.parent.id) : postId,
      author: this.author(ctx, page, c.from),
      body: c.message ?? '',
      url: c.permalink_url ?? url,
      postedAt: iso(c.created_time)
    }))
    const body = post.message ?? ''
    const firstLine = body.split('\n')[0] ?? ''
    return {
      externalId: postId,
      url,
      title: firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine,
      // A post with no author named is the Page's own: Facebook names the author of a visitor's post.
      author: this.author(ctx, page, post.from ?? { id: page.id }),
      body,
      postedAt: iso(post.created_time),
      comments,
      ...(list.result.paging?.next ? { incomplete: true } : {})
    }
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const api = await this.requireClient(ctx)
    const page = await this.page(ctx, api)
    const feed = await api.get<GraphList<GraphPost>>(`${page.id}/feed`, { fields: POST_FIELDS, limit: String(Math.max(1, Math.min(options.limit, FEED_LIMIT))) })
    if (!feed.ok) throw unreadable(feed)
    const discussions: RemoteDiscussion[] = []
    for (const post of feed.result.data ?? []) discussions.push(await this.discussion(ctx, api, page, post))
    return { discussions, fetchedAt: ctx.clock.now().toISOString() }
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    const api = await this.requireClient(ctx)
    const id = parseExternalId(discussionExternalId)
    if (!id) return null
    const page = await this.page(ctx, api)
    const post = await api.get<GraphPost>(id, { fields: POST_FIELDS })
    if (!post.ok) {
      // "No such object, or you may not see it": the post is gone.
      if (post.code === 100) return null
      throw unreadable(post)
    }
    return this.discussion(ctx, api, page, post.result)
  }

  async fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]> {
    const api = await this.requireClient(ctx)
    const page = await this.page(ctx, api)
    const count = await api.get<{ followers_count?: number }>(page.id, { fields: 'followers_count' })
    const value = count.ok && typeof count.result.followers_count === 'number' ? count.result.followers_count : null
    return [{ key: 'followers', label: 'Followers', value, available: value !== null }]
  }

  async readPostNumbers(ctx: ConnectorContext, posts: { externalId: string; url: string | null }[]): Promise<Record<string, PostNumbers>> {
    const api = await this.requireClient(ctx)
    const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)
    const found: Record<string, PostNumbers> = {}
    // Views come from the Page's insights, which Facebook gives only with the permission read_insights and to a Page with enough followers.
    // Refused once, they are not asked for again in this reading: the other two numbers do not depend on them.
    let viewsGiven = true
    for (const post of posts) {
      const id = parseExternalId(post.externalId)
      if (!id) continue
      const counts = await api.get<GraphCounts>(id, { fields: 'reactions.summary(total_count).limit(0),comments.filter(stream).summary(total_count).limit(0)' })
      if (!counts.ok) {
        if (counts.code === TOKEN_REFUSED) throw unreadable(counts)
        continue
      }
      let views: number | null = null
      if (viewsGiven) {
        const insights = await api.get<GraphInsights>(`${id}/insights`, { metric: VIEWS_METRIC })
        if (insights.ok) views = whole((insights.result.data ?? []).find((entry) => entry.name === VIEWS_METRIC)?.values?.[0]?.value)
        else if (insights.code === TOKEN_REFUSED) throw unreadable(insights)
        else viewsGiven = false
      }
      found[post.externalId] = { likes: whole(counts.result.reactions?.summary?.total_count), comments: whole(counts.result.comments?.summary?.total_count), views }
    }
    return found
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    const api = await this.client(ctx)
    if (!api) return failed('No Page access token is saved for this account. Nothing was sent.')
    const words = wordsWithLink(request)
    try {
      return request.kind === 'reply' ? await this.reply(api, request, words) : await this.post(ctx, api, await this.page(ctx, api), request, words)
    } catch (error) {
      // Only the request that publishes can leave a doubt, and it is asked through `lastStep`: anything that fails here failed before it.
      if (error instanceof HttpNoAnswerError) return failed(`Facebook did not answer (${error.message}) before anything was published. Nothing was sent.`)
      return failed(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * The request that publishes, or that gives the post to Facebook's schedule (`kept`). No answer to it, or an error of Facebook's own side,
   * leaves it unknown whether Facebook made it.
   */
  private async lastStep(api: GraphApi, call: () => Promise<GraphAnswer<{ id?: string; post_id?: string }>>, kept = false): Promise<PublishOutcome> {
    let answer: GraphAnswer<{ id?: string; post_id?: string }>
    try {
      answer = await call()
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `Facebook did not answer (${error.message}), so it is not known whether it was published.` }
      throw error
    }
    if (!answer.ok) {
      if (answer.status >= 500 || ON_THEIR_SIDE.includes(answer.code)) return { status: 'unknown', error: `Facebook answered with an error of its own (${answer.message}), so it is not known whether it was published.` }
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    const id = answer.result.post_id ?? answer.result.id
    if (!id) return { status: 'unknown', error: 'Facebook accepted it and returned no id, so it is not known whether it was published.' }
    if (kept) return { status: 'scheduled', externalId: externalIdOf(id) }
    return { status: 'confirmed', url: await this.addressOf(api, id), externalId: externalIdOf(id) }
  }

  /** The address Facebook gives the post or the comment; its plain address by id when Facebook does not say. */
  private async addressOf(api: GraphApi, id: string): Promise<string> {
    try {
      const made = await api.get<{ permalink_url?: string }>(id, { fields: 'permalink_url' })
      if (made.ok && made.result.permalink_url) return made.result.permalink_url
    } catch {
      // Published all the same: the address by id opens it.
    }
    return `https://www.facebook.com/${id}`
  }

  private async post(ctx: ConnectorContext, api: GraphApi, page: GraphPage, request: PublishRequest, words: string): Promise<PublishOutcome> {
    const files = request.attachments
    const video = files.find((file) => isVideoMime(file.mime))
    if (video && files.length > 1) return failed('A post to a Page through its API holds photos or one video, not both and not two videos. Nothing was sent.')
    if (files.length === 0 && !words) return failed('The post is empty. Nothing was sent.')
    const part = (file: (typeof files)[number]): HttpFile => ({ path: file.path, name: file.name, mime: file.mime })
    // A post for Facebook's own schedule is made unpublished, with its time in seconds; Facebook publishes it then by itself.
    const kept = request.publishAt !== undefined
    const later: Record<string, string> = kept ? { published: 'false', scheduled_publish_time: String(Math.floor(Date.parse(request.publishAt as string) / 1000)) } : {}
    if (video && kept) return failed('A post with a video is not given to Facebook\'s own schedule. Nothing was sent.')
    if (video) return this.video(ctx, api, page, request, { source: part(video), ...(words ? { description: words } : {}) })
    if (files.length === 0) return this.lastStep(api, () => api.post(`${page.id}/feed`, { message: words, ...(request.link ? { link: request.link } : {}), ...later }), kept)
    if (files.length === 1 && !kept) return this.lastStep(api, () => api.post(`${page.id}/photos`, { source: part(files[0] as (typeof files)[number]), ...(words ? { caption: words } : {}) }))
    // Several photos, or any photo of a kept post: each is uploaded unpublished, then one post names them all. A photo that fails leaves nothing published.
    const form: Record<string, string> = { ...(words ? { message: words } : {}), ...later }
    for (const [index, file] of files.entries()) {
      // A photo of a post that goes out later is marked so that Facebook keeps it until then.
      const photo = await api.post<{ id?: string }>(`${page.id}/photos`, { source: part(file), published: 'false', ...(kept ? { temporary: 'true' } : {}) })
      if (!photo.ok) return failed(`${refusal(photo)} Nothing was published.`)
      if (!photo.result.id) return failed('Facebook took a photo and returned no id for it. Nothing was published.')
      form[`attached_media[${index}]`] = JSON.stringify({ media_fbid: photo.result.id })
    }
    if (kept) form.unpublished_content_type = 'SCHEDULED'
    return this.lastStep(api, () => api.post(`${page.id}/feed`, form), kept)
  }

  /**
   * One video with the post's words, in one request. Facebook answers with the number of the video, not of the post: it makes the post once it
   * has processed the video, and none of its pages says how the one number leads to the other. So the post is looked for where the application
   * looks for any post whose answer was lost: among the Page's posts, by its words and its time. A post that
   * has not appeared within three minutes is left as "not known", and is looked for again like every such send.
   */
  private async video(ctx: ConnectorContext, api: GraphApi, page: GraphPage, request: PublishRequest, form: Record<string, string | HttpFile>): Promise<PublishOutcome> {
    const attempt: PublishRequest = { ...request, attemptedAt: request.attemptedAt ?? ctx.clock.now().toISOString() }
    let answer: GraphAnswer<{ id?: string }>
    try {
      answer = await api.post<{ id?: string }>(`${page.id}/videos`, form, VIDEO_TIMEOUT_MS)
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `Facebook did not answer (${error.message}), so it is not known whether it took the video.` }
      throw error
    }
    if (!answer.ok) {
      if (answer.status >= 500 || ON_THEIR_SIDE.includes(answer.code)) return { status: 'unknown', error: `Facebook answered with an error of its own (${answer.message}), so it is not known whether it took the video.` }
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    if (!answer.result.id) return { status: 'unknown', error: 'Facebook accepted the video and returned no id, so it is not known whether it will be published.' }
    for (let look = 0; look < VIDEO_LOOKS; look += 1) {
      await ctx.pause(VIDEO_LOOK_MS)
      try {
        const made = await this.findPublished(ctx, attempt)
        if (made) return { status: 'confirmed', url: made.url, externalId: made.externalId }
      } catch {
        // A look that failed is followed by the next one: the video is with Facebook either way.
      }
    }
    return { status: 'unknown', error: 'Facebook took the video, and the post is not on the Page yet: it publishes a video once it has processed it. The application looks for it again; you can also look at the Page and say whether it is there.' }
  }

  /** What became of a post Facebook was given for a time: it is out, it still waits, or Facebook has it no more. */
  async readScheduled(ctx: ConnectorContext, externalId: string): Promise<ScheduledReading> {
    const api = await this.requireClient(ctx)
    const id = parseExternalId(externalId)
    if (!id) return { state: 'gone' }
    const post = await api.get<GraphPost>(id, { fields: 'id,is_published,permalink_url' })
    if (!post.ok) {
      if (post.code === 100) return { state: 'gone' }
      throw unreadable(post)
    }
    if (post.result.is_published !== true) return { state: 'waiting' }
    return { state: 'published', url: post.result.permalink_url ?? `https://www.facebook.com/${post.result.id}`, externalId: externalIdOf(post.result.id) }
  }

  /** Deletes a post Facebook keeps for a time, unless it went out already. */
  async withdrawScheduled(ctx: ConnectorContext, externalId: string): Promise<'withdrawn' | 'published'> {
    const reading = await this.readScheduled(ctx, externalId)
    if (reading.state === 'published') return 'published'
    if (reading.state === 'gone') return 'withdrawn'
    const api = await this.requireClient(ctx)
    const gone = await api.delete<{ success?: boolean }>(parseExternalId(externalId) as string)
    if (!gone.ok && gone.code !== 100) throw new Error(refusal(gone))
    return 'withdrawn'
  }

  /** The post Facebook keeps for the request's time with the request's words, when the answer to handing it over was lost. */
  async findScheduled(ctx: ConnectorContext, request: PublishRequest): Promise<string | null> {
    const api = await this.requireClient(ctx)
    const page = await this.page(ctx, api)
    const list = await api.get<GraphList<GraphPost>>(`${page.id}/scheduled_posts`, { fields: 'id,message,scheduled_publish_time', limit: '100' })
    if (!list.ok) throw unreadable(list)
    const at = Math.floor(Date.parse(request.publishAt ?? '') / 1000)
    const seconds = (time: number | string | undefined): number => (typeof time === 'number' ? time : Math.floor(Date.parse(iso(time) ?? '') / 1000))
    const words = wordsWithLink(request)
    const hit = (list.result.data ?? []).find((post) => seconds(post.scheduled_publish_time) === at && sameText(post.message ?? '', words))
    return hit ? externalIdOf(hit.id) : null
  }

  private async reply(api: GraphApi, request: PublishRequest, words: string): Promise<PublishOutcome> {
    if (request.attachments.length > 0) return failed('A reply through the Page\'s API carries words only. Take the picture off, or answer on Facebook yourself. Nothing was sent.')
    if (!words) return failed('The reply is empty. Nothing was sent.')
    const parent = parseExternalId(request.parentExternalId)
    if (!parent) return failed('The comment or the post this reply answers was not read through the Page\'s API, so it cannot be answered there. Nothing was sent.')
    return this.lastStep(api, () => api.post(`${parent}/comments`, { message: words }))
  }

  /** Looks in the Page's posts, or under the answered comment, for what a send with a lost answer may have made: the Page's own, with the same words, not older than the attempt. */
  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    const api = await this.requireClient(ctx)
    const page = await this.page(ctx, api)
    const floor = earliestCreation(request)
    const words = wordsWithLink(request)
    const made = (item: { message?: string; created_time?: string; from?: GraphFrom }): boolean =>
      (item.from === undefined || item.from.id === page.id) && sameText(item.message ?? '', words) && Date.parse(iso(item.created_time) ?? '') >= floor
    if (request.kind === 'post') {
      const feed = await api.get<GraphList<GraphPost>>(`${page.id}/feed`, { fields: POST_FIELDS, limit: String(FEED_LIMIT) })
      if (!feed.ok) throw unreadable(feed)
      const hit = (feed.result.data ?? []).find(made)
      return hit ? { url: hit.permalink_url ?? `https://www.facebook.com/${hit.id}`, externalId: externalIdOf(hit.id) } : null
    }
    const parent = parseExternalId(request.parentExternalId)
    if (!parent) throw new Error('The comment this reply answers was not read through the Page\'s API, so the reply cannot be looked for. Look at Facebook and say whether it is there.')
    const list = await api.get<GraphList<GraphComment>>(`${parent}/comments`, { fields: COMMENT_FIELDS, filter: 'stream', order: 'reverse_chronological', limit: String(COMMENTS_LIMIT) })
    if (!list.ok) throw unreadable(list)
    const hit = (list.result.data ?? []).find(made)
    return hit ? { url: hit.permalink_url ?? `https://www.facebook.com/${hit.id}`, externalId: externalIdOf(hit.id) } : null
  }
}

/** What a Page's API has no place for: said, not left out, so the channel's card shows it. */
function notOffered(cap: (key: CapabilityKey, status: CapabilityStatus, detail: string) => Capability): Capability[] {
  return [cap('membership', 'unavailable', 'A Page is not joined: the token is its own.'), cap('read_inbox', 'unavailable', 'Comments arrive as comments of the Page\'s posts.')]
}
