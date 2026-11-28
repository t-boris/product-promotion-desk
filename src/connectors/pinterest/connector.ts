import { readFileSync, statSync } from 'node:fs'
import { isVideoMime, type Capability, type CapabilityKey, type CapabilityStatus, type Channel, type MetricReading } from '../../shared/types'
import type { PostNumbers } from '../../shared/post-numbers'
import { HttpNoAnswerError } from '../../core/net/http'
import type { ActivityBatch, ApiAccess, ChannelGuide, Connector, ConnectorContext, HttpPort, KeptKey, LoginState, NormalizedTarget, PublishedRef, PublishOutcome, PublishRequest, RemoteDiscussion, SendTicket } from '../../core/ports'
import { earliestCreation } from '../reconcile'
import { sameText } from '../text'
import { PinterestApi, askToken, looksLikeAppId, looksLikeSecretKey, type PinterestAccount, type PinterestAnswer, type PinterestBoard, type PinterestList, type PinterestMedia, type PinterestPin, type PinterestPinNumbers } from './api'

export const PINTEREST_API_CONNECTOR_ID = 'pinterest-api'

/** What a pin made through the API takes, by Pinterest's pages. */
const MOST_TITLE = 100
const MOST_DESCRIPTION = 800
const MOST_LINK = 2_048
const MOST_PICTURE_BYTES = 20 * 1024 * 1024
const MOST_CAROUSEL_PICTURES = 5
const PICTURES = new Set(['image/jpeg', 'image/png'])
/** A video of a pin, by Pinterest's pages: MP4, MOV or M4V, up to 2 GB. */
const VIDEOS = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v'])
const MOST_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
/** How long the upload of a video may take, and how its processing is asked about: every five seconds, for ten minutes. */
const UPLOAD_TIMEOUT_MS = 30 * 60_000
const VIDEO_LOOK_MS = 5_000
const VIDEO_LOOKS = 120
/** One page of the account's boards or pins; boards are read to the end, up to this many pages. */
const PAGE = 100
const MOST_PAGES = 10
/** Impressions are counted for the days Pinterest gives at most: 90, today included. */
const NUMBER_DAYS = 90
const DAY_MS = 24 * 3_600_000

const HOST = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?pinterest\.com\//i
/** First words of an address that are pages of Pinterest itself, and second words that are parts of a profile, not a board. */
const NOT_A_PROFILE = new Set(['pin', 'ideas', 'search', 'business', 'settings', 'today', 'oauth', 'login', 'signup', 'about', 'explore', 'resource', 'categories', 'topics', 'videos', 'shopping', '_'])
const NOT_A_BOARD = new Set(['_saved', '_created', '_pins', '_profile', 'pins', 'boards', 'followers', 'following'])

/** The words of a board's name or of its address, made comparable: lower case, everything that is no letter or digit as one hyphen. */
export const boardWords = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')

/** The board an address names ("pinterest.com/name/board"): the account's name in lower case and the board's part of the address. Null for anything else. */
export function boardOf(input: string): { user: string; board: string } | null {
  const typed = input.trim()
  if (!HOST.test(typed)) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(typed) ? typed : `https://${typed}`)
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  let user: string
  let board: string
  try {
    user = decodeURIComponent(parts[0] as string).toLowerCase()
    board = decodeURIComponent(parts[1] as string).toLowerCase()
  } catch {
    return null
  }
  if (!/^[a-z0-9_]{3,30}$/.test(user) || NOT_A_PROFILE.has(user) || NOT_A_BOARD.has(board) || boardWords(board) === '') return null
  return { user, board }
}

/** A pin's id as the application stores it. */
export const pinIdOf = (id: string): string => `pin:${id}`

export function parseExternalId(id: string | null): string | null {
  const hit = /^pin:(\d+)$/.exec(id ?? '')
  return hit ? (hit[1] as string) : null
}

const addressOf = (pinId: string): string => `https://www.pinterest.com/pin/${pinId}/`

type Refusal = Extract<PinterestAnswer<unknown>, { ok: false }>

const keyRefused = (answer: Refusal): boolean => answer.status === 401

/** What Pinterest refused, in words. */
function refusal(answer: Refusal): string {
  if (keyRefused(answer)) return `Pinterest does not accept the app id and the app secret key (${answer.message}). See both on the app's page in “My apps” and save them again on the account's page; the account that owns the app needs two-factor authentication.`
  if (answer.status === 429) return `Pinterest asks to wait before the next request (${answer.message}).`
  if (answer.status === 403) return `Pinterest does not allow it (${answer.message}). An app registered after 14 September 2026 reads boards and pins only of a business account.`
  return `Pinterest refused it: ${answer.message}`
}

function unreadable(answer: Refusal): Error {
  const error = new Error(refusal(answer))
  return keyRefused(answer) ? Object.assign(error, { name: 'LoginRequiredError' }) : error
}

const failed = (error: string): PublishOutcome => ({ status: 'failed', error })

const NO_COMMENTS = 'Pinterest\'s API has no comments: they are read and answered on Pinterest.'

const APPS = 'https://developers.pinterest.com/apps/'

const API: ApiAccess = {
  accountKind: 'developer app',
  keyLabel: 'App secret key',
  keyName: 'Pinterest app secret key',
  keyId: { label: 'App id', hint: 'The number under the app’s name in “My apps”. It is no secret; it is kept with the secret key.' },
  work: 'The app creates pins on the boards of the Pinterest account that owns this developer app, with no browser, and reads the numbers under them. Pinterest’s API has no comments: those you read and answer on Pinterest.',
  steps: [
    {
      text: 'A Pinterest app is registered from a business account, and its pins go to the boards of that same account. The account needs two-factor authentication turned on: Pinterest gives an app a token of its own only then.',
      url: 'https://help.pinterest.com/article/two-factor-authentication',
      link: 'Open Pinterest’s page on two-factor authentication'
    },
    {
      text: 'Open “My apps”, accept the developer terms, press “Connect app” and fill in the form (the app’s name needs 3 Latin letters or digits and cannot hold the word “Pinterest”). Pinterest reviews the request and writes an e-mail; the app then has Trial access.',
      url: APPS,
      link: 'Open “My apps”'
    },
    {
      text: 'In “My apps” note the “App id” under the app’s name. Then press “Manage”, open the tab “Configure” and copy the “App secret key” from the section “Api keys”.',
      url: APPS,
      link: 'Open “My apps”'
    },
    {
      text: 'With Trial access a pin this application creates is seen only by you. For everybody to see the pins press “Upgrade” on the app’s card (Standard access): Pinterest asks for a video recording, and accepts a screen recording of the calls when you are the app’s only user.',
      url: APPS,
      link: 'Open “My apps”'
    },
    { text: 'Paste the app id and the app secret key below. They are kept in the vault of this Mac and never shown again. The application asks Pinterest for a token by itself whenever it needs one, so nothing ends and nothing is renewed by hand.' }
  ],
  keyLooksValid: looksLikeSecretKey
}

/** The two values the vault keeps as one word: the app id, a colon, the app secret key. */
function splitKept(kept: string): { appId: string; secretKey: string } | null {
  const at = kept.indexOf(':')
  return at > 0 ? { appId: kept.slice(0, at), secretKey: kept.slice(at + 1) } : null
}

/**
 * The Pinterest account that owns a developer app, worked through Pinterest's API with the app's id and secret key (DEC-085): a pin of one
 * picture with a title, a description and a link, created on the board the channel names; the numbers under each pin. Pinterest's API has no
 * comments, so the channel is one the application does not read: it is for the owner's own pins and is never watched in a browser.
 */
export class PinterestApiConnector implements Connector {
  readonly id = PINTEREST_API_CONNECTOR_ID
  readonly platform = 'pinterest'
  readonly version = '1'
  readonly label = 'Pinterest'
  readonly api = API
  readonly postNumberKinds = ['likes', 'comments', 'views'] as const

  /** The token Pinterest gave each account's app, kept in memory only, and when it ends. */
  private readonly tokens = new Map<string, { token: string; untilMs: number }>()
  private readonly accounts = new Map<string, PinterestAccount>()

  matches(input: string): boolean {
    return boardOf(input) !== null
  }

  normalizeTarget(input: string): NormalizedTarget {
    const place = boardOf(input)
    if (!place) throw new Error('Give the address of a board of the account, like https://www.pinterest.com/yourbrand/your-board/. A pin is created on a board.')
    return { target: `pinterest.com/${place.user}/${place.board}`, url: `https://www.pinterest.com/${place.user}/${encodeURIComponent(place.board)}/` }
  }

  loginUrl(): string {
    return APPS
  }

  channelGuide(): ChannelGuide {
    return { browseUrl: 'https://www.pinterest.com/', example: 'https://www.pinterest.com/yourbrand/your-board/', hint: 'The address of a board of the account that owns the developer app: open the board on Pinterest and copy its address.' }
  }

  readsChannel(_channel: Channel): boolean {
    return false
  }

  /** Checks the pasted pair with Pinterest by asking for a token, and says what the vault keeps: both values as one word. */
  async keyToKeep(http: HttpPort, pasted: { key: string; secret: string | null; keyId?: string | null }, _now: Date): Promise<KeptKey> {
    const appId = pasted.keyId ?? ''
    if (!looksLikeAppId(appId)) throw new Error('This does not look like an app id: it is the number under the app’s name in “My apps”.')
    let answer: Awaited<ReturnType<typeof askToken>>
    try {
      answer = await askToken(http, appId, pasted.key)
    } catch (error) {
      throw new Error(`Pinterest did not answer (${error instanceof Error ? error.message : String(error)}), so the app id and the secret key could not be checked. Nothing was saved.`, { cause: error })
    }
    if (!answer.ok) throw new Error(`${refusal(answer)} Nothing was saved.`)
    if (!answer.result.access_token) throw new Error('Pinterest answered with no token. Nothing was saved.')
    return { key: `${appId}:${pasted.key}`, expiresAt: null }
  }

  /** A client with a token that has at least a day left; a new token is asked for when there is none. Null when no key is saved. */
  private async client(ctx: ConnectorContext, fresh = false): Promise<PinterestApi | null> {
    const kept = await ctx.apiKey()
    if (!kept) return null
    const now = ctx.clock.now().getTime()
    const has = fresh ? undefined : this.tokens.get(ctx.account.id)
    if (has && has.untilMs - now > DAY_MS) return new PinterestApi(ctx.http, has.token)
    const pair = splitKept(kept)
    if (!pair) throw Object.assign(new Error('The saved Pinterest key is not an app id with a secret key. Save both again on the account\'s page.'), { name: 'LoginRequiredError' })
    const answer = await askToken(ctx.http, pair.appId, pair.secretKey)
    if (!answer.ok) throw unreadable(answer)
    const token = answer.result.access_token
    if (!token) throw new Error('Pinterest answered with no token.')
    const lasts = typeof answer.result.expires_in === 'number' && answer.result.expires_in > 0 ? answer.result.expires_in * 1000 : 30 * DAY_MS
    this.tokens.set(ctx.account.id, { token, untilMs: now + lasts })
    return new PinterestApi(ctx.http, token)
  }

  private async requireClient(ctx: ConnectorContext): Promise<PinterestApi> {
    const api = await this.client(ctx)
    if (!api) throw Object.assign(new Error('No Pinterest app id and secret key are saved for this account. Save them on the account\'s page.'), { name: 'LoginRequiredError' })
    return api
  }

  /** One request; a token Pinterest no longer takes (withdrawn before its time) is asked for anew once, and the request made again. */
  private async ask<T>(ctx: ConnectorContext, call: (api: PinterestApi) => Promise<PinterestAnswer<T>>): Promise<PinterestAnswer<T>> {
    const first = await call(await this.requireClient(ctx))
    if (first.ok || !keyRefused(first)) return first
    const again = await this.client(ctx, true)
    return again ? call(again) : first
  }

  /** Whose app it is: asked from Pinterest, and remembered until the next sign-in check. */
  private async account(ctx: ConnectorContext): Promise<PinterestAccount> {
    const kept = this.accounts.get(ctx.account.id)
    if (kept) return kept
    const me = await this.ask<PinterestAccount>(ctx, (api) => api.get('user_account'))
    if (!me.ok) throw unreadable(me)
    this.accounts.set(ctx.account.id, me.result)
    return me.result
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    this.accounts.delete(ctx.account.id)
    this.tokens.delete(ctx.account.id)
    const said = (signal: string): LoginState => ({ loggedIn: false, identity: null, captcha: false, signal })
    try {
      if (!(await this.client(ctx))) return said('no Pinterest app id and secret key are saved')
      const me = await this.account(ctx)
      return { loggedIn: true, identity: me.username ? `@${me.username}` : (me.business_name ?? 'Pinterest account'), captcha: false }
    } catch (error) {
      if (error instanceof HttpNoAnswerError) throw error
      return said(error instanceof Error ? error.message : String(error))
    }
  }

  /** Every board of the account the API lists, read to the end. */
  private async boards(ctx: ConnectorContext): Promise<PinterestBoard[]> {
    const all: PinterestBoard[] = []
    let bookmark: string | null = null
    for (let page = 0; page < MOST_PAGES; page += 1) {
      const list: PinterestAnswer<PinterestList<PinterestBoard>> = await this.ask(ctx, (api) => api.get('boards', { page_size: String(PAGE), ...(bookmark ? { bookmark } : {}) }))
      if (!list.ok) throw unreadable(list)
      all.push(...(list.result.items ?? []))
      bookmark = list.result.bookmark ?? null
      if (!bookmark) break
    }
    return all
  }

  /**
   * The board the channel's address names, among the account's own. Pinterest's API gives a board an id and a name and no address, so the
   * board is the one whose name, written the way an address is, is the address's last part. The reason in words when it is not exactly one.
   */
  private async board(ctx: ConnectorContext): Promise<{ board: PinterestBoard; account: PinterestAccount } | { problem: string }> {
    const place = boardOf(ctx.channel.url)
    if (!place) return { problem: `${ctx.channel.url} is not the address of a board. Connect the address of a board of the account.` }
    const account = await this.account(ctx)
    const name = account.username ? `@${account.username}` : 'the account of the app'
    if (!account.username || account.username.toLowerCase() !== place.user) {
      return { problem: `The developer app belongs to ${name}, and this channel is a board of @${place.user}. Pins are created only on the boards of the account that owns the app: connect one of them, or save the app of that account.` }
    }
    const boards = await this.boards(ctx)
    const wanted = boardWords(place.board)
    const hits = boards.filter((board) => boardWords(board.name) === wanted)
    if (hits.length === 1) return { board: hits[0] as PinterestBoard, account }
    const names = boards.slice(0, 12).map((board) => `“${board.name}”`).join(', ')
    if (hits.length > 1) return { problem: `${name} has ${hits.length} boards whose name reads “${place.board}” in an address, so the application cannot tell which one this is. Rename one of them on Pinterest and connect its new address.` }
    return { problem: `None of the boards Pinterest lists for ${name} is at this address (${boards.length === 0 ? 'it lists none' : `it lists ${names}${boards.length > 12 ? ' and more' : ''}`}). Open the board on Pinterest and connect its address as it is there; a secret board may not be listed.` }
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    const checkedAt = ctx.clock.now().toISOString()
    const cap = (key: CapabilityKey, status: CapabilityStatus, detail: string): Capability => ({ key, status, detail, checkedAt })
    const closed = [
      ...(['read_posts', 'read_comments', 'detect_changes', 'publish_reply', 'read_inbox'] as CapabilityKey[]).map((key) => cap(key, 'unavailable', NO_COMMENTS)),
      cap('metrics', 'unavailable', `The account's followers are not read here. Under each pin the application reads reactions and comments since it was made, and how many times it was shown in the last ${NUMBER_DAYS} days.`),
      cap('membership', 'unavailable', 'A board of the account is not joined: it is its own.')
    ]
    const stopped = (detail: string): Capability[] => [cap('publish_post', 'needs_user', detail), cap('verify_send', 'needs_user', detail), ...closed]
    this.accounts.delete(ctx.account.id)
    let found: Awaited<ReturnType<PinterestApiConnector['board']>>
    try {
      if (!(await this.client(ctx))) return stopped('Save the app id and the app secret key on the account\'s page first.')
      found = await this.board(ctx)
    } catch (error) {
      return stopped(error instanceof Error ? error.message : String(error))
    }
    if ('problem' in found) return stopped(found.problem)
    return [
      cap(
        'publish_post',
        'needs_check',
        `Pins are created on the board “${found.board.name}” as @${found.account.username}: 1 to ${MOST_CAROUSEL_PICTURES} JPEG or PNG pictures (2–${MOST_CAROUSEL_PICTURES} as a carousel pin), each up to 20 MB, with a title, a description and a link, or one MP4, MOV or M4V video up to 2 GB with one picture as its cover. Until Pinterest gives the app Standard access, a pin it creates is seen only by you (Trial access). Tried with the first pin.`
      ),
      cap('verify_send', 'needs_check', 'Pinterest returns the pin it made. Tried with the first pin.'),
      ...closed
    ]
  }

  /** Nothing is read: Pinterest's API has no comments. The monitor finds no discussion and asks no more. */
  async fetchActivity(ctx: ConnectorContext, _options: { limit: number }): Promise<ActivityBatch> {
    return { discussions: [], fetchedAt: ctx.clock.now().toISOString() }
  }

  async fetchThread(_ctx: ConnectorContext, _discussionExternalId: string): Promise<RemoteDiscussion | null> {
    return null
  }

  /** The account's own numbers are not read for a channel the application does not read; the numbers under each pin are (`readPostNumbers`). */
  async fetchMetrics(_ctx: ConnectorContext): Promise<MetricReading[]> {
    return []
  }

  async readPostNumbers(ctx: ConnectorContext, posts: { externalId: string; url: string | null }[]): Promise<Record<string, PostNumbers>> {
    const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)
    const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
    const now = ctx.clock.now().getTime()
    const found: Record<string, PostNumbers> = {}
    for (const post of posts) {
      const id = parseExternalId(post.externalId)
      if (!id) continue
      const numbers = await this.ask<Record<string, PinterestPinNumbers>>(ctx, (api) =>
        api.get(`pins/${id}/analytics`, { start_date: day(now - (NUMBER_DAYS - 1) * DAY_MS), end_date: day(now), metric_types: 'IMPRESSION,TOTAL_COMMENTS,TOTAL_REACTIONS', pin_metrics: 'true' })
      )
      if (!numbers.ok) {
        if (keyRefused(numbers)) throw unreadable(numbers)
        continue
      }
      const all = Object.values(numbers.result)[0]
      // Reactions and comments are counted since the pin was made; how often it was shown, over the asked days.
      found[post.externalId] = { likes: whole(all?.lifetime_metrics?.TOTAL_REACTIONS), comments: whole(all?.lifetime_metrics?.TOTAL_COMMENTS), views: whole(all?.summary_metrics?.IMPRESSION) }
    }
    return found
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    if (request.kind === 'reply') return failed(`${NO_COMMENTS} Nothing was sent.`)
    const title = (request.title ?? '').trim()
    const words = request.text.trim()
    const link = (request.link ?? '').trim()
    const videos = request.attachments.filter((file) => isVideoMime(file.mime))
    const pictures = request.attachments.filter((file) => !isVideoMime(file.mime))
    const count = (n: number, one: string, many: string): string => (n === 0 ? `no ${one}` : n === 1 ? `one ${one}` : `${n} ${many}`)
    const validPictures = videos.length === 0 && pictures.length >= 1 && pictures.length <= MOST_CAROUSEL_PICTURES
    const validVideo = videos.length === 1 && pictures.length === 1
    if (!validPictures && !validVideo) {
      const has = `${count(pictures.length, 'picture', 'pictures')}${videos.length > 0 ? ` and ${count(videos.length, 'video', 'videos')}` : ''}`
      return failed(`A pin made through Pinterest's API is 1 to ${MOST_CAROUSEL_PICTURES} pictures (carousel for 2–${MOST_CAROUSEL_PICTURES}), or one video with one picture as its cover; this post has ${has}. Nothing was sent.`)
    }
    const video = videos[0]
    for (const picture of pictures) {
      if (!PICTURES.has(picture.mime)) return failed(`Pinterest takes a JPEG or PNG picture through its API; “${picture.name}” is neither. Nothing was sent.`)
    }
    if (video && !VIDEOS.has(video.mime)) return failed(`Pinterest takes an MP4, MOV or M4V video; “${video.name}” is none of them. Nothing was sent.`)
    if ([...title].length > MOST_TITLE) return failed(`Pinterest takes at most ${MOST_TITLE} characters in a pin's title; this one has ${[...title].length}. Nothing was sent.`)
    if ([...words].length > MOST_DESCRIPTION) return failed(`Pinterest takes at most ${MOST_DESCRIPTION} characters in a pin's description; this one has ${[...words].length}. Nothing was sent.`)
    if (link.length > MOST_LINK || (link !== '' && !/^https?:\/\//i.test(link))) return failed('The link of a pin is an address that starts with http:// or https://, at most 2048 characters. Nothing was sent.')
    const encoded: { mime: string; data: string }[] = []
    for (const picture of pictures) {
      try {
        const bytes = statSync(picture.path).size
        if (bytes > MOST_PICTURE_BYTES) return failed(`Pinterest takes a picture up to 20 MB; “${picture.name}” is ${Math.round(bytes / (1024 * 1024))} MB. Nothing was sent.`)
        encoded.push({ mime: picture.mime, data: readFileSync(picture.path).toString('base64') })
      } catch {
        return failed(`The picture “${picture.name}” could not be read from this Mac. Nothing was sent.`)
      }
    }
    if (video) {
      try {
        const bytes = statSync(video.path).size
        if (bytes > MOST_VIDEO_BYTES) return failed(`Pinterest takes a video up to 2 GB; “${video.name}” is ${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB. Nothing was sent.`)
      } catch {
        return failed(`The video “${video.name}” could not be read from this Mac. Nothing was sent.`)
      }
    }
    let boardId: string
    try {
      const found = await this.board(ctx)
      if ('problem' in found) return failed(`${found.problem} Nothing was sent.`)
      boardId = found.board.id
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return failed(`No answer came (${error.message}) before anything was created. Nothing was sent.`)
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    // A video is uploaded first and named by its number; 2–5 pictures go as a carousel pin (multiple_image_base64).
    const first = encoded[0] as (typeof encoded)[number]
    let source: Record<string, unknown> =
      encoded.length === 1
        ? { source_type: 'image_base64', content_type: first.mime, data: first.data }
        : {
            source_type: 'multiple_image_base64',
            index: 0,
            items: encoded.map(({ mime, data }) => ({
              content_type: mime,
              data,
              ...(title ? { title } : {}),
              ...(words ? { description: words } : {}),
              ...(link ? { link } : {})
            }))
          }
    if (video) {
      const uploaded = await this.upload(ctx, video)
      if ('problem' in uploaded) return failed(`${uploaded.problem} Nothing was sent.`)
      source = { source_type: 'video_id', media_id: uploaded.mediaId, cover_image_content_type: first.mime, cover_image_data: first.data }
    }
    const body = {
      board_id: boardId,
      ...(title ? { title } : {}),
      ...(words ? { description: words } : {}),
      ...(link ? { link } : {}),
      media_source: source
    }
    let answer: PinterestAnswer<PinterestPin>
    try {
      answer = await this.ask<PinterestPin>(ctx, (api) => api.post('pins', body))
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { status: 'unknown', error: `Pinterest did not answer (${error.message}), so it is not known whether the pin was created.` }
      return failed(`${error instanceof Error ? error.message : String(error)} Nothing was sent.`)
    }
    if (!answer.ok) {
      if (answer.status >= 500) return { status: 'unknown', error: `Pinterest answered with an error of its own (${answer.message}), so it is not known whether the pin was created.` }
      return failed(`${refusal(answer)} Nothing was sent.`)
    }
    const id = answer.result.id
    if (!id || !/^\d+$/.test(id)) return { status: 'unknown', error: 'Pinterest accepted the pin and returned no id for it, so it is not known whether it was created.' }
    return { status: 'confirmed', url: addressOf(id), externalId: pinIdOf(id) }
  }

  /**
   * A video on its way to a pin, by Pinterest's guide: the upload is registered, the file goes to the address and with the form fields
   * Pinterest answered with (no token there), and its processing is asked about until it has succeeded. Nothing is published by any of it.
   */
  private async upload(ctx: ConnectorContext, video: { name: string; path: string; mime: string }): Promise<{ mediaId: string } | { problem: string }> {
    try {
      const registered = await this.ask<PinterestMedia>(ctx, (api) => api.post('media', { media_type: 'video' }))
      if (!registered.ok) return { problem: refusal(registered) }
      const { media_id: mediaId, upload_url: url, upload_parameters: fields } = registered.result
      if (!mediaId || !url || !/^https:\/\//i.test(url) || !fields) return { problem: 'Pinterest gave no place to upload the video to.' }
      // The file is the last field of the form, after everything Pinterest asked to send with it.
      const sent = await ctx.http.request({ method: 'POST', url, form: { ...fields, file: { path: video.path, name: video.name, mime: video.mime } }, timeoutMs: UPLOAD_TIMEOUT_MS })
      if (sent.status < 200 || sent.status >= 300) return { problem: `The upload of the video “${video.name}” was refused (HTTP ${sent.status}).` }
      for (let look = 0; look < VIDEO_LOOKS; look += 1) {
        await ctx.pause(VIDEO_LOOK_MS)
        const state = await this.ask<PinterestMedia>(ctx, (api) => api.get(`media/${mediaId}`))
        if (!state.ok) return { problem: refusal(state) }
        if (state.result.status === 'succeeded') return { mediaId }
        if (state.result.status === 'failed') return { problem: `Pinterest could not process the video “${video.name}”.` }
      }
      return { problem: `Pinterest was still processing the video “${video.name}” after ten minutes.` }
    } catch (error) {
      if (error instanceof HttpNoAnswerError) return { problem: `No answer came (${error.message}) before anything was created.` }
      return { problem: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Looks among the account's newest pins for the one a send with a lost answer may have made: the same board, title and description, not older than the attempt. */
  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    if (request.kind !== 'post') throw new Error(`${NO_COMMENTS} Look at Pinterest and say whether it is there.`)
    const floor = earliestCreation(request)
    const found = await this.board(ctx)
    if ('problem' in found) throw new Error(found.problem)
    const list = await this.ask<PinterestList<PinterestPin>>(ctx, (api) => api.get('pins', { page_size: String(PAGE) }))
    if (!list.ok) throw unreadable(list)
    const hit = (list.result.items ?? []).find(
      (pin) => pin.board_id === found.board.id && sameText(pin.title ?? '', (request.title ?? '').trim()) && sameText(pin.description ?? '', request.text.trim()) && Date.parse(pin.created_at ?? '') >= floor
    )
    return hit ? { url: addressOf(hit.id), externalId: pinIdOf(hit.id) } : null
  }
}
