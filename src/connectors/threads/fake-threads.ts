// A Threads API that lives in a test: one profile with its posts and their replies, the tokens that speak for it, and the app's secret.
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'
import { HttpNoAnswerError } from '../../core/net/http'

export const FAKE_LONG_TOKEN = 'THfakeLongTokenForTests0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ'
export const FAKE_SHORT_TOKEN = 'THfakeShortTokenForTests0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHI'
export const FAKE_APP_SECRET = 'fake-threads-app-secret-0123456789'
export const PROFILE_ID = '17841400000000001'

const HOUR = 3_600_000
const DAY = 24 * HOUR

interface FakeMedia {
  id: string
  text: string
  created: number
  username: string | null
  own: boolean
  /** Null for a post of the profile; the post or the reply it answers otherwise. */
  repliedTo: string | null
  rootId: string | null
  topic: string | null
  likes: number
  views: number
  repost: boolean
  /** The addresses of the pictures and videos of the post, in their order, as Threads read them. */
  files: { kind: 'IMAGE' | 'VIDEO'; url: string }[]
}

interface FakeContainer {
  id: string
  form: Record<string, string>
  status: string
}

export class FakeThreads implements HttpPort {
  profile = { id: PROFILE_ID, username: 'natalmystic', name: 'Natal Mystic' }
  /** Every token Threads knows: when it was made and when it ends. */
  readonly tokens = new Map<string, { issuedAt: number; expiresAt: number }>()
  /** The next request that makes something fails this way, once: an error answer, or no answer at all after Threads acted. */
  failNext: { status?: number; code: number; message: string } | 'lost' | null = null
  /** False makes Threads refuse to say anything about a token. */
  tellsTokenFacts = true
  /** What a new container says of itself the first times it is asked. */
  containerStates: string[] = []
  /** Whether Threads can read a file from this address at the moment it is given: an address nobody serves is refused, as the real one's fetch would fail. */
  reads: (url: string) => boolean = () => true
  followers = 120
  readonly calls: { method: string; path: string; params: Record<string, string> }[] = []
  readonly media: FakeMedia[] = []
  readonly containers: FakeContainer[] = []
  private next = 9000
  private minted = 0
  nowMs = Date.parse('2026-12-01T10:00:00.000Z')

  constructor() {
    this.tokens.set(FAKE_LONG_TOKEN, { issuedAt: this.nowMs - 2 * DAY, expiresAt: this.nowMs + 58 * DAY })
    this.tokens.set(FAKE_SHORT_TOKEN, { issuedAt: this.nowMs, expiresAt: this.nowMs + HOUR })
  }

  /** Moves Threads' clock, and the two prepared tokens with it. */
  startAt(ms: number): void {
    this.nowMs = ms
    this.tokens.set(FAKE_LONG_TOKEN, { issuedAt: ms - 2 * DAY, expiresAt: ms + 58 * DAY })
    this.tokens.set(FAKE_SHORT_TOKEN, { issuedAt: ms, expiresAt: ms + HOUR })
  }

  private time(ms: number): string {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000')
  }

  private add(text: string, extra: Partial<FakeMedia> = {}): FakeMedia {
    const item: FakeMedia = { id: String(this.next++), text, created: this.nowMs, username: this.profile.username, own: true, repliedTo: null, rootId: null, topic: null, likes: 0, views: 0, repost: false, files: [], ...extra }
    this.media.unshift(item)
    return item
  }

  /** The owner writes a post on Threads by hand. */
  ownerPosts(text: string): FakeMedia {
    return this.add(text)
  }

  /** The profile reposts somebody else's post. */
  reposts(text: string): FakeMedia {
    return this.add(text, { repost: true, username: 'someoneelse', own: false })
  }

  /** Somebody answers a post or a reply. A private profile has no name Threads would give. */
  reply(toId: string, text: string, username: string | null): FakeMedia {
    const parent = this.media.find((m) => m.id === toId)
    return this.add(text, { username, own: false, repliedTo: toId, rootId: parent?.rootId ?? toId })
  }

  get posts(): FakeMedia[] {
    return this.media.filter((m) => m.repliedTo === null)
  }

  private json(item: FakeMedia, fields: string[]): Record<string, unknown> {
    const whole: Record<string, unknown> = {
      id: item.id,
      text: item.text,
      timestamp: this.time(item.created),
      media_type: item.repost ? 'REPOST_FACADE' : 'TEXT_POST',
      has_replies: this.media.some((m) => m.repliedTo === item.id),
      is_reply_owned_by_me: item.own && item.repliedTo !== null,
      hide_status: 'NOT_HUSHED',
      ...(item.username ? { username: item.username, permalink: `https://www.threads.com/@${item.username}/post/p${item.id}` } : {}),
      ...(item.repliedTo ? { replied_to: { id: item.repliedTo }, root_post: { id: item.rootId } } : {}),
      ...(item.topic ? { topic_tag: item.topic } : {})
    }
    return Object.fromEntries(Object.entries(whole).filter(([name]) => name === 'id' || fields.includes(name)))
  }

  private ok(body: unknown): HttpResponse {
    return { status: 200, headers: {}, text: JSON.stringify(body) }
  }

  private error(status: number, code: number, message: string): HttpResponse {
    return { status, headers: {}, text: JSON.stringify({ error: { message, type: 'OAuthException', code } }) }
  }

  private alive(token: string | undefined): boolean {
    const known = token ? this.tokens.get(token) : undefined
    return known !== undefined && known.expiresAt > this.nowMs
  }

  private mint(days: number): string {
    this.minted += 1
    const token = `THfakeMintedToken${String(this.minted).padStart(3, '0')}ForTests0123456789abcdefghijklmnopqrstuvwxyzAB`
    this.tokens.set(token, { issuedAt: this.nowMs, expiresAt: this.nowMs + days * DAY })
    return token
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    if (url.host !== 'graph.threads.com') throw new Error(`Not a Threads API address: ${url.origin}${url.pathname}`)
    const params: Record<string, string> = Object.fromEntries(url.searchParams)
    for (const [name, value] of Object.entries(req.form ?? {})) if (typeof value === 'string') params[name] = value
    const token = params.access_token
    delete params.access_token
    const versioned = /^\/v1\.0\/(.+)$/.exec(url.pathname)
    const path = versioned ? (versioned[1] as string) : url.pathname.slice(1)
    this.calls.push({ method: req.method, path, params: { ...params, ...(params.client_secret ? { client_secret: '[secret]' } : {}) } })

    // The token calls have no version in their address.
    if (!versioned) {
      if (path === 'access_token' && params.grant_type === 'th_exchange_token') {
        if (params.client_secret !== FAKE_APP_SECRET) return { status: 400, headers: {}, text: JSON.stringify({ error_type: 'OAuthException', code: 400, error_message: 'Invalid client secret' }) }
        if (!this.alive(token)) return this.error(400, 190, 'Session has expired')
        return this.ok({ access_token: this.mint(60), token_type: 'bearer', expires_in: 60 * 86_400 })
      }
      if (path === 'refresh_access_token' && params.grant_type === 'th_refresh_token') {
        const known = token ? this.tokens.get(token) : undefined
        if (!known || known.expiresAt <= this.nowMs) return this.error(400, 190, 'Session has expired')
        if (this.nowMs - known.issuedAt < DAY) return this.error(400, 100, 'The token is less than 24 hours old')
        // Threads' pages do not say whether the renewed token is another word: here it is.
        this.tokens.delete(token as string)
        return this.ok({ access_token: this.mint(60), token_type: 'bearer', expires_in: 60 * 86_400 })
      }
      throw new Error(`The fake Threads has no ${req.method} ${path}`)
    }

    if (!this.alive(token)) return this.error(400, 190, 'Error validating access token: Session has expired')
    const fields = (params.fields ?? 'id').split(',')
    const list = (items: FakeMedia[], limit = 100): HttpResponse => this.ok({ data: items.slice(0, limit).map((m) => this.json(m, fields)), paging: { cursors: { before: 'b', after: 'a' } } })
    const mine = (id: string): boolean => id === 'me' || id === this.profile.id

    if (req.method === 'GET') {
      if (path === 'debug_token') {
        if (!this.tellsTokenFacts) return this.error(400, 100, 'Unsupported get request')
        const known = this.tokens.get(params.input_token ?? '')
        if (!known) return this.ok({ data: { is_valid: false } })
        return this.ok({ data: { type: 'USER', is_valid: known.expiresAt > this.nowMs, issued_at: Math.floor(known.issuedAt / 1000), expires_at: Math.floor(known.expiresAt / 1000), scopes: ['threads_basic'], user_id: this.profile.id } })
      }
      const [first, second] = path.split('/') as [string, string | undefined]
      if (mine(first) && second === undefined) return this.ok(Object.fromEntries(Object.entries(this.profile).filter(([name]) => name === 'id' || fields.includes(name))))
      if (mine(first) && second === 'threads') return list(this.posts, Number(params.limit ?? '25'))
      if (mine(first) && second === 'replies') return list(this.media.filter((m) => m.own && m.repliedTo !== null), Number(params.limit ?? '25'))
      if (mine(first) && second === 'threads_insights') return this.ok({ data: [{ name: 'followers_count', period: 'day', total_value: { value: this.followers } }] })
      const container = this.containers.find((c) => c.id === first)
      if (container && second === undefined) {
        const said = this.containerStates.shift() ?? container.status
        return this.ok({ id: container.id, status: said, ...(said === 'ERROR' ? { error_message: 'UNKNOWN' } : {}) })
      }
      const item = this.media.find((m) => m.id === first)
      if (!item) return this.error(400, 100, `Unsupported get request. Object with ID '${first}' does not exist`)
      if (second === undefined) return this.ok(this.json(item, fields))
      if (second === 'conversation') {
        const under = this.media.filter((m) => m.rootId === item.id).sort((a, b) => a.created - b.created || Number(a.id) - Number(b.id))
        return list(params.reverse === 'false' ? under : under.reverse())
      }
      if (second === 'insights') {
        const replies = this.media.filter((m) => m.repliedTo === item.id).length
        const numbers: Record<string, number> = { views: item.views, likes: item.likes, replies }
        return this.ok({ data: (params.metric ?? '').split(',').filter((name) => name in numbers).map((name) => ({ name, period: 'lifetime', values: [{ value: numbers[name] }] })) })
      }
    }

    if (req.method === 'POST') {
      const [first, second] = path.split('/') as [string, string | undefined]
      if (mine(first) && second === 'threads') {
        if (this.failNext && this.failNext !== 'lost' && this.failNext.status === undefined) {
          const failure = this.failNext
          this.failNext = null
          return this.error(400, failure.code, failure.message)
        }
        const kind = params.media_type
        if (kind === 'TEXT') {
          if (!params.text) return this.error(400, 100, 'The parameter text is required')
        } else if (kind === 'IMAGE' || kind === 'VIDEO') {
          const url = kind === 'IMAGE' ? params.image_url : params.video_url
          if (!url) return this.error(400, 100, `The parameter ${kind === 'IMAGE' ? 'image_url' : 'video_url'} is required`)
          if (!this.reads(url)) return this.error(400, 100, 'The media could not be fetched from this URI')
        } else if (kind === 'CAROUSEL') {
          const children = (params.children ?? '').split(',').filter(Boolean)
          if (children.length < 2 || children.length > 20) return this.error(400, 100, 'A carousel takes 2 to 20 children')
          if (children.some((id) => this.containers.find((c) => c.id === id)?.form.is_carousel_item !== 'true')) return this.error(400, 100, 'A child is not a carousel item')
        } else return this.error(400, 100, 'The parameter media_type is required')
        if (params.reply_to_id && !this.media.some((m) => m.id === params.reply_to_id)) return this.error(400, 100, 'The post to reply to does not exist')
        const container: FakeContainer = { id: String(this.next++), form: params, status: 'FINISHED' }
        this.containers.push(container)
        return this.ok({ id: container.id })
      }
      if (mine(first) && second === 'threads_publish') {
        const container = this.containers.find((c) => c.id === params.creation_id)
        if (!container) return this.error(400, 100, 'The container does not exist')
        const failure = this.failNext
        this.failNext = null
        if (failure && failure !== 'lost') return this.error(failure.status ?? 400, failure.code, failure.message)
        const parent = container.form.reply_to_id ? this.media.find((m) => m.id === container.form.reply_to_id) : undefined
        if (container.form.is_carousel_item === 'true') return this.error(400, 100, 'A carousel item is not published by itself')
        const fileOf = (c: FakeContainer): FakeMedia['files'] =>
          c.form.media_type === 'IMAGE' ? [{ kind: 'IMAGE', url: c.form.image_url as string }] : c.form.media_type === 'VIDEO' ? [{ kind: 'VIDEO', url: c.form.video_url as string }] : []
        const files =
          container.form.media_type === 'CAROUSEL'
            ? (container.form.children as string).split(',').flatMap((id) => fileOf(this.containers.find((c) => c.id === id) as FakeContainer))
            : fileOf(container)
        const made = this.add(container.form.text ?? '', { files, ...(parent ? { repliedTo: parent.id, rootId: parent.rootId ?? parent.id } : { topic: container.form.topic_tag ?? null }) })
        container.status = 'PUBLISHED'
        if (failure === 'lost') throw new HttpNoAnswerError('the connection was lost')
        return this.ok({ id: made.id })
      }
    }
    throw new Error(`The fake Threads has no ${req.method} ${path}`)
  }
}
