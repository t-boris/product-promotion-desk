import type { Capability, CapabilityKey, CapabilityStatus, Channel, MetricReading } from '../../shared/types'
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
  LoginState,
  NormalizedTarget,
  PublishedRef,
  PublishOutcome,
  PublishRequest,
  RemoteComment,
  RemoteDiscussion,
  SendTicket
} from '../../core/ports'
import { earliestCreation } from '../reconcile'
import { sameText, wordsWithLink } from '../text'
import { ThreadsApi, looksLikeThreadsToken, type ThreadsAnswer, type ThreadsContainer, type ThreadsInsights, type ThreadsList, type ThreadsMedia, type ThreadsProfile, type ThreadsToken } from './api'

export const THREADS_API_CONNECTOR_ID = 'threads-api'

/** How many posts of the profile one reading looks at. */
const FEED_LIMIT = 25
const PROFILE_FIELDS = 'id,username,name'
const POST_FIELDS = 'id,text,timestamp,permalink,username,media_type,has_replies'
const REPLY_FIELDS = 'id,text,timestamp,permalink,username,replied_to,root_post,is_reply_owned_by_me,hide_status'
/** The Graph's own code for "the token is not accepted", and its code for "no such object, or you may not see it". */
const TOKEN_REFUSED = 190
const NO_SUCH_OBJECT = 100
/** A container of words is ready at once; Threads is asked a few times before the send gives up, and nothing is published then. */
const CONTAINER_LOOKS = 12
const CONTAINER_WAIT_MS = 5_000
const DAY_MS = 24 * 3_600_000
/** A token of an hour is a short one; anything that lasts longer than this is kept as it is. */
const SHORT_TOKEN_MS = 2 * DAY_MS
/** A token of 60 days is renewed once less than this is left of it, so a Mac that was off for weeks still finds it alive. */
const RENEW_BELOW_MS = 45 * DAY_MS

const HOST = /^(?:https?:\/\/)?(?:www\.)?threads\.(?:net|com)\//i

/** The profile an address names, in lower case: "@name", or the profile's address on threads.net or threads.com. Null for anything else, a post included. */
export function handleOf(input: string): string | null {
  const typed = input.trim()
  const name = (value: string): string | null => (/^[a-z0-9._]{1,30}$/i.test(value) ? value.toLowerCase() : null)
  if (typed.startsWith('@')) return name(typed.slice(1))
  if (!HOST.test(typed)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  return parts.length === 1 && (parts[0] as string).startsWith('@') ? name((parts[0] as string).slice(1)) : null
}

/** A post's or a reply's id as the application stores it. */
export const externalIdOf = (mediaId: string): string => `th:${mediaId}`

export function parseExternalId(id: string | null): string | null {
  return /^th:(\d+)$/.exec(id ?? '')?.[1] ?? null
}

/** Threads writes a time as "2023-10-17T05:42:03+0000". */
function iso(time: string | undefined): string | null {
  if (!time) return null
  const ms = Date.parse(time.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

type Refusal = Extract<ThreadsAnswer<unknown>, { ok: false }>

const tokenRefused = (answer: Refusal): boolean => answer.code === TOKEN_REFUSED || answer.status === 401

/** What Threads refused, in words. */
function refusal(answer: Refusal): string {
  if (tokenRefused(answer)) return 'Threads does not accept the access token: it ended or was withdrawn. Make a new one (the steps on the account\'s page) and save it there.'
  if (answer.status === 429) return `Threads asks to wait before the next request (${answer.message}).`
  return `Threads refused it: ${answer.message}`
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
  keyLabel: 'Threads access token',
  keyName: 'Threads access token',
  onceSecret: {
    label: 'Threads app secret',
    hint: 'Only when the token above is a short one (Threads gives it for an hour): the application sends the two to Threads once, keeps the 60-day token it answers with, and does not keep the secret. After that it renews the token by itself.'
  },
  steps: [
    {
      text: 'Sign in to Facebook and register as a developer. It is free. The Threads profile itself needs no change: a personal profile works.',
      url: `${DEVELOPERS}/async/registration`,
      link: 'Open Meta for Developers'
    },
    {
      text: 'Create an app: any name, and as its use case choose “Access the Threads API”.',
      url: `${DEVELOPERS}/apps/creation/`,
      link: 'Open “Create an app”'
    },
    {
      text: 'In the app open “Use cases”, press “Customize” beside “Access the Threads API” and add four permissions to threads_basic, which is there already: threads_content_publish, threads_read_replies, threads_manage_replies and threads_manage_insights.',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    {
      text: 'On the same page open “Settings”, press “Add or Remove Threads Test Users”, then “Add People”, choose “Threads Tester” and type the name of your Threads profile. Then accept the invitation in Threads: Settings, Account, “Website permissions”, “Invites”.',
      url: 'https://www.threads.com/settings/account',
      link: 'Open Threads’ account settings'
    },
    {
      text: 'Get a token for that profile. In the Graph API Explorer choose your app, switch it to Threads (the address field shows threads.net), add the same permissions and generate the token; it lasts an hour. If the “Settings” page of the use case offers to generate a token for your tester profile, that one works as well.',
      url: `${DEVELOPERS}/tools/explorer/`,
      link: 'Open the Graph API Explorer'
    },
    {
      text: 'Copy the “Threads app secret” of the app: “App settings”, “Basic”. It is not the “App secret” beside it: the app has two, and Threads takes only its own.',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    {
      text: 'For everybody to see what the app posts, publish the app: “Publish”, then “Go live”. Meta asks first for an app icon, a privacy policy address and a data deletion address. Until then only you and the other people of the app may see those posts.',
      url: `${DEVELOPERS}/apps/`,
      link: 'Open your apps'
    },
    { text: 'Paste the token and the secret below within the hour. The token is kept in the vault of this Mac and is never shown again; the secret is used once and not kept. Another profile needs a token of its own: each profile is an account of its own.' }
  ],
  keyLooksValid: looksLikeThreadsToken
}

const NO_MEDIA =
  'A picture or a video is not sent to Threads through its API by this application: Threads takes one only from a public address on the internet, and this application has none to put it on. Take it off the post, or publish the post on Threads yourself. Nothing was sent.'

const untilOf = (now: Date, token: ThreadsToken): string | null =>
  typeof token.expires_in === 'number' && token.expires_in > 0 ? new Date(now.getTime() + token.expires_in * 1000).toISOString() : null

/**
 * A Threads profile worked through the Threads API with the profile's own access token (DEC-080): posts of words with a link and a topic; the
 * replies under the profile's posts, read from Threads each time; replies under a post or a reply; likes, replies and views counted under a
 * post. Nothing is kept here: Threads holds the posts and gives them again. Not carried: a picture and a video, which Threads takes only from
 * a public address.
 */
export class ThreadsApiConnector implements Connector {
  readonly id = THREADS_API_CONNECTOR_ID
  readonly platform = 'threads'
  readonly version = '1'
  readonly label = 'Threads'
  readonly api = API
  readonly postNumberKinds = ['likes', 'comments', 'views'] as const

  /** The profile each account's token belongs to, as Threads named it at the last check. */
  private readonly profiles = new Map<string, ThreadsProfile>()

  matches(input: string): boolean {
    return handleOf(input) !== null
  }

  normalizeTarget(input: string): NormalizedTarget {
    const handle = handleOf(input)
    if (!handle) throw new Error('Give the address of the profile itself, like https://www.threads.net/@yourbrand, or @yourbrand. A post is not one.')
    return { target: `threads.net/@${handle}`, url: `https://www.threads.net/@${handle}` }
  }

  loginUrl(): string {
    return `${DEVELOPERS}/tools/explorer/`
  }

  channelGuide(): ChannelGuide {
    return { browseUrl: 'https://www.threads.net/', example: 'https://www.threads.net/@yourbrand', hint: 'The address of the profile whose access token this account holds.' }
  }

  readsChannel(_channel: Channel): boolean {
    return true
  }

  /**
   * What the vault keeps for a pasted token. Threads is asked how long the token lasts: one that lasts is kept as it is; a short one is
   * exchanged for a token of 60 days with the secret of the Threads app, and refused without it.
   */
  async keyToKeep(http: HttpPort, pasted: { key: string; secret: string | null }, now: Date): Promise<KeptKey> {
    const api = new ThreadsApi(http, pasted.key)
    let facts: ThreadsAnswer<{ data?: { is_valid?: boolean; expires_at?: number } }>
    try {
      facts = await api.facts()
    } catch (error) {
      if (error instanceof HttpNoAnswerError) throw new Error(`Threads did not answer (${error.message}), so the token was not saved. Try again.`, { cause: error })
      throw error
    }
    if (!facts.ok && tokenRefused(facts)) throw new Error('Threads does not accept this token: it ended, or it was not copied whole. Generate a new one and paste it at once.')
    const data = facts.ok ? facts.result.data : undefined
    if (data?.is_valid === false) throw new Error('Threads says this token is no longer valid. Generate a new one and paste it at once.')
    const endsMs = typeof data?.expires_at === 'number' && data.expires_at > 0 ? data.expires_at * 1000 : null
    if (endsMs !== null && endsMs - now.getTime() > SHORT_TOKEN_MS) return { key: pasted.key, expiresAt: new Date(endsMs).toISOString() }
    if (pasted.secret) {
      let long: ThreadsAnswer<ThreadsToken>
      try {
        long = await api.exchange(pasted.secret)
      } catch (error) {
        if (error instanceof HttpNoAnswerError) throw new Error(`Threads did not answer (${error.message}), so the token was not saved. Try again.`, { cause: error })
        throw error
      }
      if (!long.ok) throw new Error(`Threads did not exchange the token for one that lasts (${long.message}). Check that the secret is the “Threads app secret” of the same app, and that the token is less than an hour old.`)
      if (!long.result.access_token) throw new Error('Threads answered the exchange with no token. Nothing was saved.')
      return { key: long.result.access_token, expiresAt: untilOf(now, long.result) }
    }
    // Threads said when the token ends, and it is within the day: saved as it is, the account would stop working in an hour.
    if (endsMs !== null) throw new Error('This token is a short one: Threads gives it for an hour. Paste it again together with the “Threads app secret” of your app (“App settings”, “Basic”), and the application exchanges the two for a token that lasts 60 days.')
    // Threads did not say how long it lasts: it is kept as it is, and the sign-in check says whether it works.
    return { key: pasted.key, expiresAt: null }
  }

  /** Makes a token of 60 days last 60 days again once less than 45 of them are left. Threads renews only a token that is at least a day old. */
  async renewKey(http: HttpPort, key: string, now: Date): Promise<KeptKey | null> {
    const api = new ThreadsApi(http, key)
    const facts = await api.facts()
    if (!facts.ok && tokenRefused(facts)) throw Object.assign(new Error(refusal(facts)), { name: 'LoginRequiredError' })
    const data = facts.ok ? facts.result.data : undefined
    const endsMs = typeof data?.expires_at === 'number' && data.expires_at > 0 ? data.expires_at * 1000 : null
    const madeMs = typeof data?.issued_at === 'number' && data.issued_at > 0 ? data.issued_at * 1000 : null
    if (endsMs !== null && endsMs - now.getTime() > RENEW_BELOW_MS) return null
    if (madeMs !== null && now.getTime() - madeMs < DAY_MS) return null
    const renewed = await api.refresh()
    if (!renewed.ok) throw tokenRefused(renewed) ? Object.assign(new Error(refusal(renewed)), { name: 'LoginRequiredError' }) : new Error(`Threads did not renew the token (${renewed.message}).`)
    if (!renewed.result.access_token) throw new Error('Threads answered the renewal with no token.')
    return { key: renewed.result.access_token, expiresAt: untilOf(now, renewed.result) }
  }

  private async client(ctx: ConnectorContext): Promise<ThreadsApi | null> {
    const token = await ctx.apiKey()
    return token ? new ThreadsApi(ctx.http, token) : null
  }

  private async requireClient(ctx: ConnectorContext): Promise<ThreadsApi> {
    const api = await this.client(ctx)
    if (!api) throw Object.assign(new Error('No Threads access token is saved for this account. Save it on the account\'s page.'), { name: 'LoginRequiredError' })
    return api
  }

  /** Whose token it is: asked from Threads, and remembered until the next sign-in check. */
  private async profile(ctx: ConnectorContext, api: ThreadsApi): Promise<ThreadsProfile> {
    const kept = this.profiles.get(ctx.account.id)
    if (kept) return kept
    const me = await api.get<ThreadsProfile>('me', { fields: PROFILE_FIELDS })
    if (!me.ok) throw unreadable(me)
    this.profiles.set(ctx.account.id, me.result)
    return me.result
  }

  private address(profile: ThreadsProfile): string {
    return profile.username ? `https://www.threads.net/@${profile.username}` : 'https://www.threads.net/'
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    this.profiles.delete(ctx.account.id)
    const api = await this.client(ctx)
    if (!api) return { loggedIn: false, identity: null, captcha: false, signal: 'no Threads access token is saved' }
    const me = await api.get<ThreadsProfile>('me', { fields: PROFILE_FIELDS })
    if (!me.ok) return { loggedIn: false, identity: null, captcha: false, signal: tokenRefused(me) ? 'Threads does not accept the token (it ended or was withdrawn)' : refusal(me) }
    this.profiles.set(ctx.account.id, me.result)
    return { loggedIn: true, identity: me.result.username ? `@${me.result.username}` : (me.result.name ?? me.result.id), captcha: false }
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const all = (status: CapabilityStatus, detail: string): Capability[] =>
      (['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics'] as CapabilityKey[]).map((key) => cap(key, status, detail)).concat(notOffered(cap))
    const api = await this.client(ctx)
    if (!api) return all('needs_user', 'Save the Threads access token on the account\'s page first.')
    this.profiles.delete(ctx.account.id)
    let profile: ThreadsProfile
    try {
      profile = await this.profile(ctx, api)
    } catch (error) {
      return all('needs_user', error instanceof Error ? error.message : String(error))
    }
    const name = profile.username ? `@${profile.username}` : (profile.name ?? profile.id)
    // The channel's address says which profile was meant.
    const wanted = handleOf(ctx.channel.url)
    if (!wanted || !profile.username || wanted !== profile.username.toLowerCase()) {
      return all('needs_user', `The token of this account belongs to the profile ${name} (${this.address(profile)}), and this channel is ${ctx.channel.url}. Connect the address of that profile, or save the token of this one.`)
    }
    const feed = await api.get<ThreadsList<ThreadsMedia>>(`${profile.id}/threads`, { fields: POST_FIELDS, limit: '1' })
    const newest = feed.ok ? (feed.result.data ?? [])[0] : undefined
    const talk = newest ? await api.get<ThreadsList<ThreadsMedia>>(`${newest.id}/conversation`, { fields: REPLY_FIELDS, reverse: 'false' }) : null
    const reads: [CapabilityStatus, string] = !feed.ok ? ['needs_user', refusal(feed)] : ['verified', `The posts of ${name} are read from Threads.`]
    const talks: [CapabilityStatus, string] = !feed.ok
      ? ['needs_user', refusal(feed)]
      : !talk
        ? ['needs_check', 'The profile has no post yet, so reading replies was not tried.']
        : talk.ok
          ? ['verified', 'Replies under the profile\'s posts are read from Threads. It needs the permission threads_read_replies.']
          : ['needs_user', `${refusal(talk)} Reading replies needs the permission threads_read_replies.`]
    return [
      cap('read_posts', ...reads),
      cap('read_comments', ...talks),
      cap('detect_changes', ...reads),
      cap('publish_post', 'verified', `Posts go out as ${name}: words, a link in the words, a topic. A picture or a video is not sent this way: Threads takes one only from a public address. It needs the permission threads_content_publish. Until the app is published in Meta's dashboard (“Go live”), only the people of the app may see what it posts.`),
      cap('publish_reply', 'verified', 'A reply goes under the post or the reply, as the profile. It needs the permission threads_manage_replies.'),
      cap('verify_send', 'verified', 'Threads returns the post or the reply it made.'),
      cap('metrics', 'verified', 'The number of followers; under each post, likes, replies and views. It needs the permission threads_manage_insights.'),
      ...notOffered(cap)
    ]
  }

  private author(ctx: ConnectorContext, profile: ThreadsProfile, item: ThreadsMedia, own: boolean): string {
    // What the profile itself wrote is the account's own: nobody to answer.
    if (own || (item.username !== undefined && item.username === profile.username)) return ctx.account.identity ?? (profile.username ? `@${profile.username}` : profile.id)
    // Threads gives the name of a public profile only.
    return item.username ? `@${item.username}` : 'Somebody on Threads'
  }

  private async discussion(ctx: ConnectorContext, api: ThreadsApi, profile: ThreadsProfile, post: ThreadsMedia): Promise<RemoteDiscussion> {
    const url = post.permalink ?? this.address(profile)
    const postId = externalIdOf(post.id)
    let comments: RemoteComment[] = []
    let incomplete = false
    // Threads says whether a post has replies; a post it says nothing about is asked.
    if (post.has_replies !== false) {
      const list = await api.get<ThreadsList<ThreadsMedia>>(`${post.id}/conversation`, { fields: REPLY_FIELDS, reverse: 'false' })
      if (!list.ok) throw unreadable(list)
      comments = (list.result.data ?? []).map((reply) => ({
        externalId: externalIdOf(reply.id),
        parentExternalId: reply.replied_to?.id ? externalIdOf(reply.replied_to.id) : postId,
        author: this.author(ctx, profile, reply, reply.is_reply_owned_by_me === true),
        body: reply.text ?? '',
        url: reply.permalink ?? url,
        postedAt: iso(reply.timestamp)
      }))
      incomplete = list.result.paging?.next !== undefined
    }
    const body = post.text ?? ''
    const firstLine = body.split('\n')[0] ?? ''
    return {
      externalId: postId,
      url,
      title: firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine,
      author: this.author(ctx, profile, post, true),
      body,
      postedAt: iso(post.timestamp),
      comments,
      ...(incomplete ? { incomplete: true } : {})
    }
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const api = await this.requireClient(ctx)
    const profile = await this.profile(ctx, api)
    const feed = await api.get<ThreadsList<ThreadsMedia>>(`${profile.id}/threads`, { fields: POST_FIELDS, limit: String(Math.max(1, Math.min(options.limit, FEED_LIMIT))) })
    if (!feed.ok) throw unreadable(feed)
    const discussions: RemoteDiscussion[] = []
    // A repost is somebody else's post shown on the profile: not the profile's own, and nothing to answer under it here.
    for (const post of (feed.result.data ?? []).filter((item) => item.media_type !== 'REPOST_FACADE')) discussions.push(await this.discussion(ctx, api, profile, post))
    return { discussions, fetchedAt: ctx.clock.now().toISOString() }
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    const api = await this.requireClient(ctx)
    const id = parseExternalId(discussionExternalId)
    if (!id) return null
    const profile = await this.profile(ctx, api)
    const post = await api.get<ThreadsMedia>(id, { fields: POST_FIELDS })
    if (!post.ok) {
      if (post.code === NO_SUCH_OBJECT || post.status === 404) return null
      throw unreadable(post)
    }
    return this.discussion(ctx, api, profile, post.result)
  }

  async fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]> {
    const api = await this.requireClient(ctx)
    const profile = await this.profile(ctx, api)
    const count = await api.get<ThreadsInsights>(`${profile.id}/threads_insights`, { metric: 'followers_count' })
    const said = count.ok ? (count.result.data ?? []).find((entry) => entry.name === 'followers_count')?.total_value?.value : undefined
    const value = typeof said === 'number' && Number.isInteger(said) && said >= 0 ? said : null
    return [{ key: 'followers', label: 'Followers', value, available: value !== null }]
  }

  async readPostNumbers(ctx: ConnectorContext, posts: { externalId: string; url: string | null }[]): Promise<Record<string, PostNumbers>> {
    const api = await this.requireClient(ctx)
    const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)
    const found: Record<string, PostNumbers> = {}
    for (const post of posts) {
      const id = parseExternalId(post.externalId)
      if (!id) continue
      const insights = await api.get<ThreadsInsights>(`${id}/insights`, { metric: 'views,likes,replies' })
      if (!insights.ok) {
        if (tokenRefused(insights)) throw unreadable(insights)
        continue
      }
      const of = (name: string): number | null => whole((insights.result.data ?? []).find((entry) => entry.name === name)?.values?.[0]?.value)
      found[post.externalId] = { likes: of('likes'), comments: of('replies'), views: of('views') }
    }
    return found
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    const api = await this.client(ctx)
    if (!api) return failed('No Threads access token is saved for this account. Nothing was sent.')
    if (request.attachments.length > 0) return failed(NO_MEDIA)
    const words = wordsWithLink(request)
    if (!words) return failed(request.kind === 'reply' ? 'The reply is empty. Nothing was sent.' : 'The post is empty. Nothing was sent.')
    const form: Record<string, string> = { media_type: 'TEXT', text: words }
    if (request.kind === 'reply') {
      const parent = parseExternalId(request.parentExternalId)
      if (!parent) return failed('The post or the reply this answers was not read through the Threads API, so it cannot be answered there. Nothing was sent.')
      form.reply_to_id = parent
    } else if (request.topicTag) {
      form.topic_tag = request.topicTag
    }
    try {
      const profile = await this.profile(ctx, api)
      // Threads makes a post in two requests: a container that holds it, then the request that publishes the container.
      const container = await api.post<{ id?: string }>(`${profile.id}/threads`, form)
      if (!container.ok) return failed(`${refusal(container)} Nothing was sent.`)
      const containerId = container.result.id
      if (!containerId) return failed('Threads took the post and returned no id for it. Nothing was published.')
      const ready = await this.whenReady(ctx, api, containerId)
      if (ready !== null) return failed(ready)
      return await this.lastStep(api, profile, () => api.post<{ id?: string }>(`${profile.id}/threads_publish`, { creation_id: containerId }))
    } catch (error) {
      // Only the request that publishes can leave a doubt, and it is asked through `lastStep`: anything that fails here failed before it.
      if (error instanceof HttpNoAnswerError) return failed(`Threads did not answer (${error.message}) before anything was published. Nothing was sent.`)
      return failed(error instanceof Error ? error.message : String(error))
    }
  }

  /** Waits until Threads says the container may be published; null when it may, the reason in words when it never will. Nothing is published either way. */
  private async whenReady(ctx: ConnectorContext, api: ThreadsApi, containerId: string): Promise<string | null> {
    for (let look = 0; look < CONTAINER_LOOKS; look += 1) {
      const state = await api.get<ThreadsContainer>(containerId, { fields: 'status,error_message' })
      if (!state.ok) return `${refusal(state)} Nothing was published.`
      const status = state.result.status
      if (status === 'FINISHED') return null
      if (status === 'ERROR' || status === 'EXPIRED') return `Threads could not prepare the post (${state.result.error_message ?? status}). Nothing was published.`
      if (status !== 'IN_PROGRESS') return `Threads answered with a state of the post this application does not know (${String(status)}). Nothing was published.`
      await ctx.pause(CONTAINER_WAIT_MS)
    }
    return 'Threads was still preparing the post after a minute. Nothing was published; send it again.'
  }

  /** The request that publishes. No answer to it, or an error of Threads' own side, leaves it unknown whether Threads made it. */
  private async lastStep(api: ThreadsApi, profile: ThreadsProfile, call: () => Promise<ThreadsAnswer<{ id?: string }>>): Promise<PublishOutcome> {
    let answer: ThreadsAnswer<{ id?: string }>
    try {
      answer = await call()
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `Threads did not answer (${error.message}), so it is not known whether it was published.` }
      throw error
    }
    if (!answer.ok) {
      if (answer.status >= 500) return { status: 'unknown', error: `Threads answered with an error of its own (${answer.message}), so it is not known whether it was published.` }
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    const id = answer.result.id
    if (!id) return { status: 'unknown', error: 'Threads accepted it and returned no id, so it is not known whether it was published.' }
    return { status: 'confirmed', url: await this.addressOf(api, profile, id), externalId: externalIdOf(id) }
  }

  /** The address Threads gives the post or the reply; the profile's own address when Threads does not say. */
  private async addressOf(api: ThreadsApi, profile: ThreadsProfile, id: string): Promise<string> {
    try {
      const made = await api.get<ThreadsMedia>(id, { fields: 'permalink' })
      if (made.ok && made.result.permalink) return made.result.permalink
    } catch {
      // Published all the same.
    }
    return this.address(profile)
  }

  /** Looks in the profile's posts, or in its replies, for what a send with a lost answer may have made: the same words, not older than the attempt. */
  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    const api = await this.requireClient(ctx)
    const profile = await this.profile(ctx, api)
    const floor = earliestCreation(request)
    const words = wordsWithLink(request)
    const made = (item: ThreadsMedia): boolean => sameText(item.text ?? '', words) && Date.parse(iso(item.timestamp) ?? '') >= floor
    const ref = (item: ThreadsMedia): PublishedRef => ({ url: item.permalink ?? this.address(profile), externalId: externalIdOf(item.id) })
    if (request.kind === 'post') {
      const feed = await api.get<ThreadsList<ThreadsMedia>>(`${profile.id}/threads`, { fields: POST_FIELDS, limit: String(FEED_LIMIT) })
      if (!feed.ok) throw unreadable(feed)
      const hit = (feed.result.data ?? []).find(made)
      return hit ? ref(hit) : null
    }
    const parent = parseExternalId(request.parentExternalId)
    if (!parent) throw new Error('The post this reply answers was not read through the Threads API, so the reply cannot be looked for. Look at Threads and say whether it is there.')
    const list = await api.get<ThreadsList<ThreadsMedia>>(`${profile.id}/replies`, { fields: 'id,text,timestamp,permalink,replied_to', limit: String(FEED_LIMIT) })
    if (!list.ok) throw unreadable(list)
    const hit = (list.result.data ?? []).find((item) => made(item) && item.replied_to?.id === parent)
    return hit ? ref(hit) : null
  }
}

/** What the Threads API has no place for here: said, not left out, so the channel's card shows it. */
function notOffered(cap: (key: CapabilityKey, status: CapabilityStatus, detail: string) => Capability): Capability[] {
  return [cap('membership', 'unavailable', 'A profile is not joined: the token is its own.'), cap('read_inbox', 'unavailable', 'Replies arrive as replies under the profile\'s posts.')]
}
