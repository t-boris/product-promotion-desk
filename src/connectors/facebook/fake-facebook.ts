// A Graph API that lives in a test: one Page with its posts and their comments, and the token that speaks for it.
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'
import { HttpNoAnswerError } from '../../core/net/http'

export const FAKE_PAGE_TOKEN = 'EAAfakePageTokenForTests0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH'
export const FAKE_USER_TOKEN = 'EAAfakeUserTokenForTests0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH'
export const PAGE_ID = '100200300400'

interface FakePost {
  id: string
  message: string
  created: number
  fromId: string
  fromName: string
  photos: number
  link: string | null
  reactions: number
  /** False while the Page keeps the post for its time. */
  published: boolean
  /** Seconds since 1970 of the time the post is kept for; null for a post published at once. */
  scheduledFor: number | null
  /** What Facebook counts as views of the post. */
  views: number
}

interface FakeComment {
  id: string
  postId: string
  parentId: string | null
  message: string
  created: number
  fromId: string
  fromName: string
}

interface FakeReel {
  id: string
  uploaded: boolean
  fileName: string | null
  fileSize: number | null
  finished: boolean
  description: string
  updatedTime: number
  looksLeft: number
  error: string | null
  published: boolean
}

export class FakeFacebook implements HttpPort {
  token = FAKE_PAGE_TOKEN
  page: { id: string; name: string; username?: string } = { id: PAGE_ID, name: 'Natal Mystic', username: 'natalmystic' }
  /** Whether the token may read what visitors wrote: without it Facebook leaves the author of a comment out. */
  namesAuthors = true
  /** The next request that makes something fails this way, once: an error answer, or no answer at all after Facebook acted. */
  failNext: { status?: number; code: number; message: string } | 'lost' | null = null
  readonly calls: { method: string; path: string; params: Record<string, string>; files: string[] }[] = []
  readonly posts: FakePost[] = []
  readonly comments: FakeComment[] = []
  /** Views are given only with the permission read_insights and on a Page with enough followers: false makes Facebook refuse them. */
  givesViews = true
  /** How many readings of the Page's posts pass before the post of an uploaded video shows: Facebook processes a video first. */
  videoLooks = 1
  /** How many status checks of a Reel pass before it is published (or fails with `reelError`). */
  reelLooks = 1
  /** When set, the next Reel fails during processing with Facebook's message. */
  reelError: string | null = null
  /** The videos Facebook took, by their number: the file's name. */
  readonly videos = new Map<string, string>()
  /** The Reels started on the Page, by their video id. */
  readonly reels = new Map<string, FakeReel>()
  /** The posts of videos that are still processed, with the readings left before each shows. */
  private readonly processing = new Map<string, number>()
  /** Facebook's pages disagree on whether every app may delete a post: true makes it refuse. */
  refusesDelete = false
  private readonly unpublishedPhotos = new Map<string, { temporary: boolean }>()
  private next = 5000
  nowMs = Date.parse('2026-12-01T10:00:00.000Z')

  private time(ms: number): string {
    return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000')
  }

  private newPost(message: string, from: { id: string; name: string }, extra: { photos?: number; link?: string | null } = {}): FakePost {
    const post: FakePost = { id: `${this.page.id}_${this.next++}`, message, created: this.nowMs, fromId: from.id, fromName: from.name, photos: extra.photos ?? 0, link: extra.link ?? null, published: true, scheduledFor: null, views: 0, reactions: 0 }
    this.posts.unshift(post)
    return post
  }

  /** The owner writes a post on Facebook by hand, as the Page. */
  ownerPosts(message: string): FakePost {
    return this.newPost(message, this.page)
  }

  /** Somebody comments under a post, or answers a comment. */
  comment(postId: string, message: string, fromName: string, parentId: string | null = null): FakeComment {
    const comment: FakeComment = { id: `${postId.split('_')[1]}_${this.next++}`, postId, parentId, message, created: this.nowMs, fromId: `u-${fromName}`, fromName }
    this.comments.push(comment)
    return comment
  }

  /** The posts the Page keeps for a time. */
  get kept(): FakePost[] {
    return this.posts.filter((p) => !p.published)
  }

  /** Facebook's own clock reaches `nowMs`: every kept post whose time has come is published. `renumbered`: the published post gets a new id. */
  runSchedule(options: { renumbered?: boolean } = {}): void {
    for (const post of this.posts) {
      if (post.published || post.scheduledFor === null || post.scheduledFor * 1000 > this.nowMs) continue
      post.published = true
      post.created = post.scheduledFor * 1000
      if (options.renumbered) post.id = `${this.page.id}_${this.next++}`
    }
  }

  seen(postId: string, times: number): void {
    const post = this.posts.find((p) => p.id === postId)
    if (post) post.views += times
  }

  react(postId: string, times: number): void {
    const post = this.posts.find((p) => p.id === postId)
    if (post) post.reactions += times
  }

  private postJson(post: FakePost): Record<string, unknown> {
    const all = this.comments.filter((c) => c.postId === post.id)
    return {
      id: post.id,
      ...(post.message ? { message: post.message } : {}),
      created_time: this.time(post.created),
      permalink_url: `https://www.facebook.com/${this.page.username ?? this.page.id}/posts/${post.id.split('_')[1]}`,
      from: { id: post.fromId, name: post.fromName },
      is_published: post.published,
      ...(post.scheduledFor !== null ? { scheduled_publish_time: post.scheduledFor } : {}),
      reactions: { data: [], summary: { total_count: post.reactions } },
      comments: { data: [], summary: { total_count: all.length } }
    }
  }

  private commentJson(comment: FakeComment): Record<string, unknown> {
    const own = comment.fromId === this.page.id
    return {
      id: comment.id,
      message: comment.message,
      created_time: this.time(comment.created),
      permalink_url: `https://www.facebook.com/${this.page.username ?? this.page.id}/posts/${comment.postId.split('_')[1]}?comment_id=${comment.id.split('_')[1]}`,
      ...(own || this.namesAuthors ? { from: { id: comment.fromId, name: comment.fromName } } : {}),
      ...(comment.parentId ? { parent: { id: comment.parentId } } : {})
    }
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    const ok = (result: unknown): HttpResponse => ({ status: 200, headers: {}, text: JSON.stringify(result) })
    const no = (code: number, message: string, status = 400): HttpResponse => ({ status, headers: {}, text: JSON.stringify({ error: { message, type: 'OAuthException', code } }) })
    if (url.host === 'rupload.facebook.com') {
      const upload = /^\/video-upload\/v\d+\.\d+\/(\d+)$/.exec(url.pathname)
      if (!upload) throw new Error(`Not a Reel upload address: ${url.origin}${url.pathname}`)
      const videoId = upload[1] as string
      const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
      const auth = headers.authorization ?? ''
      const params: Record<string, string> = {}
      if (headers.offset !== undefined) params.offset = headers.offset
      if (headers.file_size !== undefined) params.file_size = headers.file_size
      this.calls.push({ method: req.method, path: `rupload/${videoId}`, params, files: req.file ? [req.file.name] : [] })
      if (auth !== `OAuth ${this.token}`) return no(190, 'Error validating access token: Session has expired.')
      if (this.failNext && this.failNext !== 'lost') {
        const failure = this.failNext
        this.failNext = null
        return no(failure.code, failure.message, failure.status ?? 400)
      }
      const lose = this.failNext === 'lost'
      if (lose) this.failNext = null
      const reel = this.reels.get(videoId)
      if (!reel) return no(100, `(#100) Unknown Reel upload ${videoId}`)
      if (!req.file) return no(100, '(#100) No file bytes were sent')
      reel.uploaded = true
      reel.fileName = req.file.name
      reel.fileSize = Number(headers.file_size ?? 0)
      if (lose) throw new HttpNoAnswerError('no answer within 30 seconds')
      return ok({ success: true })
    }
    const hit = /^\/v\d+\.\d+\/(.+)$/.exec(url.pathname)
    if (url.host !== 'graph.facebook.com' || !hit) throw new Error(`Not a Graph API address: ${url.origin}${url.pathname}`)
    const path = hit[1] as string
    const params: Record<string, string> = Object.fromEntries(url.searchParams)
    const files: string[] = []
    for (const [name, value] of Object.entries(req.form ?? {})) {
      if (typeof value === 'string') params[name] = value
      else files.push(`${name}:${value.name}`)
    }
    const token = params.access_token
    delete params.access_token
    this.calls.push({ method: req.method, path, params, files })
    if (token === FAKE_USER_TOKEN) {
      // A person's token: it has no field of a Page.
      return path === 'me' ? no(100, '(#100) Tried accessing nonexisting field (category) on node type (User)') : no(200, '(#200) This needs a Page access token')
    }
    if (token !== this.token) return no(190, 'Error validating access token: Session has expired.')
    if (req.method === 'GET') return this.read(path, params, ok, no)
    if (req.method === 'DELETE') {
      const at = this.posts.findIndex((p) => p.id === path)
      if (at < 0) return no(100, `Unsupported delete request. Object with ID '${path}' does not exist`)
      if (this.refusesDelete) return no(200, '(#200) This app may not delete the post')
      this.posts.splice(at, 1)
      return ok({ success: true })
    }
    if (this.failNext && this.failNext !== 'lost') {
      const failure = this.failNext
      this.failNext = null
      return no(failure.code, failure.message, failure.status ?? 400)
    }
    const lose = this.failNext === 'lost'
    if (lose) this.failNext = null
    const answer = this.make(path, params, files, ok, no)
    if (lose) throw new HttpNoAnswerError('no answer within 30 seconds')
    return answer
  }

  private read(path: string, params: Record<string, string>, ok: (r: unknown) => HttpResponse, no: (c: number, m: string) => HttpResponse): HttpResponse {
    const limit = Number(params.limit ?? 25)
    if (path === 'me') return ok({ id: this.page.id, name: this.page.name, ...(this.page.username ? { username: this.page.username } : {}), link: `https://www.facebook.com/${this.page.username ?? this.page.id}`, category: 'Astrologist' })
    if (path === this.page.id) return ok({ id: this.page.id, followers_count: 321 })
    if (path === `${this.page.id}/feed`) {
      // A video's post shows only after Facebook has processed the video: some readings later.
      const shown = this.posts.filter((p) => p.published && !this.processing.has(p.id))
      for (const [id, left] of [...this.processing]) {
        if (left <= 1) this.processing.delete(id)
        else this.processing.set(id, left - 1)
      }
      return ok({ data: shown.slice(0, limit).map((p) => this.postJson(p)) })
    }
    if (path === `${this.page.id}/scheduled_posts`) return ok({ data: this.kept.slice(0, limit).map((p) => this.postJson(p)) })
    if (path === `${this.page.id}/video_reels`) {
      const shown = [...this.reels.values()].filter((r) => r.finished && !r.error && (r.published || r.looksLeft <= 1)).reverse()
      return ok({ data: shown.slice(0, limit).map((r) => ({ id: r.id, description: r.description, updated_time: r.updatedTime })) })
    }
    const reel = this.reels.get(path)
    if (reel) {
      if (params.fields === 'permalink_url') return ok({ permalink_url: `/reel/${reel.id}/` })
      if (params.fields === 'status') {
        if (reel.looksLeft > 1) {
          reel.looksLeft -= 1
          return ok({ status: { video_status: 'processing', uploading_phase: { status: 'complete' }, processing_phase: { status: 'in_progress' }, publishing_phase: { status: 'not_started' } } })
        }
        reel.looksLeft = 0
        if (reel.error) {
          return ok({ status: { video_status: 'error', uploading_phase: { status: 'complete' }, processing_phase: { status: 'error', errors: [{ message: reel.error }] }, publishing_phase: { status: 'not_started' } } })
        }
        reel.published = true
        return ok({ status: { video_status: 'ready', uploading_phase: { status: 'complete' }, processing_phase: { status: 'complete' }, publishing_phase: { status: 'complete', publish_status: 'published' } } })
      }
      return ok({ id: reel.id, description: reel.description, updated_time: reel.updatedTime })
    }
    const insights = /^(\d+_\d+)\/insights$/.exec(path)
    if (insights) {
      const seen = this.posts.find((p) => p.id === insights[1])
      if (!seen) return no(100, `Unsupported get request. Object with ID '${insights[1]}' does not exist`)
      if (!this.givesViews) return no(200, '(#200) Requires the read_insights permission')
      if (params.metric !== 'post_media_view') return no(100, `(#100) The value must be a valid insights metric`)
      return ok({ data: [{ name: 'post_media_view', period: 'lifetime', values: [{ value: seen.views }], title: 'Views', description: 'Lifetime', id: `${seen.id}/insights/post_media_view/lifetime` }] })
    }
    const comments = /^(\d+(?:_\d+)?)\/comments$/.exec(path)
    if (comments) {
      const id = comments[1] as string
      const post = this.posts.find((p) => p.id === id)
      const under = post ? this.comments.filter((c) => c.postId === id) : this.comments.filter((c) => c.parentId === id)
      if (!post && !this.comments.some((c) => c.id === id)) return no(100, `Unsupported get request. Object with ID '${id}' does not exist`)
      const ordered = params.order === 'reverse_chronological' ? [...under].reverse() : under
      return ok({ data: ordered.slice(0, limit).map((c) => this.commentJson(c)), ...(ordered.length > limit ? { paging: { next: 'https://graph.facebook.com/next' } } : {}) })
    }
    const post = this.posts.find((p) => p.id === path)
    if (post) return ok(this.postJson(post))
    const comment = this.comments.find((c) => c.id === path)
    if (comment) return ok(this.commentJson(comment))
    return no(100, `Unsupported get request. Object with ID '${path}' does not exist`)
  }

  private make(path: string, params: Record<string, string>, files: string[], ok: (r: unknown) => HttpResponse, no: (c: number, m: string) => HttpResponse): HttpResponse {
    if (path === `${this.page.id}/feed`) {
      const attached = Object.keys(params).filter((k) => k.startsWith('attached_media['))
      // A post for later: unpublished, with its time between 10 minutes and 30 days ahead; its photos must have been uploaded as temporary.
      const later = params.published === 'false'
      const at = Number(params.scheduled_publish_time)
      if (later) {
        if (!Number.isInteger(at)) return no(100, '(#100) An unpublished post needs scheduled_publish_time')
        if (at * 1000 < this.nowMs + 10 * 60_000 || at * 1000 > this.nowMs + 30 * 24 * 3_600_000) return no(100, '(#100) The specified scheduled publish time is invalid.')
        if (attached.length > 0 && params.unpublished_content_type !== 'SCHEDULED') return no(100, '(#100) A scheduled post with photos needs unpublished_content_type')
      } else if (params.scheduled_publish_time !== undefined) return no(100, '(#100) scheduled_publish_time needs published=false')
      for (const key of attached) {
        const id = (JSON.parse(params[key] as string) as { media_fbid: string }).media_fbid
        const photo = this.unpublishedPhotos.get(id)
        if (!photo) return no(100, `(#100) Invalid parameter: no unpublished photo ${id}`)
        if (later && !photo.temporary) return no(100, '(#100) A photo of a scheduled post must be uploaded with temporary=true')
        this.unpublishedPhotos.delete(id)
      }
      if (!params.message && !params.link && attached.length === 0) return no(100, '(#100) Either link or message must be supplied')
      const post = this.newPost(params.message ?? '', this.page, { photos: attached.length, link: params.link ?? null })
      if (later) {
        post.published = false
        post.scheduledFor = at
      }
      return ok({ id: post.id })
    }
    if (path === `${this.page.id}/video_reels`) {
      if (params.upload_phase === 'start') {
        const videoId = String(this.next++)
        this.reels.set(videoId, { id: videoId, uploaded: false, fileName: null, fileSize: null, finished: false, description: '', updatedTime: Math.floor(this.nowMs / 1000), looksLeft: this.reelLooks, error: this.reelError, published: false })
        return ok({ video_id: videoId, upload_url: `https://rupload.facebook.com/video-upload/v27.0/${videoId}` })
      }
      if (params.upload_phase === 'finish') {
        const reel = params.video_id ? this.reels.get(params.video_id) : undefined
        if (!reel) return no(100, `(#100) Unknown Reel ${params.video_id ?? ''}`)
        if (!reel.uploaded) return no(100, '(#100) The video has not been uploaded yet')
        if (params.video_state !== 'PUBLISHED') return no(100, '(#100) Expected video_state=PUBLISHED')
        reel.finished = true
        reel.description = params.description ?? ''
        reel.updatedTime = Math.floor(this.nowMs / 1000)
        return ok({ success: true })
      }
      return no(100, `(#100) Unsupported upload_phase: ${params.upload_phase ?? ''}`)
    }
    if (path === `${this.page.id}/videos`) {
      const source = files.find((f) => f.startsWith('source:'))
      if (!source) return no(100, '(#100) A video needs a file or an address')
      const videoId = String(this.next++)
      this.videos.set(videoId, source.slice('source:'.length))
      const post = this.newPost(params.description ?? '', this.page)
      if (this.videoLooks > 0) this.processing.set(post.id, this.videoLooks)
      // The answer names the video, never the post.
      return ok({ id: videoId })
    }
    if (path === `${this.page.id}/photos`) {
      if (!files.some((f) => f.startsWith('source:'))) return no(100, '(#100) A photo needs a file or an address')
      const photoId = String(this.next++)
      if (params.temporary === 'true' && params.published !== 'false') return no(100, '(#100) A temporary photo must be unpublished')
      if (params.published === 'false') {
        this.unpublishedPhotos.set(photoId, { temporary: params.temporary === 'true' })
        return ok({ id: photoId })
      }
      return ok({ id: photoId, post_id: this.newPost(params.caption ?? '', this.page, { photos: 1 }).id })
    }
    const under = /^(\d+(?:_\d+)?)\/comments$/.exec(path)
    if (under) {
      const id = under[1] as string
      const post = this.posts.find((p) => p.id === id)
      const parent = this.comments.find((c) => c.id === id)
      if (!post && !parent) return no(100, `Unsupported post request. Object with ID '${id}' does not exist`)
      const postId = post ? post.id : (parent as FakeComment).postId
      const made: FakeComment = { id: `${postId.split('_')[1]}_${this.next++}`, postId, parentId: parent ? parent.id : null, message: params.message ?? '', created: this.nowMs, fromId: this.page.id, fromName: this.page.name }
      this.comments.push(made)
      return ok({ id: made.id })
    }
    return no(100, `Unsupported post request: ${path}`)
  }
}
