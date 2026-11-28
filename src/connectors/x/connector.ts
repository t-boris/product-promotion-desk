import { statSync } from 'node:fs'
import { isVideoMime, type Capability, type CapabilityKey, type CapabilityStatus, type Channel, type MetricReading } from '../../shared/types'
import type { PostNumbers } from '../../shared/post-numbers'
import { HttpNoAnswerError } from '../../core/net/http'
import { SIGN_IN_CALLBACK } from '../../core/net/sign-in-listener'
import type { ActivityBatch, ApiAccess, ChannelGuide, Connector, ConnectorContext, HttpPort, KeptKey, KeyTimes, LoginState, NormalizedTarget, PublishedRef, PublishOutcome, PublishRequest, RemoteComment, RemoteDiscussion, SendTicket, SignInAnswer, SignInAsk } from '../../core/ports'
import { earliestCreation } from '../reconcile'
import { sameText } from '../text'
import { XApi, X_AUTHORIZE, X_SCOPES, askToken, looksLikeClientId, type XAnswer, type XList, type XPost, type XToken, type XUser } from './api'

export const X_API_CONNECTOR_ID = 'x-api'

/** What a post made through the API takes, by X's pages. */
const MOST_PICTURES = 4
const MOST_PICTURE_BYTES = 5 * 1024 * 1024
const PICTURES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const GIF = 'image/gif'
/** A video of a post, by X's reference: MP4 or MOV. It goes up in segments of 4 MB (X asks for 5 MB at most), and its processing is waited for up to ten minutes. */
const VIDEOS = new Set(['video/mp4', 'video/quicktime'])
const SEGMENT_BYTES = 4 * 1024 * 1024
const VIDEO_WAIT_MS = 10 * 60_000
/** An access token is taken as ended this long before its end, so a request never carries one that ends on the way. */
const RENEW_AHEAD_MS = 5 * 60_000
/** How far back the account's posts and what was written to it are read: as long as the numbers of a post are. */
const WINDOW_MS = 30 * 24 * 3_600_000
/** One page of a reading, and how many pages one reading asks for at most. */
const PAGE = '100'
const MOST_PAGES = 5
/** How many of the account's posts one check of the channel gives. */
const FEED_LIMIT = 25
/** What is asked of every post that is read as a part of a conversation. */
const TALK_FIELDS = 'created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets'

/**
 * What is read of an account: its own posts and answers, and what was written to it, of the last 30 days. Kept while the application runs, so
 * X is asked only for what is newer than what is here: X charges for every post it gives, once a day.
 */
interface Talk {
  /** The id of the user it was read for: another one signing in starts anew. */
  who: string
  own: Map<string, XPost>
  said: Map<string, XPost>
  /** The handle of each person who wrote, by their id. */
  names: Map<string, string>
}

const isId = (id: unknown): id is string => typeof id === 'string' && /^\d{1,25}$/.test(id)

const iso = (time: string | undefined): string | null => (time && !Number.isNaN(Date.parse(time)) ? new Date(Date.parse(time)).toISOString() : null)

/** The newest of the posts, by its id: ids grow with time. */
function newestOf(posts: Map<string, XPost>): string | null {
  let top: bigint | null = null
  for (const id of posts.keys()) {
    const value = BigInt(id)
    if (top === null || value > top) top = value
  }
  return top === null ? null : top.toString()
}

/** The post another one answers; null for a post that starts a conversation. */
const answered = (post: XPost): string | null => {
  const id = post.referenced_tweets?.find((ref) => ref.type === 'replied_to')?.id
  return isId(id) ? id : null
}

/** A reply as X's pages show it: without the names it begins with, which X puts there for the people it answers. */
const withoutNames = (text: string): string => text.replace(/^(?:@\w{1,15}\s+)+/, '')

/** X writes every address in a post as a short one of its own, and adds one for a picture: words are compared without addresses. */
const plain = (value: string): string => withoutNames(value).replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim()

const HOST = /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\//i
/** First words of an address that are pages of X itself, not a profile. */
const NOT_A_PROFILE = new Set(['home', 'explore', 'search', 'i', 'settings', 'notifications', 'messages', 'compose', 'hashtag', 'intent', 'share', 'login', 'signup', 'tos', 'privacy', 'jobs', 'about'])

/** The profile an address names ("x.com/name"): the handle in lower case. Null for a post, a list, a search or a page of X itself. */
export function profileOf(input: string): string | null {
  const typed = input.trim()
  if (!HOST.test(typed)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 1) return null
  const handle = (parts[0] as string).replace(/^@/, '').toLowerCase()
  return /^[a-z0-9_]{1,15}$/.test(handle) && !NOT_A_PROFILE.has(handle) ? handle : null
}

/** A post's id as the application stores it. */
export const postIdOf = (id: string): string => `x:${id}`

export function parseExternalId(id: string | null): string | null {
  const hit = /^x:(\d+)$/.exec(id ?? '')
  return hit ? (hit[1] as string) : null
}

const addressOf = (handle: string, id: string): string => `https://x.com/${handle}/status/${id}`

/** What the vault keeps for an X account, as one word: the app's Client ID, the access token of two hours, and the refresh token that gives the next pair. */
interface Kept {
  c: string
  a: string
  r: string
}

function parseKept(key: string): Kept | null {
  try {
    const kept = JSON.parse(key) as Partial<Kept>
    return typeof kept.c === 'string' && typeof kept.a === 'string' && typeof kept.r === 'string' ? { c: kept.c, a: kept.a, r: kept.r } : null
  } catch {
    return null
  }
}

type Refusal = Extract<XAnswer<unknown>, { ok: false }>

/** The signed-in user, whose handle X named. */
type Me = XUser & { username: string }

const signInAgain = (said: string): Error => Object.assign(new Error(`X no longer accepts the saved sign-in (${said}). Press “Sign in with X” on the account's page again.`), { name: 'LoginRequiredError' })

/** What X refused, in words. */
function refusal(answer: Refusal): string {
  if (answer.status === 401) return `X no longer accepts the saved sign-in (${answer.message}). Press “Sign in with X” on the account's page again.`
  if (answer.status === 429) return `X asks to wait before the next request (${answer.message}).`
  if (answer.status === 402 || /usage-capped|credits/i.test(`${answer.type} ${answer.message}`)) return `X did not take it for a reason of payment (${answer.message}). See the credits and the limits of your app in X's Developer Console.`
  if (answer.status === 403) return `X does not allow it (${answer.message}).`
  return `X refused it: ${answer.message}`
}

const unreadable = (answer: Refusal): Error => (answer.status === 401 ? signInAgain(answer.message) : new Error(refusal(answer)))

const failed = (error: string): PublishOutcome => ({ status: 'failed', error })

/** The pair X gave, as the vault keeps it with the app's id, and when its access token ends. */
function keptFrom(clientId: string, token: XToken, now: Date): KeptKey {
  if (!token.access_token || !token.refresh_token) throw new Error('X answered without the tokens of a sign-in that stays (the permission “offline.access”). Nothing was saved.')
  const lasts = typeof token.expires_in === 'number' && token.expires_in > 0 ? token.expires_in : 7_200
  return { key: JSON.stringify({ c: clientId, a: token.access_token, r: token.refresh_token } satisfies Kept), expiresAt: new Date(now.getTime() + lasts * 1000).toISOString() }
}

/** X's rule for an answer made through its API (its pages on making posts, read 2026-11-28). */
const REPLY_RULE = 'X lets an app answer only a post that names the account, as a reply to it does.'

const CONSOLE = 'https://console.x.com'

const API: ApiAccess = {
  accountKind: 'developer app',
  keyLabel: 'Sign-in with X',
  keyName: 'sign-in with X',
  keyId: { label: 'Client ID', hint: 'From “Keys and tokens” of your app in X’s Developer Console. It is no secret; it is kept with the sign-in.' },
  signIn: { label: 'Sign in with X' },
  renewedOnUse: true,
  work: 'The app works on X as the signed-in account through X’s own API, with no browser: it posts, reads the replies people write to the account’s posts, sends your answers to them, and reads the numbers under each post. X charges your developer app for each of these.',
  steps: [
    {
      text: 'X’s API is paid from credits you buy in its Developer Console. By X’s price list of 28 November 2026: about $0.015 for each post this application makes ($0.20 for a post with a link) and $0.01 for each answer to a reply. Reading costs a tenth of a cent for each of the account’s posts and each reply to it on a day it is read (five times that when the app belongs to another account than the one that signs in), so the numbers of a post, read for 30 days, cost about $0.03; X may add up to a cent for the name of each person who wrote a reply, and takes about a cent on a day the application checks who signed in. Nothing is spent beyond the credits unless you turn on auto-recharge there. Open the console, signed in as the account that will post, and buy credits.',
      url: CONSOLE,
      link: 'Open X’s Developer Console'
    },
    {
      text: `Create an app there, or open the one you have. In its authentication settings turn on OAuth 2.0, choose the type “Native App”, and add this callback address exactly as it is written: ${SIGN_IN_CALLBACK}`,
      url: CONSOLE,
      link: 'Open X’s Developer Console'
    },
    { text: 'Copy the app’s “Client ID” from “Keys and tokens” and paste it below.' },
    {
      text: 'Press “Sign in with X”. X’s page opens in this account’s browser: sign in as the account that will post and press “Authorize app”. The application waits ten minutes for it, keeps what X gives in the vault of this Mac, and renews it by itself from then on.'
    }
  ],
  // Nothing is pasted for this account: what the vault keeps comes from the sign-in.
  keyLooksValid: () => false
}

/**
 * An X account worked through X's API with the sign-in of X's own window (DEC-086, DEC-087): a post of words with up to four pictures or one
 * GIF, made by the application at its time; the replies people write to the account's posts, read from the account's own posts and from what
 * names it, and the owner's answers to them; the numbers under each post. Every request is paid by the owner's developer app, so X is asked
 * only for what is newer than what was read, and through the addresses X prices lowest for an account's own data.
 */
export class XApiConnector implements Connector {
  readonly id = X_API_CONNECTOR_ID
  readonly platform = 'x'
  readonly version = '2'
  readonly label = 'X (Twitter)'
  readonly api = API
  readonly postNumberKinds = ['likes', 'comments', 'views'] as const

  /** Who signed in, by account: asked of X once and kept until the next sign-in check (X charges for the read). */
  private readonly users = new Map<string, XUser>()
  /** What was read of each account, kept while the application runs. */
  private readonly talks = new Map<string, Talk>()

  matches(input: string): boolean {
    return profileOf(input) !== null
  }

  normalizeTarget(input: string): NormalizedTarget {
    const handle = profileOf(input)
    if (!handle) throw new Error('Give the address of the profile that signed in, like https://x.com/yourbrand.')
    return { target: `x.com/${handle}`, url: `https://x.com/${handle}` }
  }

  loginUrl(): string {
    return CONSOLE
  }

  channelGuide(): ChannelGuide {
    return { browseUrl: 'https://x.com/', example: 'https://x.com/yourbrand', hint: 'The address of the profile that signed in for this account.' }
  }

  readsChannel(_channel: Channel): boolean {
    return true
  }

  signInUrl(ask: SignInAsk): string {
    const query = new URLSearchParams({ response_type: 'code', client_id: ask.keyId, redirect_uri: ask.redirectUri, scope: X_SCOPES, state: ask.state, code_challenge: ask.challenge, code_challenge_method: 'S256' })
    return `${X_AUTHORIZE}?${query.toString().replaceAll('+', '%20')}`
  }

  async keyFromSignIn(http: HttpPort, answer: SignInAnswer, now: Date): Promise<KeptKey> {
    if (!looksLikeClientId(answer.keyId)) throw new Error('This does not look like a Client ID: it is one word from “Keys and tokens” of your app. Nothing was saved.')
    let token: XAnswer<XToken>
    try {
      token = await askToken(http, { grant_type: 'authorization_code', code: answer.code, client_id: answer.keyId, redirect_uri: answer.redirectUri, code_verifier: answer.verifier })
    } catch (error) {
      throw new Error(`X did not answer (${error instanceof Error ? error.message : String(error)}), so the sign-in could not be finished. Nothing was saved; press “Sign in with X” again.`, { cause: error })
    }
    if (!token.ok) throw new Error(`X did not finish the sign-in (${token.message}). Check that the app is a “Native App” with OAuth 2.0 turned on and that its callback address is ${SIGN_IN_CALLBACK}. Nothing was saved.`)
    return keptFrom(answer.keyId, token.result, now)
  }

  /** The next pair of tokens for a kept one whose access token has ended or ends in minutes; null while it still lasts. */
  async renewKey(http: HttpPort, key: string, now: Date, times: KeyTimes): Promise<KeptKey | null> {
    if (times.expiresAt && Date.parse(times.expiresAt) - now.getTime() > RENEW_AHEAD_MS) return null
    const kept = parseKept(key)
    if (!kept) throw signInAgain('what is saved is not a sign-in')
    const token = await askToken(http, { grant_type: 'refresh_token', refresh_token: kept.r, client_id: kept.c })
    if (!token.ok) throw token.status >= 500 || token.status === 429 ? new Error(refusal(token)) : signInAgain(token.message)
    return keptFrom(kept.c, token.result, now)
  }

  /** A client with the account's access token; null when nobody signed in. It throws what X said when the sign-in is no longer accepted. */
  private async client(ctx: ConnectorContext): Promise<XApi | null> {
    const key = await ctx.apiKey()
    if (!key) return null
    const kept = parseKept(key)
    if (!kept) throw signInAgain('what is saved is not a sign-in')
    return new XApi(ctx.http, kept.a)
  }

  private async requireClient(ctx: ConnectorContext): Promise<XApi> {
    const api = await this.client(ctx)
    if (!api) throw Object.assign(new Error('Nobody signed in to X for this account. Press “Sign in with X” on the account\'s page.'), { name: 'LoginRequiredError' })
    return api
  }

  /** Who signed in: asked of X, and remembered until the next sign-in check. */
  private async user(ctx: ConnectorContext): Promise<XUser> {
    const kept = this.users.get(ctx.account.id)
    if (kept) return kept
    const me = await (await this.requireClient(ctx)).get<{ data?: XUser }>('users/me')
    if (!me.ok) throw unreadable(me)
    if (!me.result.data?.id || !me.result.data.username) throw new Error('X did not say who signed in.')
    this.users.set(ctx.account.id, me.result.data)
    return me.result.data
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    // Another user may have signed in: who it is is asked again. What was read is kept for as long as it is the same user.
    this.users.delete(ctx.account.id)
    const said = (signal: string): LoginState => ({ loggedIn: false, identity: null, captcha: false, signal })
    try {
      if (!(await this.client(ctx))) return said('nobody signed in to X for this account')
      return { loggedIn: true, identity: `@${(await this.user(ctx)).username}`, captcha: false }
    } catch (error) {
      if (error instanceof HttpNoAnswerError) throw error
      return said(error instanceof Error ? error.message : String(error))
    }
  }

  /** The signed-in user when the channel is their own profile; the reason in words when it is another's. */
  private async owner(ctx: ConnectorContext): Promise<{ user: Me } | { problem: string }> {
    const handle = profileOf(ctx.channel.url)
    if (!handle) return { problem: `${ctx.channel.url} is not the address of a profile. Connect the profile that signed in.` }
    const user = await this.user(ctx)
    const username = user.username as string
    if (username.toLowerCase() !== handle) return { problem: `The sign-in is of @${username}, and this channel is the profile of @${handle}. Posts go out only as the account that signed in: connect its own profile, or sign in as @${handle}.` }
    return { user: { ...user, username } }
  }

  private async requireOwner(ctx: ConnectorContext): Promise<Me> {
    const found = await this.owner(ctx)
    if ('problem' in found) throw new Error(found.problem)
    return found.user
  }

  /** Reads a list page by page, newest first, as far as X gives it and at most `MOST_PAGES` pages. */
  private async pages(api: XApi, path: string, params: Record<string, string>): Promise<{ posts: XPost[]; users: XUser[] }> {
    const posts: XPost[] = []
    const users: XUser[] = []
    let next: string | undefined
    for (let page = 0; page < MOST_PAGES; page += 1) {
      const got = await api.get<XList>(path, { ...params, ...(next ? { pagination_token: next } : {}) })
      if (!got.ok) throw unreadable(got)
      posts.push(...(got.result.data ?? []))
      users.push(...(got.result.includes?.users ?? []))
      next = got.result.meta?.next_token
      if (!next) break
    }
    return { posts, users }
  }

  /**
   * The account's own posts and answers and what was written to it, brought up to now: X is asked for what is newer than the newest post kept
   * (everything of the last 30 days the first time), through the two addresses it prices as an account's own data.
   */
  private async talk(ctx: ConnectorContext, user: Me): Promise<Talk> {
    const api = await this.requireClient(ctx)
    const kept = this.talks.get(ctx.account.id)
    const talk: Talk = kept?.who === user.id ? kept : { who: user.id, own: new Map<string, XPost>(), said: new Map<string, XPost>(), names: new Map<string, string>() }
    const floorMs = ctx.clock.now().getTime() - WINDOW_MS
    const from = (kept: Map<string, XPost>): Record<string, string> => {
      const newest = newestOf(kept)
      return newest ? { since_id: newest } : { start_time: new Date(floorMs).toISOString().replace(/\.\d{3}Z$/, 'Z') }
    }
    const own = await this.pages(api, `users/${user.id}/tweets`, { max_results: PAGE, 'tweet.fields': TALK_FIELDS, exclude: 'retweets', ...from(talk.own) })
    const said = await this.pages(api, `users/${user.id}/mentions`, { max_results: PAGE, 'tweet.fields': TALK_FIELDS, expansions: 'author_id', 'user.fields': 'username', ...from(talk.said) })
    for (const post of own.posts) if (isId(post.id)) talk.own.set(post.id, post)
    for (const post of said.posts) if (isId(post.id) && post.author_id !== user.id) talk.said.set(post.id, post)
    for (const person of said.users) if (person.username) talk.names.set(person.id, person.username)
    for (const posts of [talk.own, talk.said]) for (const [id, post] of posts) if (Date.parse(post.created_at ?? '') < floorMs) posts.delete(id)
    this.talks.set(ctx.account.id, talk)
    return talk
  }

  /** A post of the account with what was said under it: the replies that name the account and the account's own answers, oldest first. */
  private discussion(ctx: ConnectorContext, user: Me, talk: Talk, root: XPost): RemoteDiscussion {
    const me = ctx.account.identity ?? `@${user.username}`
    const inside = [...talk.own.values(), ...talk.said.values()].filter((post) => post.id !== root.id && post.conversation_id === root.id)
    inside.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    const comments: RemoteComment[] = inside.map((post) => {
      const mine = talk.own.has(post.id)
      const name = mine ? user.username : talk.names.get(post.author_id ?? '')
      return {
        externalId: postIdOf(post.id),
        parentExternalId: postIdOf(answered(post) ?? root.id),
        // What the account itself wrote is the account's own: nobody to answer.
        author: mine ? me : name ? `@${name}` : 'Somebody on X',
        body: withoutNames(post.text ?? ''),
        url: name ? addressOf(name, post.id) : `https://x.com/i/status/${post.id}`,
        postedAt: iso(post.created_at)
      }
    })
    const body = root.text ?? ''
    const firstLine = body.split('\n')[0] ?? ''
    return { externalId: postIdOf(root.id), url: addressOf(user.username, root.id), title: firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine, author: me, body, postedAt: iso(root.created_at), comments }
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const notOffered = [
      cap('metrics', 'unavailable', 'The account\'s followers are not read here. Under each post the application reads likes, replies and views for 30 days after it went out; X charges a tenth of a cent for a post on each day it is read (about $0.03 a post).'),
      cap('membership', 'unavailable', 'A profile is not joined: it is the account\'s own.'),
      cap('read_inbox', 'unavailable', 'Replies arrive as replies to the account\'s posts. A post of somebody else that names the account is not collected.')
    ]
    const all = (status: CapabilityStatus, detail: string): Capability[] =>
      (['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send'] as CapabilityKey[]).map((key) => cap(key, status, detail)).concat(notOffered)
    let found: Awaited<ReturnType<XApiConnector['owner']>>
    try {
      if (!(await this.client(ctx))) return all('needs_user', 'Press “Sign in with X” on the account\'s page first.')
      found = await this.owner(ctx)
    } catch (error) {
      return all('needs_user', error instanceof Error ? error.message : String(error))
    }
    if ('problem' in found) return all('needs_user', found.problem)
    const name = `@${found.user.username}`
    let reads: [CapabilityStatus, string]
    let talks: [CapabilityStatus, string]
    try {
      await this.talk(ctx, found.user)
      reads = ['verified', `The posts of ${name} of the last 30 days are read from X.`]
      talks = ['verified', `Replies to the posts of ${name} are read from X: those that name the account, as a reply does unless its writer took the name out. X charges a tenth of a cent for each.`]
    } catch (error) {
      reads = talks = ['needs_user', error instanceof Error ? error.message : String(error)]
    }
    return [
      cap('read_posts', ...reads),
      cap('read_comments', ...talks),
      cap('detect_changes', ...reads),
      cap(
        'publish_post',
        'needs_check',
        `Posts go out as ${name}: words with up to ${MOST_PICTURES} pictures (JPEG, PNG or WEBP, 5 MB each), one GIF, or one MP4 or MOV video (how long a video may be is set by the account: 20 minutes without X Premium). X charges your developer app for each post (about $0.015, or $0.20 with a link). A quote is published on X itself. Tried with the first post.`
      ),
      cap('publish_reply', 'needs_check', `An answer goes under a reply as ${name}. ${REPLY_RULE} X charges about $0.01 for an answer. Tried with the first answer.`),
      cap('verify_send', 'needs_check', 'X returns the post it made. Tried with the first post.'),
      ...notOffered
    ]
  }

  /** The account's newest posts, each with the replies to it. */
  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const user = await this.requireOwner(ctx)
    const talk = await this.talk(ctx, user)
    const posts = [...talk.own.values()].filter((post) => answered(post) === null)
    posts.sort((a, b) => (BigInt(a.id) > BigInt(b.id) ? -1 : 1))
    const discussions = posts.slice(0, Math.max(1, Math.min(options.limit, FEED_LIMIT))).map((post) => this.discussion(ctx, user, talk, post))
    return { discussions, fetchedAt: ctx.clock.now().toISOString() }
  }

  /** One post of the account with the replies to it. A post older than what is kept is asked of X by its id. */
  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    const id = parseExternalId(discussionExternalId)
    if (!id) return null
    const user = await this.requireOwner(ctx)
    const talk = await this.talk(ctx, user)
    let root = talk.own.get(id)
    if (!root) {
      const asked = await (await this.requireClient(ctx)).get<{ data?: XPost[] }>('tweets', { ids: id, 'tweet.fields': TALK_FIELDS })
      if (!asked.ok) throw unreadable(asked)
      root = (asked.result.data ?? []).find((post) => post.id === id && post.author_id === user.id)
    }
    // Only a post of the account that starts a conversation is a discussion of this channel.
    if (!root || answered(root) !== null) return null
    return this.discussion(ctx, user, talk, root)
  }

  async fetchMetrics(_ctx: ConnectorContext): Promise<MetricReading[]> {
    return []
  }

  /** The numbers of the account's posts, read from its own list of posts between the oldest and the newest of those asked for. */
  async readPostNumbers(ctx: ConnectorContext, posts: { externalId: string; url: string | null }[]): Promise<Record<string, PostNumbers>> {
    const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)
    const wanted = new Set(posts.map((post) => parseExternalId(post.externalId)).filter((id): id is string => id !== null))
    if (wanted.size === 0) return {}
    const user = await this.requireOwner(ctx)
    const ids = [...wanted].map((id) => BigInt(id))
    const oldest = ids.reduce((a, b) => (a < b ? a : b))
    const newest = ids.reduce((a, b) => (a > b ? a : b))
    const read = await this.pages(await this.requireClient(ctx), `users/${user.id}/tweets`, {
      max_results: PAGE,
      'tweet.fields': 'public_metrics',
      exclude: 'retweets,replies',
      since_id: (oldest - BigInt(1)).toString(),
      until_id: (newest + BigInt(1)).toString()
    })
    const found: Record<string, PostNumbers> = {}
    // A post X no longer has is simply not in the answer.
    for (const post of read.posts) {
      if (wanted.has(post.id)) found[postIdOf(post.id)] = { likes: whole(post.public_metrics?.like_count), comments: whole(post.public_metrics?.reply_count), views: whole(post.public_metrics?.impression_count) }
    }
    return found
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    const reply = request.kind === 'reply'
    const parent = reply ? parseExternalId(request.parentExternalId) : null
    if (reply && !parent) return failed('The reply or the post this answers was not read through X\'s API, so it cannot be answered there. Nothing was sent.')
    const text = request.text.trim()
    const files = request.attachments
    if (text === '' && files.length === 0) return failed(`There is nothing to ${reply ? 'answer with' : 'post'}: no words and no picture. Nothing was sent.`)
    const gifs = files.filter((file) => file.mime === GIF)
    const video = files.find((file) => isVideoMime(file.mime))
    const unfit = files.find((file) => file.mime !== GIF && !PICTURES.has(file.mime) && !VIDEOS.has(file.mime))
    if (unfit) return failed(`X takes a JPEG, PNG or WEBP picture, a GIF, or an MP4 or MOV video from this application; “${unfit.name}” is none of them. Nothing was sent.`)
    if (video && files.length > 1) return failed('X takes one video in a post, with no picture beside it. Nothing was sent.')
    if (gifs.length > 0 && files.length > 1) return failed('X takes one GIF in a post, with no other picture. Nothing was sent.')
    if (files.length > MOST_PICTURES) return failed(`X takes at most ${MOST_PICTURES} pictures in a post; this one has ${files.length}. Nothing was sent.`)
    let videoBytes = 0
    for (const file of files) {
      const what = file === video ? 'video' : 'picture'
      let bytes: number
      try {
        bytes = statSync(file.path).size
      } catch {
        return failed(`The ${what} “${file.name}” could not be read from this Mac. Nothing was sent.`)
      }
      if (file === video) {
        if (bytes === 0) return failed(`The video “${file.name}” is empty. Nothing was sent.`)
        videoBytes = bytes
      } else if (bytes > MOST_PICTURE_BYTES) return failed(`X takes a picture up to 5 MB through its API; “${file.name}” is ${Math.ceil(bytes / (1024 * 1024))} MB. Nothing was sent.`)
    }
    let api: XApi
    let handle: string
    let body: Record<string, unknown>
    try {
      const found = await this.owner(ctx)
      if ('problem' in found) return failed(`${found.problem} Nothing was sent.`)
      handle = found.user.username
      api = await this.requireClient(ctx)
      const mediaIds: string[] = []
      if (video) {
        const put = await this.uploadVideo(ctx, api, video, videoBytes)
        if ('problem' in put) return failed(`${put.problem} Nothing was sent.`)
        mediaIds.push(put.id)
      }
      for (const file of video ? [] : files) {
        const put = await api.upload({ path: file.path, name: file.name, mime: file.mime }, file.mime === GIF ? 'tweet_gif' : 'tweet_image')
        if (!put.ok) return failed(`${refusal(put)} The picture “${file.name}” was not taken. Nothing was sent.`)
        const id = put.result.data?.id
        if (!id) return failed(`X took the picture “${file.name}” and returned no id for it. Nothing was sent.`)
        mediaIds.push(id)
      }
      body = { text, ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}), ...(parent ? { reply: { in_reply_to_tweet_id: parent } } : {}) }
    } catch (error) {
      // Nothing was posted yet: a picture that was uploaded and not attached is seen by nobody.
      if (error instanceof HttpNoAnswerError) return failed(`No answer came from X (${error.message}) before the post was made. Nothing was sent.`)
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    const what = reply ? 'answer' : 'post'
    let answer: XAnswer<{ data?: XPost }>
    try {
      answer = await api.post<{ data?: XPost }>('tweets', body)
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `X did not answer (${error.message}), so it is not known whether the ${what} was made.` }
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    if (!answer.ok) {
      if (answer.status >= 500) return { status: 'unknown', error: `X answered with an error of its own (${answer.message}), so it is not known whether the ${what} was made.` }
      // X refuses an answer to a post that does not name the account: said with X's rule, so the owner knows to answer on X.
      if (reply && answer.status === 403) return failed(`${refusal(answer)} ${REPLY_RULE} Answer this one on X. Nothing was sent.`)
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    const id = answer.result.data?.id
    if (!isId(id)) return { status: 'unknown', error: `X accepted the ${what} and returned no id for it, so it is not known whether it was made.` }
    return { status: 'confirmed', url: addressOf(handle, id), externalId: postIdOf(id) }
  }

  /** Looks among the account's posts for the one a send with a lost answer may have made: the same words, in the same place, not older than the attempt. */
  /**
   * A video on its way to a post (X's chunked upload): started, sent in segments, closed, and waited for while X processes it, asking again
   * when X says to. Nothing is posted by any of it: a video that is uploaded and not attached is seen by nobody.
   */
  private async uploadVideo(ctx: ConnectorContext, api: XApi, video: { name: string; path: string; mime: string }, bytes: number): Promise<{ id: string } | { problem: string }> {
    const notTaken = `The video “${video.name}” was not taken.`
    const started = await api.startUpload(video.mime, bytes)
    if (!started.ok) return { problem: `${refusal(started)} ${notTaken}` }
    const id = started.result.data?.id
    if (!id) return { problem: `X started the upload of the video “${video.name}” and returned no id for it.` }
    for (let index = 0, start = 0; start < bytes; index += 1, start += SEGMENT_BYTES) {
      const sent = await api.appendUpload(id, index, { path: video.path, name: video.name, mime: video.mime, part: { start, end: Math.min(start + SEGMENT_BYTES, bytes) } })
      if (!sent.ok) return { problem: `${refusal(sent)} ${notTaken}` }
    }
    let state = await api.finishUpload(id)
    for (let waited = 0; ; ) {
      if (!state.ok) return { problem: `${refusal(state)} ${notTaken}` }
      const processing = state.result.data?.processing_info
      if (!processing || processing.state === 'succeeded') return { id }
      if (processing.state === 'failed') return { problem: `X could not process the video “${video.name}”.` }
      if (waited >= VIDEO_WAIT_MS) return { problem: `X was still processing the video “${video.name}” after ten minutes.` }
      // X says when to ask again; never sooner than a second, never later than half a minute.
      const wait = Math.min(Math.max(processing.check_after_secs ?? 1, 1), 30) * 1000
      await ctx.pause(wait)
      waited += wait
      state = await api.uploadState(id)
    }
  }

  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    const floor = earliestCreation(request)
    const user = await this.requireOwner(ctx)
    const parent = request.kind === 'reply' ? parseExternalId(request.parentExternalId) : null
    if (request.kind === 'reply' && !parent) throw new Error('The reply this answers was not read through X\'s API, so the answer cannot be looked for. Look at X and say whether it is there.')
    const talk = await this.talk(ctx, user)
    const hit = [...talk.own.values()].find((post) => answered(post) === parent && sameText(plain(post.text ?? ''), plain(request.text)) && Date.parse(post.created_at ?? '') >= floor)
    return hit ? { url: addressOf(user.username, hit.id), externalId: postIdOf(hit.id) } : null
  }
}
