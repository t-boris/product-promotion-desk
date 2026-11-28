import type { PublishingQuota } from '../../shared/api'
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
  HttpPort,
  KeptKey,
  KeyTimes,
  LoginState,
  NormalizedTarget,
  PublicFile,
  PublishedRef,
  PublishOutcome,
  PublishRequest,
  RemoteComment,
  RemoteDiscussion,
  SendTicket
} from '../../core/ports'
import { earliestCreation } from '../reconcile'
import { sameText } from '../text'
import {
  InstagramApi,
  looksLikeInstagramToken,
  type InstagramAnswer,
  type InstagramComment,
  type InstagramContainer,
  type InstagramInsights,
  type InstagramList,
  type InstagramMedia,
  type InstagramProfile,
  type InstagramPublishingLimit
} from './api'

export const INSTAGRAM_API_CONNECTOR_ID = 'instagram-api'

/** How many posts of the account one reading looks at. */
const FEED_LIMIT = 25
const PROFILE_FIELDS = 'user_id,username,name,account_type,followers_count'
const POST_FIELDS = 'id,caption,media_type,permalink,timestamp,username,comments_count,like_count'
const REPLY_FIELDS = 'id,text,username,timestamp,from,parent_id,hidden'
const COMMENT_FIELDS = `${REPLY_FIELDS},replies{${REPLY_FIELDS}}`
/** Instagram gives at most this many comments of a post, the newest first, and its pages name no way to the older ones. */
const MOST_COMMENTS = 50
/** The Graph's own code for "the token is not accepted", and its code for "no such object, or you may not see it". */
const TOKEN_REFUSED = 190
const NO_SUCH_OBJECT = 100
/** A container of a picture is asked every five seconds for a minute; one with a video every ten seconds for five minutes, the longest Meta's page says to ask. */
const CONTAINER_LOOKS = 12
const CONTAINER_WAIT_MS = 5_000
const VIDEO_LOOKS = 30
const VIDEO_WAIT_MS = 10_000
/** What Instagram takes from an address: a JPEG picture and nothing else as a picture (8 MB at most), an MP4 or MOV video; at most 20 in one post. */
const VIDEOS = new Set(['video/mp4', 'video/quicktime'])
const MOST_PICTURE_BYTES = 8 * 1024 * 1024
const MOST_FILES = 20
const MOST_HASHTAGS = 30
const DAY_MS = 24 * 3_600_000
/** A token of 60 days is renewed once less than this is left of it by the application's own count: a week after it was last renewed. */
const RENEW_BELOW_MS = 53 * DAY_MS

const HOST = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i
/** First words of an address that are pages of Instagram itself, not a profile. */
const NOT_A_PROFILE = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'direct', 'tv', 'about', 'developer', 'legal'])

/** The profile an address names, in lower case: "@name", or the profile's address on instagram.com. Null for anything else, a post included. */
export function handleOf(input: string): string | null {
  const typed = input.trim()
  const name = (value: string): string | null => (/^[a-z0-9._]{1,30}$/i.test(value) && !NOT_A_PROFILE.has(value.toLowerCase()) ? value.toLowerCase() : null)
  if (typed.startsWith('@')) return name(typed.slice(1))
  if (!HOST.test(typed)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  return parts.length === 1 ? name(parts[0] as string) : null
}

/** A post's id and a comment's id as the application stores them: a reply is made at another address for each. */
export const postIdOf = (mediaId: string): string => `ig:m:${mediaId}`
export const commentIdOf = (commentId: string): string => `ig:c:${commentId}`

export function parseExternalId(id: string | null): { kind: 'post' | 'comment'; id: string } | null {
  const hit = /^ig:([mc]):(\d+)$/.exec(id ?? '')
  return hit ? { kind: hit[1] === 'm' ? 'post' : 'comment', id: hit[2] as string } : null
}

/** Instagram writes a time as "2026-11-20T10:00:00+0000". */
function iso(time: string | undefined): string | null {
  if (!time) return null
  const ms = Date.parse(time.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

type Refusal = Extract<InstagramAnswer<unknown>, { ok: false }>

const tokenRefused = (answer: Refusal): boolean => answer.code === TOKEN_REFUSED || answer.status === 401

/** What Instagram refused, in words. */
function refusal(answer: Refusal): string {
  if (tokenRefused(answer)) return 'Instagram does not accept the access token: it ended or was withdrawn. Generate a new one (the steps on the account\'s page) and save it there.'
  if (answer.status === 429) return `Instagram asks to wait before the next request (${answer.message}).`
  return `Instagram refused it: ${answer.message}`
}

/** A refusal while reading. The name of a refused token makes the monitor read it as a sign-in problem of the account, which it is. */
function unreadable(answer: Refusal): Error {
  const error = new Error(refusal(answer))
  return tokenRefused(answer) ? Object.assign(error, { name: 'LoginRequiredError' }) : error
}

const failed = (error: string): PublishOutcome => ({ status: 'failed', error })

const DEVELOPERS = 'https://developers.facebook.com'

const API: ApiAccess = {
  accountKind: 'developer app',
  keyLabel: 'Instagram access token',
  keyName: 'Instagram access token',
  steps: [
    {
      text: 'The Instagram account must be a professional one (Business or Creator) and public. In Instagram’s settings look for “For professionals”, then “Account type and tools”: if it offers “Switch to professional account”, press it. It is free.',
      url: 'https://www.instagram.com/accounts/edit/',
      link: 'Open Instagram’s settings'
    },
    {
      text: 'Sign in to Facebook and register as a developer. It is free, and the Instagram account needs no Facebook Page for this.',
      url: `${DEVELOPERS}/async/registration`,
      link: 'Open Meta for Developers'
    },
    {
      text: 'Create an app: any name, and as its use case choose the one for Instagram (managing messages and content on Instagram).',
      url: `${DEVELOPERS}/apps/creation/`,
      link: 'Open “Create an app”'
    },
    {
      text: 'In the app open “Instagram”, then “API setup with Instagram login” (Meta also writes it “API setup with Instagram business login”). Press “Add all required permissions” and see that these four are there: instagram_business_basic, instagram_business_content_publish, instagram_business_manage_comments and instagram_business_manage_insights.',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    {
      text: 'On the same page, under “Generate access tokens”, press “Add account” and log in to the Instagram account. Then press “Generate token” beside it and copy the token. It lasts 60 days, and the application renews it by itself.',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    {
      text: 'For everybody to see what the app posts, publish the app: “Publish”, then “Go live”. Meta asks first for an app icon, a privacy policy address and a data deletion address. Meta’s general rule is that until then only the people of the app see what it posts; its Instagram pages do not say it either way.',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    { text: 'Set up “A place for files” in this application’s Settings: Instagram takes every picture and video only from an address on the internet, so no post goes out without it.' },
    { text: 'Paste the token below. It is kept in the vault of this Mac and is never shown again. Another Instagram account needs a token of its own: each is an account of its own here.' }
  ],
  keyLooksValid: looksLikeInstagramToken
}

const NO_PLACE =
  'Instagram takes a picture or a video through its API only from an address on the internet, and no place for files is set up. Set one up in Settings (“A place for files”), or publish the post on Instagram yourself. Nothing was sent.'

/** The profile as one object: Meta's pages show it both plain and inside a `data` list. */
function profileOf(body: InstagramProfile & { data?: InstagramProfile[] }): InstagramProfile {
  return Array.isArray(body.data) && body.data[0] ? body.data[0] : body
}

/** The id the publishing pages put into their addresses: the professional account's, which Instagram names `user_id`. */
const accountIdOf = (profile: InstagramProfile): string | null => profile.user_id ?? profile.id ?? null

/**
 * An Instagram professional account worked through the Instagram API with the account's own access token (DEC-082): a post of one picture, one
 * video or several of them with its caption; the comments under the account's posts, read from Instagram each time; a reply under a comment
 * and a comment under the own post; likes, comments and views counted under a post. Every file of a post goes through the owner's place for
 * files (DEC-081): Instagram takes one only from an address on the internet. Nothing is kept here: Instagram holds the posts and gives them again.
 */
export class InstagramApiConnector implements Connector {
  readonly id = INSTAGRAM_API_CONNECTOR_ID
  readonly platform = 'instagram'
  readonly version = '1'
  readonly label = 'Instagram'
  readonly api = API
  readonly postNumberKinds = ['likes', 'comments', 'views'] as const

  /** The account each token belongs to, as Instagram named it at the last check. */
  private readonly profiles = new Map<string, InstagramProfile>()

  matches(input: string): boolean {
    return handleOf(input) !== null
  }

  normalizeTarget(input: string): NormalizedTarget {
    const handle = handleOf(input)
    if (!handle) throw new Error('Give the address of the profile itself, like https://www.instagram.com/yourbrand/, or @yourbrand. A post is not one.')
    return { target: `instagram.com/${handle}`, url: `https://www.instagram.com/${handle}/` }
  }

  loginUrl(): string {
    return `${DEVELOPERS}/apps/`
  }

  channelGuide(): ChannelGuide {
    return { browseUrl: 'https://www.instagram.com/', example: 'https://www.instagram.com/yourbrand/', hint: 'The address of the profile whose access token this account holds.' }
  }

  readsChannel(_channel: Channel): boolean {
    return true
  }

  /**
   * Makes a token of 60 days last 60 days again. Instagram cannot be asked when a token ends, so the application goes by what it remembers: a
   * token is renewed a day after it was saved (Instagram renews only one that is at least a day old), and a week after each renewal.
   */
  async renewKey(http: HttpPort, key: string, now: Date, times: KeyTimes): Promise<KeptKey | null> {
    const changedMs = times.changedAt ? Date.parse(times.changedAt) : Number.NaN
    // A key saved before the application remembered such times is taken as old enough.
    if (!Number.isNaN(changedMs) && now.getTime() - changedMs < DAY_MS) return null
    const endsMs = times.expiresAt ? Date.parse(times.expiresAt) : Number.NaN
    if (!Number.isNaN(endsMs) && endsMs - now.getTime() > RENEW_BELOW_MS) return null
    const renewed = await new InstagramApi(http, key).refresh()
    if (!renewed.ok) throw tokenRefused(renewed) ? Object.assign(new Error(refusal(renewed)), { name: 'LoginRequiredError' }) : new Error(`Instagram did not renew the token (${renewed.message}).`)
    const token = renewed.result
    if (!token.access_token) throw new Error('Instagram answered the renewal with no token.')
    const lasts = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in * 1000 : 60 * DAY_MS
    return { key: token.access_token, expiresAt: new Date(now.getTime() + lasts).toISOString() }
  }

  private async client(ctx: ConnectorContext): Promise<InstagramApi | null> {
    const token = await ctx.apiKey()
    return token ? new InstagramApi(ctx.http, token) : null
  }

  private async requireClient(ctx: ConnectorContext): Promise<InstagramApi> {
    const api = await this.client(ctx)
    if (!api) throw Object.assign(new Error('No Instagram access token is saved for this account. Save it on the account\'s page.'), { name: 'LoginRequiredError' })
    return api
  }

  private async ask(api: InstagramApi): Promise<InstagramAnswer<InstagramProfile>> {
    const me = await api.get<InstagramProfile & { data?: InstagramProfile[] }>('me', { fields: PROFILE_FIELDS })
    return me.ok ? { ok: true, result: profileOf(me.result) } : me
  }

  /** Whose token it is: asked from Instagram, and remembered until the next sign-in check. */
  private async profile(ctx: ConnectorContext, api: InstagramApi): Promise<InstagramProfile & { accountId: string }> {
    const kept = this.profiles.get(ctx.account.id) ?? (await this.fresh(ctx, api))
    const accountId = accountIdOf(kept)
    if (!accountId) throw new Error('Instagram named no id for the account of this token.')
    return { ...kept, accountId }
  }

  private async fresh(ctx: ConnectorContext, api: InstagramApi): Promise<InstagramProfile> {
    const me = await this.ask(api)
    if (!me.ok) throw unreadable(me)
    this.profiles.set(ctx.account.id, me.result)
    return me.result
  }

  private address(profile: InstagramProfile): string {
    return profile.username ? `https://www.instagram.com/${profile.username}/` : 'https://www.instagram.com/'
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    this.profiles.delete(ctx.account.id)
    const api = await this.client(ctx)
    if (!api) return { loggedIn: false, identity: null, captcha: false, signal: 'no Instagram access token is saved' }
    const me = await this.ask(api)
    if (!me.ok) return { loggedIn: false, identity: null, captcha: false, signal: tokenRefused(me) ? 'Instagram does not accept the token (it ended or was withdrawn)' : refusal(me) }
    this.profiles.set(ctx.account.id, me.result)
    return { loggedIn: true, identity: me.result.username ? `@${me.result.username}` : (me.result.name ?? accountIdOf(me.result) ?? 'Instagram account'), captcha: false }
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const all = (status: CapabilityStatus, detail: string): Capability[] =>
      (['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics'] as CapabilityKey[]).map((key) => cap(key, status, detail)).concat(notOffered(cap))
    const api = await this.client(ctx)
    if (!api) return all('needs_user', 'Save the Instagram access token on the account\'s page first.')
    this.profiles.delete(ctx.account.id)
    let profile: InstagramProfile & { accountId: string }
    try {
      profile = await this.profile(ctx, api)
    } catch (error) {
      return all('needs_user', error instanceof Error ? error.message : String(error))
    }
    const name = profile.username ? `@${profile.username}` : (profile.name ?? profile.accountId)
    // The channel's address says which profile was meant.
    const wanted = handleOf(ctx.channel.url)
    if (!wanted || !profile.username || wanted !== profile.username.toLowerCase()) {
      return all('needs_user', `The token of this account belongs to the profile ${name} (${this.address(profile)}), and this channel is ${ctx.channel.url}. Connect the address of that profile, or save the token of this one.`)
    }
    const feed = await api.get<InstagramList<InstagramMedia>>(`${profile.accountId}/media`, { fields: POST_FIELDS })
    const newest = feed.ok ? (feed.result.data ?? [])[0] : undefined
    const talk = newest ? await api.get<InstagramList<InstagramComment>>(`${newest.id}/comments`, { fields: COMMENT_FIELDS }) : null
    const reads: [CapabilityStatus, string] = !feed.ok ? ['needs_user', refusal(feed)] : ['verified', `The posts of ${name} are read from Instagram.`]
    const talks: [CapabilityStatus, string] = !feed.ok
      ? ['needs_user', refusal(feed)]
      : !talk
        ? ['needs_check', 'The account has no post yet, so reading comments was not tried.']
        : talk.ok
          ? ['verified', `Comments under the account's posts are read from Instagram: the ${MOST_COMMENTS} newest of each post, with their replies. It needs the permission instagram_business_manage_comments.`]
          : ['needs_user', `${refusal(talk)} Reading comments needs the permission instagram_business_manage_comments.`]
    return [
      cap('read_posts', ...reads),
      cap('read_comments', ...talks),
      cap('detect_changes', ...reads),
      cap(
        'publish_post',
        'verified',
        `Posts go out as ${name}: one picture, one video (a reel, shown in the feed as well) or up to ${MOST_FILES} of them, with the caption. Every file goes through your place for files (Settings): Instagram takes one only from an address on the internet, and a picture only as JPEG, so the application sends a JPEG copy of a PNG. It needs the permission instagram_business_content_publish. Until the app is published in Meta's dashboard (“Go live”), only the people of the app may see what it posts.`
      ),
      cap('publish_reply', 'verified', 'A reply goes under a comment, and a comment under the account\'s own post, as the account. It needs the permission instagram_business_manage_comments.'),
      cap('verify_send', 'verified', 'Instagram returns the post or the comment it made.'),
      cap('metrics', 'verified', 'The number of followers; under each post, likes and comments, and views with the permission instagram_business_manage_insights (Instagram counts them with a delay of up to two days).'),
      ...notOffered(cap)
    ]
  }

  private author(ctx: ConnectorContext, profile: InstagramProfile, comment: InstagramComment): string {
    const name = comment.username ?? comment.from?.username
    // What the account itself wrote is the account's own: nobody to answer.
    if (name !== undefined && name === profile.username) return ctx.account.identity ?? `@${name}`
    return name ? `@${name}` : 'Somebody on Instagram'
  }

  private async discussion(ctx: ConnectorContext, api: InstagramApi, profile: InstagramProfile, post: InstagramMedia): Promise<RemoteDiscussion> {
    const url = post.permalink ?? this.address(profile)
    const postId = postIdOf(post.id)
    const comments: RemoteComment[] = []
    let incomplete = false
    // Instagram says how many comments a post has; a post it says nothing about is asked.
    if (post.comments_count !== 0) {
      const list = await api.get<InstagramList<InstagramComment>>(`${post.id}/comments`, { fields: COMMENT_FIELDS })
      if (!list.ok) throw unreadable(list)
      const top = list.result.data ?? []
      const one = (comment: InstagramComment, parent: string): RemoteComment => ({
        externalId: commentIdOf(comment.id),
        parentExternalId: parent,
        author: this.author(ctx, profile, comment),
        body: comment.text ?? '',
        // Instagram gives a comment no address of its own: it is found under its post.
        url,
        postedAt: iso(comment.timestamp),
        ...(comment.hidden === undefined ? {} : { hidden: comment.hidden })
      })
      // Instagram gives the newest first; the application keeps a conversation in the order it was written.
      for (const comment of [...top].reverse()) {
        comments.push(one(comment, postId))
        for (const reply of comment.replies?.data ?? []) comments.push(one(reply, commentIdOf(comment.id)))
      }
      incomplete = list.result.paging?.next !== undefined || top.length >= MOST_COMMENTS
    }
    const body = post.caption ?? ''
    const firstLine = body.split('\n')[0] ?? ''
    return {
      externalId: postId,
      url,
      title: firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine,
      author: ctx.account.identity ?? (profile.username ? `@${profile.username}` : 'Instagram account'),
      body,
      postedAt: iso(post.timestamp),
      comments,
      ...(incomplete ? { incomplete: true } : {})
    }
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const api = await this.requireClient(ctx)
    const profile = await this.profile(ctx, api)
    const feed = await api.get<InstagramList<InstagramMedia>>(`${profile.accountId}/media`, { fields: POST_FIELDS })
    if (!feed.ok) throw unreadable(feed)
    const discussions: RemoteDiscussion[] = []
    for (const post of (feed.result.data ?? []).slice(0, Math.max(1, Math.min(options.limit, FEED_LIMIT)))) discussions.push(await this.discussion(ctx, api, profile, post))
    return { discussions, fetchedAt: ctx.clock.now().toISOString() }
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    const api = await this.requireClient(ctx)
    const id = parseExternalId(discussionExternalId)
    if (!id || id.kind !== 'post') return null
    const profile = await this.profile(ctx, api)
    const post = await api.get<InstagramMedia>(id.id, { fields: POST_FIELDS })
    if (!post.ok) {
      if (post.code === NO_SUCH_OBJECT || post.status === 404) return null
      throw unreadable(post)
    }
    return this.discussion(ctx, api, profile, post.result)
  }

  async fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]> {
    const api = await this.requireClient(ctx)
    // Asked anew: the number kept from the last sign-in check may be days old.
    const me = await this.ask(api)
    if (!me.ok && tokenRefused(me)) throw unreadable(me)
    const said = me.ok ? me.result.followers_count : undefined
    const value = typeof said === 'number' && Number.isInteger(said) && said >= 0 ? said : null
    return [{ key: 'followers', label: 'Followers', value, available: value !== null }]
  }

  /** Reads the account's remaining 24-hour publishing allowance from Instagram (DEC-096). */
  async readPublishingQuota(ctx: ConnectorContext): Promise<PublishingQuota | null> {
    const api = await this.requireClient(ctx)
    const profile = await this.profile(ctx, api)
    const answer = await api.get<InstagramPublishingLimit>(`${profile.accountId}/content_publishing_limit`, { fields: 'quota_usage,config' })
    if (!answer.ok) throw unreadable(answer)
    const entry = answer.result.data?.[0]
    if (!entry || typeof entry.quota_usage !== 'number') return null
    const limit = typeof entry.config?.quota_total === 'number' && entry.config.quota_total > 0 ? entry.config.quota_total : 100
    const duration = typeof entry.config?.quota_duration === 'number' && entry.config.quota_duration > 0 ? entry.config.quota_duration : 86_400
    return { used: Math.max(0, entry.quota_usage), limit, windowHours: Math.max(1, Math.round(duration / 3600)), readAt: ctx.clock.now().toISOString() }
  }

  async readPostNumbers(ctx: ConnectorContext, posts: { externalId: string; url: string | null }[]): Promise<Record<string, PostNumbers>> {
    const api = await this.requireClient(ctx)
    const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)
    const found: Record<string, PostNumbers> = {}
    for (const post of posts) {
      const id = parseExternalId(post.externalId)
      if (!id || id.kind !== 'post') continue
      // Likes and comments stand on the post itself; views are counted apart, later, and only with the insights permission.
      const media = await api.get<InstagramMedia>(id.id, { fields: 'like_count,comments_count' })
      if (!media.ok) {
        if (tokenRefused(media)) throw unreadable(media)
        continue
      }
      const insights = await api.get<InstagramInsights>(`${id.id}/insights`, { metric: 'views' })
      const views = insights.ok ? whole((insights.result.data ?? []).find((entry) => entry.name === 'views')?.values?.[0]?.value) : null
      found[post.externalId] = { likes: whole(media.result.like_count), comments: whole(media.result.comments_count), views }
    }
    return found
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    const api = await this.client(ctx)
    if (!api) return failed('No Instagram access token is saved for this account. Nothing was sent.')
    const words = request.text.trim()
    if (request.kind === 'reply') return this.reply(api, request, words)
    const files = request.attachments
    if (files.length === 0) return failed('Instagram has no post of words only: add a picture or a video. Nothing was sent.')
    const unfit = files.find((file) => (isVideoMime(file.mime) ? !VIDEOS.has(file.mime) : !file.mime.startsWith('image/')))
    if (unfit) return failed(`Instagram takes a picture and an MP4 or MOV video through its API; “${unfit.name}” is neither. Nothing was sent.`)
    if (files.length > MOST_FILES) return failed(`Instagram takes at most ${MOST_FILES} pictures and videos in one post; this one has ${files.length}. Nothing was sent.`)
    const tags = words.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0
    if (tags > MOST_HASHTAGS) return failed(`Instagram takes at most ${MOST_HASHTAGS} hashtags in a caption; this one has ${tags}. Nothing was sent.`)
    const place = await ctx.publicFiles()
    if (!place) return failed(NO_PLACE)
    // Every file put on its public address for this send; each is deleted when the send ends, whatever its end.
    const put: PublicFile[] = []
    try {
      const profile = await this.profile(ctx, api)
      // Instagram takes a picture only as JPEG: one of another kind is put as a JPEG copy, the original untouched.
      for (const file of files) put.push(await place.put({ path: file.path, name: file.name, mime: file.mime }, isVideoMime(file.mime) ? undefined : { jpegUnder: MOST_PICTURE_BYTES }))
      const isVideo = (index: number): boolean => isVideoMime((files[index] as (typeof files)[number]).mime)
      const urlOf = (index: number): string => (put[index] as PublicFile).url
      const caption: Record<string, unknown> = words ? { caption: words } : {}
      // Instagram makes a post in two requests: a container that holds it, then the request that publishes the container.
      const make = async (body: Record<string, unknown>, video: boolean): Promise<{ id: string } | { error: string }> => {
        const container = await api.post<{ id?: string }>(`${profile.accountId}/media`, body)
        if (!container.ok) return { error: `${refusal(container)} Nothing was sent.` }
        if (!container.result.id) return { error: 'Instagram took the post and returned no id for it. Nothing was published.' }
        const ready = await this.whenReady(ctx, api, container.result.id, video)
        return ready === null ? { id: container.result.id } : { error: ready }
      }
      let whole: { id: string } | { error: string }
      if (files.length === 1) {
        // One video is a reel; `share_to_feed` keeps it in the profile's feed as well, where a post is expected.
        whole = isVideo(0) ? await make({ media_type: 'REELS', video_url: urlOf(0), share_to_feed: true, ...caption }, true) : await make({ image_url: urlOf(0), ...caption }, false)
      } else {
        // Several: each is a container of its own, and one more container names them all. One that fails leaves nothing published.
        const children: string[] = []
        for (let index = 0; index < files.length; index += 1) {
          const item = isVideo(index) ? await make({ media_type: 'VIDEO', video_url: urlOf(index), is_carousel_item: true }, true) : await make({ image_url: urlOf(index), is_carousel_item: true }, false)
          if ('error' in item) return failed(item.error)
          children.push(item.id)
        }
        whole = await make({ media_type: 'CAROUSEL', children: children.join(','), ...caption }, files.some((_, index) => isVideo(index)))
      }
      if ('error' in whole) return failed(whole.error)
      const containerId = whole.id
      return await this.lastStep(api, () => api.post<Published>(`${profile.accountId}/media_publish`, { creation_id: containerId }), postIdOf, this.address(profile))
    } catch (error) {
      // Only the request that publishes can leave a doubt, and it is asked through `lastStep`: anything that fails here failed before it.
      if (error instanceof HttpNoAnswerError) return failed(`No answer came (${error.message}) before anything was published. Nothing was sent.`)
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    } finally {
      for (const file of put) await file.remove()
    }
  }

  /** A reply under a comment, or a comment under the account's own post: words only. */
  private async reply(api: InstagramApi, request: PublishRequest, words: string): Promise<PublishOutcome> {
    if (!words) return failed('The reply is empty. Nothing was sent.')
    if (request.attachments.length > 0) return failed('A comment on Instagram is words only: take the picture off the reply. Nothing was sent.')
    const parent = parseExternalId(request.parentExternalId)
    if (!parent) return failed('The post or the comment this answers was not read through the Instagram API, so it cannot be answered there. Nothing was sent.')
    const path = parent.kind === 'comment' ? `${parent.id}/replies` : `${parent.id}/comments`
    try {
      return await this.lastStep(api, () => api.post<Published>(path, { message: words }), commentIdOf, request.destination)
    } catch (error) {
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
  }

  /** Waits until Instagram says the container may be published; null when it may, the reason in words when it never will. Nothing is published either way. */
  private async whenReady(ctx: ConnectorContext, api: InstagramApi, containerId: string, video: boolean): Promise<string | null> {
    const looks = video ? VIDEO_LOOKS : CONTAINER_LOOKS
    for (let look = 0; look < looks; look += 1) {
      const state = await api.get<InstagramContainer>(containerId, { fields: 'status_code,status' })
      if (!state.ok) return `${refusal(state)} Nothing was published.`
      const status = state.result.status_code
      if (status === 'FINISHED') return null
      if (status === 'ERROR' || status === 'EXPIRED') return `Instagram could not prepare the post (${state.result.status ?? status}). Nothing was published.`
      if (status !== 'IN_PROGRESS') return `Instagram answered with a state of the post this application does not know (${String(status)}). Nothing was published.`
      await ctx.pause(video ? VIDEO_WAIT_MS : CONTAINER_WAIT_MS)
    }
    return `Instagram was still preparing the post after ${video ? 'five minutes' : 'a minute'}. Nothing was published; send it again.`
  }

  /** The request that publishes. No answer to it, or an error of Instagram's own side, leaves it unknown whether Instagram made it. */
  private async lastStep(api: InstagramApi, call: () => Promise<InstagramAnswer<Published>>, idOf: (id: string) => string, fallbackUrl: string): Promise<PublishOutcome> {
    let answer: InstagramAnswer<Published>
    try {
      answer = await call()
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `Instagram did not answer (${error.message}), so it is not known whether it was published.` }
      throw error
    }
    if (!answer.ok) {
      if (answer.status >= 500) return { status: 'unknown', error: `Instagram answered with an error of its own (${answer.message}), so it is not known whether it was published.` }
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    const id = answer.result.id
    if (!id) return { status: 'unknown', error: 'Instagram accepted it and returned no id, so it is not known whether it was published.' }
    // Instagram may publish a post and say that its caption was not attached: the post is there, so it is not sent again; the owner must see it.
    if (answer.result.config_issue === 'CAPTION_NOT_ATTACHED') return { status: 'unknown', error: 'Instagram published the post and says its caption was not attached. Look at the post on Instagram: add the caption there, then say here that it is published.' }
    return { status: 'confirmed', url: idOf === postIdOf ? await this.addressOf(api, id, fallbackUrl) : fallbackUrl, externalId: idOf(id) }
  }

  /** The address Instagram gives the post; the profile's own address when Instagram does not say. */
  private async addressOf(api: InstagramApi, id: string, fallback: string): Promise<string> {
    try {
      const made = await api.get<InstagramMedia>(id, { fields: 'permalink' })
      if (made.ok && made.result.permalink) return made.result.permalink
    } catch {
      // Published all the same.
    }
    return fallback
  }

  /** Hides a comment under the account's post from other readers, or shows it again (DEC-089). */
  async hideComment(ctx: ConnectorContext, externalId: string, hidden: boolean): Promise<void> {
    const api = await this.requireClient(ctx)
    const comment = parseExternalId(externalId)
    if (!comment || comment.kind !== 'comment') throw new Error('This comment was not read through the Instagram API, so it cannot be hidden through it.')
    let answer: InstagramAnswer<{ success?: boolean }>
    try {
      answer = await api.post<{ success?: boolean }>(comment.id, { hide: hidden })
    } catch (error) {
      if (error instanceof HttpNoAnswerError) throw new Error(`Instagram did not answer (${error.message}).`, { cause: error })
      throw error
    }
    if (!answer.ok) throw new Error(refusal(answer))
    if (answer.result.success !== true) throw new Error('Instagram did not say that it was done.')
  }

  /** Looks among the account's posts, or under what was answered, for what a send with a lost answer may have made: the same words, not older than the attempt. */
  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    const api = await this.requireClient(ctx)
    const profile = await this.profile(ctx, api)
    const floor = earliestCreation(request)
    const words = request.text.trim()
    const recent = (time: string | undefined): boolean => Date.parse(iso(time) ?? '') >= floor
    if (request.kind === 'post') {
      const feed = await api.get<InstagramList<InstagramMedia>>(`${profile.accountId}/media`, { fields: POST_FIELDS })
      if (!feed.ok) throw unreadable(feed)
      const hit = (feed.result.data ?? []).slice(0, FEED_LIMIT).find((item) => sameText(item.caption ?? '', words) && recent(item.timestamp))
      return hit ? { url: hit.permalink ?? this.address(profile), externalId: postIdOf(hit.id) } : null
    }
    const parent = parseExternalId(request.parentExternalId)
    if (!parent) throw new Error('The post this reply answers was not read through the Instagram API, so the reply cannot be looked for. Look at Instagram and say whether it is there.')
    const list = await api.get<InstagramList<InstagramComment>>(parent.kind === 'comment' ? `${parent.id}/replies` : `${parent.id}/comments`, { fields: REPLY_FIELDS })
    if (!list.ok) throw unreadable(list)
    const mine = (comment: InstagramComment): boolean => (comment.username ?? comment.from?.username) === profile.username
    const hit = (list.result.data ?? []).find((comment) => mine(comment) && sameText(comment.text ?? '', words) && recent(comment.timestamp))
    return hit ? { url: request.destination, externalId: commentIdOf(hit.id) } : null
  }
}

/** What the request that publishes answers: the id, and sometimes that a part of the post did not attach. */
interface Published {
  id?: string
  config_issue?: string
}

/** What the Instagram API has no place for here: said, not left out, so the channel's card shows it. */
function notOffered(cap: (key: CapabilityKey, status: CapabilityStatus, detail: string) => Capability): Capability[] {
  return [cap('membership', 'unavailable', 'A profile is not joined: the token is its own.'), cap('read_inbox', 'unavailable', 'Comments arrive under the account\'s posts; direct messages are not read.')]
}
