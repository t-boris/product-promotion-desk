import { statSync } from 'node:fs'
import type { Capability, CapabilityKey, CapabilityStatus, Channel, MetricReading } from '../../shared/types'
import type { PostNumbers } from '../../shared/post-numbers'
import { HttpNoAnswerError } from '../../core/net/http'
import { SIGN_IN_CALLBACK } from '../../core/net/sign-in-listener'
import type { ActivityBatch, ApiAccess, ChannelGuide, Connector, ConnectorContext, HttpPort, KeptKey, KeyTimes, LoginState, NormalizedTarget, PublishedRef, PublishOutcome, PublishRequest, RemoteDiscussion, SendTicket, SignInAnswer, SignInAsk } from '../../core/ports'
import { earliestCreation } from '../reconcile'
import { sameText } from '../text'
import { XApi, X_AUTHORIZE, X_SCOPES, askToken, looksLikeClientId, type XAnswer, type XPost, type XToken, type XUser } from './api'

export const X_API_CONNECTOR_ID = 'x-api'

/** What a post made through the API takes, by X's pages. */
const MOST_PICTURES = 4
const MOST_PICTURE_BYTES = 5 * 1024 * 1024
const PICTURES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const GIF = 'image/gif'
/** An access token is taken as ended this long before its end, so a request never carries one that ends on the way. */
const RENEW_AHEAD_MS = 5 * 60_000
/** How many posts' numbers one request asks for. */
const MOST_IDS = 100

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

const NOT_READ = 'Replies and mentions are not read through X\'s API by this application: X charges for every post read, and lets an app reply only to a person who mentioned the account. Read and answer them on X.'

const CONSOLE = 'https://console.x.com'

const API: ApiAccess = {
  accountKind: 'developer app',
  keyLabel: 'Sign-in with X',
  keyName: 'sign-in with X',
  keyId: { label: 'Client ID', hint: 'From “Keys and tokens” of your app in X’s Developer Console. It is no secret; it is kept with the sign-in.' },
  signIn: { label: 'Sign in with X' },
  renewedOnUse: true,
  work: 'The app posts on X as the signed-in account through X’s own API, with no browser, and reads the numbers under its posts. X charges your developer app for each of these. Replies and mentions are not read through the API: those you read and answer on X.',
  steps: [
    {
      text: 'X’s API is paid from credits you buy in its Developer Console. By X’s price list of 28 November 2026: about $0.015 for each post this application makes ($0.20 for a post with a link), about half a cent for a post on each day its numbers are read (the application reads them for 30 days after a post: about $0.15 a post), and about a cent on a day it checks who signed in. Nothing is spent beyond the credits unless you turn on auto-recharge there. Open the console, signed in as the account that will post, and buy credits.',
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
 * An X account worked through X's API with the sign-in of X's own window (DEC-086): a post of words with up to four pictures or one GIF,
 * made by the application at its time, and the numbers under each post. Every request is paid by the owner's developer app, so nothing is
 * read on a schedule but those numbers: the channel is for the owner's own posts, is not read and is never watched in a browser.
 */
export class XApiConnector implements Connector {
  readonly id = X_API_CONNECTOR_ID
  readonly platform = 'x'
  readonly version = '1'
  readonly label = 'X (Twitter)'
  readonly api = API
  readonly postNumberKinds = ['likes', 'comments', 'views'] as const

  /** Who signed in, by account: asked of X once and kept until the next sign-in check (X charges for the read). */
  private readonly users = new Map<string, XUser>()

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
    return false
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
  private async owner(ctx: ConnectorContext): Promise<{ user: XUser & { username: string } } | { problem: string }> {
    const handle = profileOf(ctx.channel.url)
    if (!handle) return { problem: `${ctx.channel.url} is not the address of a profile. Connect the profile that signed in.` }
    const user = await this.user(ctx)
    const username = user.username as string
    if (username.toLowerCase() !== handle) return { problem: `The sign-in is of @${username}, and this channel is the profile of @${handle}. Posts go out only as the account that signed in: connect its own profile, or sign in as @${handle}.` }
    return { user: { ...user, username } }
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const closed = [
      ...(['read_posts', 'read_comments', 'detect_changes', 'publish_reply', 'read_inbox'] as CapabilityKey[]).map((key) => cap(key, 'unavailable', NOT_READ)),
      cap('metrics', 'unavailable', 'The account\'s followers are not read here. Under each post the application reads likes, replies and views for 30 days after it went out; X charges about half a cent for a post on each day it is read (about $0.15 a post).'),
      cap('membership', 'unavailable', 'A profile is not joined: it is the account\'s own.')
    ]
    const stopped = (detail: string): Capability[] => [cap('publish_post', 'needs_user', detail), cap('verify_send', 'needs_user', detail), ...closed]
    let found: Awaited<ReturnType<XApiConnector['owner']>>
    try {
      if (!(await this.client(ctx))) return stopped('Press “Sign in with X” on the account\'s page first.')
      found = await this.owner(ctx)
    } catch (error) {
      return stopped(error instanceof Error ? error.message : String(error))
    }
    if ('problem' in found) return stopped(found.problem)
    return [
      cap(
        'publish_post',
        'needs_check',
        `Posts go out as @${found.user.username}: words with up to ${MOST_PICTURES} pictures (JPEG, PNG or WEBP, 5 MB each) or one GIF. X charges your developer app for each post (about $0.015, or $0.20 with a link) and for reading its numbers. A video and a quote are published on X itself. Tried with the first post.`
      ),
      cap('verify_send', 'needs_check', 'X returns the post it made. Tried with the first post.'),
      ...closed
    ]
  }

  /** Nothing is read: every read is paid, and the owner reads replies on X. The monitor finds no discussion and asks no more. */
  async fetchActivity(ctx: ConnectorContext, _options: { limit: number }): Promise<ActivityBatch> {
    return { discussions: [], fetchedAt: ctx.clock.now().toISOString() }
  }

  async fetchThread(_ctx: ConnectorContext, _discussionExternalId: string): Promise<RemoteDiscussion | null> {
    return null
  }

  async fetchMetrics(_ctx: ConnectorContext): Promise<MetricReading[]> {
    return []
  }

  async readPostNumbers(ctx: ConnectorContext, posts: { externalId: string; url: string | null }[]): Promise<Record<string, PostNumbers>> {
    const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)
    const ids = posts.map((post) => parseExternalId(post.externalId)).filter((id): id is string => id !== null)
    const found: Record<string, PostNumbers> = {}
    for (let from = 0; from < ids.length; from += MOST_IDS) {
      const page = await (await this.requireClient(ctx)).get<{ data?: XPost[] }>('tweets', { ids: ids.slice(from, from + MOST_IDS).join(','), 'tweet.fields': 'public_metrics' })
      if (!page.ok) throw unreadable(page)
      // A post X no longer has is simply not in the answer.
      for (const post of page.result.data ?? []) found[postIdOf(post.id)] = { likes: whole(post.public_metrics?.like_count), comments: whole(post.public_metrics?.reply_count), views: whole(post.public_metrics?.impression_count) }
    }
    return found
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    if (request.kind === 'reply') return failed(`${NOT_READ} Nothing was sent.`)
    const text = request.text.trim()
    const files = request.attachments
    if (text === '' && files.length === 0) return failed('There is nothing to post: no words and no picture. Nothing was sent.')
    const gifs = files.filter((file) => file.mime === GIF)
    const unfit = files.find((file) => file.mime !== GIF && !PICTURES.has(file.mime))
    if (unfit) return failed(`X takes a JPEG, PNG or WEBP picture or a GIF from this application; “${unfit.name}” is none of them. A video is published on X itself. Nothing was sent.`)
    if (gifs.length > 0 && files.length > 1) return failed('X takes one GIF in a post, with no other picture. Nothing was sent.')
    if (files.length > MOST_PICTURES) return failed(`X takes at most ${MOST_PICTURES} pictures in a post; this one has ${files.length}. Nothing was sent.`)
    for (const file of files) {
      let bytes: number
      try {
        bytes = statSync(file.path).size
      } catch {
        return failed(`The picture “${file.name}” could not be read from this Mac. Nothing was sent.`)
      }
      if (bytes > MOST_PICTURE_BYTES) return failed(`X takes a picture up to 5 MB through its API; “${file.name}” is ${Math.ceil(bytes / (1024 * 1024))} MB. Nothing was sent.`)
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
      for (const file of files) {
        const put = await api.upload({ path: file.path, name: file.name, mime: file.mime }, file.mime === GIF ? 'tweet_gif' : 'tweet_image')
        if (!put.ok) return failed(`${refusal(put)} The picture “${file.name}” was not taken. Nothing was sent.`)
        const id = put.result.data?.id
        if (!id) return failed(`X took the picture “${file.name}” and returned no id for it. Nothing was sent.`)
        mediaIds.push(id)
      }
      body = { text, ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}) }
    } catch (error) {
      // Nothing was posted yet: a picture that was uploaded and not attached is seen by nobody.
      if (error instanceof HttpNoAnswerError) return failed(`No answer came from X (${error.message}) before the post was made. Nothing was sent.`)
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    let answer: XAnswer<{ data?: XPost }>
    try {
      answer = await api.post<{ data?: XPost }>('tweets', body)
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `X did not answer (${error.message}), so it is not known whether the post was made.` }
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    if (!answer.ok) {
      if (answer.status >= 500) return { status: 'unknown', error: `X answered with an error of its own (${answer.message}), so it is not known whether the post was made.` }
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    const id = answer.result.data?.id
    if (!id || !/^\d+$/.test(id)) return { status: 'unknown', error: 'X accepted the post and returned no id for it, so it is not known whether it was made.' }
    return { status: 'confirmed', url: addressOf(handle, id), externalId: postIdOf(id) }
  }

  /** Looks among the account's five newest posts for the one a send with a lost answer may have made: the same words, not older than the attempt. */
  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    if (request.kind !== 'post') throw new Error(`${NOT_READ} Look at X and say whether it is there.`)
    const floor = earliestCreation(request)
    const found = await this.owner(ctx)
    if ('problem' in found) throw new Error(found.problem)
    const list = await (await this.requireClient(ctx)).get<{ data?: XPost[] }>(`users/${found.user.id}/tweets`, { max_results: '5', 'tweet.fields': 'created_at', exclude: 'retweets,replies' })
    if (!list.ok) throw unreadable(list)
    // X writes every address in a post as a short one of its own, and adds one for a picture: the words are compared without addresses.
    const plain = (value: string): string => value.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim()
    const hit = (list.result.data ?? []).find((post) => sameText(plain(post.text ?? ''), plain(request.text)) && Date.parse(post.created_at ?? '') >= floor)
    return hit ? { url: addressOf(found.user.username, hit.id), externalId: postIdOf(hit.id) } : null
  }
}
