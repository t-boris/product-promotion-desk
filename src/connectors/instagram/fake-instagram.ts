// An Instagram that lives in a test: one professional account behind the Instagram API with Instagram Login, in the shapes Meta's pages show.
import { HttpNoAnswerError } from '../../core/net/http'
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'

export const FAKE_IG_TOKEN = 'IGAAfakeLongLivedTokenOfTheDashboard0123456789abcdefghijklmnopqrstuvwxyz'
/** The id of the professional account (`user_id`), and the id of the same person inside the app (`id`). */
export const IG_ACCOUNT_ID = '17841400000000009'
export const IG_APP_SCOPED_ID = '9900000000000001'

const DAY = 24 * 3_600_000

interface FakeComment {
  id: string
  text: string
  username: string
  created: number
  replies: FakeComment[]
}

interface FakeMedia {
  id: string
  caption: string | null
  kind: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'
  created: number
  likes: number
  views: number
  /** The addresses Instagram read the files from, in their order. */
  files: { kind: 'IMAGE' | 'VIDEO'; url: string }[]
  /** False for a reel that is shown in the Reels tab only. */
  inFeed: boolean
  comments: FakeComment[]
}

interface FakeContainer {
  id: string
  body: Record<string, unknown>
  status: string
}

export class FakeInstagram implements HttpPort {
  profile = { id: IG_APP_SCOPED_ID, user_id: IG_ACCOUNT_ID, username: 'natalmystic', name: 'Natal Mystic', account_type: 'Business', followers_count: 340 }
  /** Every token Instagram knows, and when each ends. */
  readonly tokens = new Map<string, { expiresAt: number }>()
  /** True gives the profile inside a `data` list, as one of Meta's pages shows it. */
  profileInList = false
  /** The next request that makes something fails this way, once: an error answer, or no answer at all after Instagram acted. */
  failNext: { status?: number; code: number; message: string; userMessage?: string } | 'lost' | null = null
  /** What a new container says of itself the first times it is asked. */
  containerStates: string[] = []
  /** Whether Instagram can read a file from this address at the moment it is given. */
  reads: (url: string) => boolean = () => true
  /** True makes Instagram publish a post without its caption and say so. */
  losesCaption = false
  /** False makes Instagram refuse the views of a post (no insights permission). */
  givesInsights = true
  readonly calls: { method: string; path: string; params: Record<string, unknown>; auth: string | null }[] = []
  readonly media: FakeMedia[] = []
  readonly containers: FakeContainer[] = []
  private next = 5000
  private minted = 0
  nowMs = Date.parse('2026-12-01T10:00:00.000Z')

  constructor() {
    this.tokens.set(FAKE_IG_TOKEN, { expiresAt: this.nowMs + 60 * DAY })
  }

  /** Moves Instagram's clock, and the prepared token with it. */
  startAt(ms: number): void {
    this.nowMs = ms
    this.tokens.set(FAKE_IG_TOKEN, { expiresAt: ms + 60 * DAY })
  }

  /** The owner posts on Instagram by hand. */
  ownerPosts(caption: string): FakeMedia {
    const item: FakeMedia = { id: String(this.next++), caption, kind: 'IMAGE', created: this.nowMs, likes: 0, views: 0, files: [], inFeed: true, comments: [] }
    this.media.unshift(item)
    return item
  }

  /** Somebody comments under a post, or answers a comment. */
  comment(mediaId: string, text: string, username: string, underCommentId?: string): FakeComment {
    const post = this.media.find((m) => m.id === mediaId)
    if (!post) throw new Error('no such post in the fake')
    const made: FakeComment = { id: String(this.next++), text, username, created: this.nowMs, replies: [] }
    if (underCommentId) (post.comments.find((c) => c.id === underCommentId) as FakeComment).replies.push(made)
    else post.comments.unshift(made)
    return made
  }

  private ok(body: unknown): HttpResponse {
    return { status: 200, headers: {}, text: JSON.stringify(body) }
  }

  private error(status: number, code: number, message: string, userMessage?: string): HttpResponse {
    return { status, headers: {}, text: JSON.stringify({ error: { message, type: 'OAuthException', code, ...(userMessage ? { error_user_title: 'Not possible', error_user_msg: userMessage } : {}), fbtrace_id: 'Atrace' } }) }
  }

  private time(ms: number): string {
    return `${new Date(ms).toISOString().slice(0, 19)}+0000`
  }

  private commentJson(comment: FakeComment, parentId: string | null, withReplies: boolean): Record<string, unknown> {
    return {
      id: comment.id,
      text: comment.text,
      username: comment.username,
      timestamp: this.time(comment.created),
      from: { id: comment.username === this.profile.username ? IG_ACCOUNT_ID : `u-${comment.username}`, username: comment.username },
      ...(parentId ? { parent_id: parentId } : {}),
      ...(withReplies && comment.replies.length > 0 ? { replies: { data: comment.replies.map((reply) => this.commentJson(reply, comment.id, false)) } } : {})
    }
  }

  private mediaJson(item: FakeMedia, fields: string[]): Record<string, unknown> {
    const whole: Record<string, unknown> = {
      id: item.id,
      ...(item.caption !== null ? { caption: item.caption } : {}),
      media_type: item.kind,
      permalink: `https://www.instagram.com/p/C${item.id}/`,
      timestamp: this.time(item.created),
      username: this.profile.username,
      comments_count: item.comments.reduce((n, c) => n + 1 + c.replies.length, 0),
      like_count: item.likes
    }
    return Object.fromEntries(Object.entries(whole).filter(([name]) => name === 'id' || fields.includes(name)))
  }

  private findComment(id: string): { post: FakeMedia; top: FakeComment; comment: FakeComment } | null {
    for (const post of this.media) {
      for (const top of post.comments) {
        if (top.id === id) return { post, top, comment: top }
        const reply = top.replies.find((r) => r.id === id)
        if (reply) return { post, top, comment: reply }
      }
    }
    return null
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    if (url.host !== 'graph.instagram.com') throw new Error(`Not an address of the fake Instagram: ${url.host}`)
    const query = Object.fromEntries(url.searchParams.entries())
    const path = url.pathname.replace(/^\/(v\d+\.\d+\/)?/, '')
    const versioned = /^\/v\d+\.\d+\//.test(url.pathname)
    const bearer = /^Bearer (.+)$/.exec(req.headers?.authorization ?? '')?.[1] ?? null
    const token = req.method === 'GET' ? (query.access_token ?? null) : bearer
    const body = (req.json ?? {}) as Record<string, unknown>
    const params: Record<string, unknown> = req.method === 'GET' ? Object.fromEntries(Object.entries(query).filter(([name]) => name !== 'access_token')) : body
    this.calls.push({ method: req.method, path, params, auth: req.method === 'GET' ? 'query' : bearer ? 'bearer' : null })
    const known = token ? this.tokens.get(token) : undefined
    if (!known || known.expiresAt <= this.nowMs) return this.error(400, 190, 'Error validating access token: Session has expired.')
    const fields = String(query.fields ?? '').split(/,(?![^{]*\})/).map((f) => f.replace(/\{.*$/, '')).filter(Boolean)
    const mine = (id: string | undefined): boolean => id === IG_ACCOUNT_ID

    if (req.method === 'GET') {
      if (path === 'refresh_access_token') {
        if (versioned || query.grant_type !== 'ig_refresh_token') return this.error(400, 100, 'Unsupported request')
        const made = `IGAAfakeRenewedToken${String(++this.minted).padStart(3, '0')}0123456789abcdefghijklmnopqrstuvwxyzABCDEF`
        this.tokens.set(made, { expiresAt: this.nowMs + 60 * DAY })
        return this.ok({ access_token: made, token_type: 'bearer', expires_in: 60 * 24 * 3600 })
      }
      if (!versioned) return this.error(400, 100, 'Unsupported get request')
      const [first, second] = path.split('/') as [string, string | undefined]
      if (first === 'me' && second === undefined) {
        const said = Object.fromEntries(Object.entries(this.profile).filter(([name]) => fields.includes(name)))
        return this.ok(this.profileInList ? { data: [said] } : said)
      }
      if (mine(first) && second === 'media') return this.ok({ data: this.media.map((m) => this.mediaJson(m, fields)), paging: { cursors: { before: 'b', after: 'a' } } })
      const container = this.containers.find((c) => c.id === first)
      if (container && second === undefined) {
        const said = this.containerStates.shift() ?? container.status
        return this.ok({ id: container.id, status_code: said, ...(said === 'ERROR' ? { status: 'Error: the aspect ratio of the picture is not supported' } : {}) })
      }
      const item = this.media.find((m) => m.id === first)
      if (item && second === undefined) return this.ok(this.mediaJson(item, fields))
      if (item && second === 'comments') {
        const top = item.comments.slice(0, 50)
        return this.ok({ data: top.map((c) => this.commentJson(c, null, String(query.fields ?? '').includes('replies{'))) })
      }
      if (item && second === 'insights') {
        if (!this.givesInsights) return this.error(400, 10, '(#10) Application does not have permission for this action')
        // Instagram gives an empty list in place of a zero.
        return this.ok({ data: query.metric === 'views' && item.views > 0 ? [{ name: 'views', period: 'lifetime', values: [{ value: item.views }], id: `${item.id}/insights/views/lifetime` }] : [] })
      }
      const found = this.findComment(first)
      if (found && second === 'replies') return this.ok({ data: found.top.replies.map((r) => this.commentJson(r, found.top.id, false)) })
      return this.error(400, 100, `Unsupported get request. Object with ID '${first}' does not exist`)
    }

    if (req.method === 'POST') {
      const [first, second] = path.split('/') as [string, string | undefined]
      const fails = (): HttpResponse | null => {
        if (this.failNext && this.failNext !== 'lost' && this.failNext.status === undefined) {
          const failure = this.failNext
          this.failNext = null
          return this.error(400, failure.code, failure.message, failure.userMessage)
        }
        return null
      }
      if (mine(first) && second === 'media') {
        const refused = fails()
        if (refused) return refused
        const kind = body.media_type
        const fileUrl = typeof body.image_url === 'string' ? body.image_url : typeof body.video_url === 'string' ? body.video_url : null
        if (kind === 'CAROUSEL') {
          const children = String(body.children ?? '').split(',').filter(Boolean)
          if (children.length < 2 || children.length > 20) return this.error(400, 100, 'A carousel takes 2 to 20 children')
          if (children.some((id) => this.containers.find((c) => c.id === id)?.body.is_carousel_item !== true)) return this.error(400, 100, 'A child is not a carousel item')
        } else if (kind === undefined) {
          if (typeof body.image_url !== 'string') return this.error(400, 100, 'The parameter image_url is required')
        } else if (kind === 'REELS' || (kind === 'VIDEO' && body.is_carousel_item === true)) {
          if (typeof body.video_url !== 'string') return this.error(400, 100, 'The parameter video_url is required')
        } else return this.error(400, 100, `The media_type ${String(kind)} is not supported`)
        if (fileUrl !== null && !this.reads(fileUrl)) return this.error(400, 9004, 'Only photo or video can be accepted as media type.', 'The media could not be fetched from this URI')
        const container: FakeContainer = { id: String(this.next++), body, status: 'FINISHED' }
        this.containers.push(container)
        return this.ok({ id: container.id })
      }
      if (mine(first) && second === 'media_publish') {
        const container = this.containers.find((c) => c.id === body.creation_id)
        if (!container) return this.error(400, 100, 'The container does not exist')
        if (container.body.is_carousel_item === true) return this.error(400, 100, 'A carousel item is not published by itself')
        const failure = this.failNext
        this.failNext = null
        if (failure && failure !== 'lost') return this.error(failure.status ?? 400, failure.code, failure.message, failure.userMessage)
        const fileOf = (c: FakeContainer): FakeMedia['files'] =>
          typeof c.body.image_url === 'string' ? [{ kind: 'IMAGE', url: c.body.image_url }] : typeof c.body.video_url === 'string' ? [{ kind: 'VIDEO', url: c.body.video_url }] : []
        const carousel = container.body.media_type === 'CAROUSEL'
        const files = carousel ? String(container.body.children).split(',').flatMap((id) => fileOf(this.containers.find((c) => c.id === id) as FakeContainer)) : fileOf(container)
        const made: FakeMedia = {
          id: String(this.next++),
          caption: this.losesCaption || typeof container.body.caption !== 'string' ? null : container.body.caption,
          kind: carousel ? 'CAROUSEL_ALBUM' : container.body.media_type === 'REELS' ? 'VIDEO' : 'IMAGE',
          created: this.nowMs,
          likes: 0,
          views: 0,
          files,
          inFeed: container.body.media_type !== 'REELS' || container.body.share_to_feed === true,
          comments: []
        }
        this.media.unshift(made)
        container.status = 'PUBLISHED'
        if (failure === 'lost') throw new HttpNoAnswerError('the connection was lost')
        return this.ok({ id: made.id, ...(this.losesCaption ? { config_issue: 'CAPTION_NOT_ATTACHED' } : {}) })
      }
      const say = (post: FakeMedia, under: FakeComment | null): HttpResponse => {
        if (typeof body.message !== 'string' || body.message === '') return this.error(400, 100, 'The parameter message is required')
        const failure = this.failNext
        this.failNext = null
        if (failure && failure !== 'lost') return this.error(failure.status ?? 400, failure.code, failure.message, failure.userMessage)
        const made: FakeComment = { id: String(this.next++), text: body.message, username: this.profile.username, created: this.nowMs, replies: [] }
        if (under) under.replies.push(made)
        else post.comments.unshift(made)
        if (failure === 'lost') throw new HttpNoAnswerError('the connection was lost')
        return this.ok({ id: made.id })
      }
      const post = this.media.find((m) => m.id === first)
      if (post && second === 'comments') return say(post, null)
      const found = this.findComment(first)
      // A reply to a reply is put under the comment the reply stands under.
      if (found && second === 'replies') return say(found.post, found.top)
      return this.error(400, 100, `Unsupported post request. Object with ID '${first}' does not exist`)
    }
    throw new Error(`The fake Instagram has no ${req.method} ${path}`)
  }
}
