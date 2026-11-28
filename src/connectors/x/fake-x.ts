// An X that lives in a test: one account, one developer app that is a public client, the token address of OAuth 2.0 with PKCE (a code used
// once, an access token of two hours, a refresh token used once), and the few addresses of API v2 this application calls: making a post or an
// answer (refused when the answered post does not name the account), a picture upload, the account's own posts, what names the account, and
// posts by their ids.
import { createHash } from 'node:crypto'
import { HttpNoAnswerError } from '../../core/net/http'
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'

export const FAKE_X_CLIENT = 'ZmFrZUNsaWVudElkT2ZUaGVBcHA6MTpjaQ'

export interface FakeXPost {
  id: string
  text: string
  created_at: string
  /** The names of the uploaded files, in their order. */
  media: string[]
  /** The id of who wrote it. */
  author: string
  /** The post it answers; null for one that starts a conversation. */
  replyTo: string | null
  /** The post its conversation started with. */
  conversation: string
  /** Whether it names the account (a reply does, unless its writer took the name out). */
  names: boolean
}

export class FakeX implements HttpPort {
  user = { id: '2244994945', name: 'Natal Mystic', username: 'NatalMystic' }
  clientId = FAKE_X_CLIENT
  now: () => Date = () => new Date()
  /** The next request that makes something fails this way, once: an error answer, or no answer at all after X acted. */
  failNext: { status: number; title: string; detail: string; type?: string; on?: 'upload' | 'post' } | 'lost' | null = null
  /** False makes X answer a new post with no id. */
  namesPosts = true
  /** The numbers under each post. */
  numbers: Record<string, { like_count: number; reply_count: number; impression_count: number }> = {}
  /** How many posts a page of a list holds at most, whatever is asked for. */
  pageSize = 100
  readonly calls: { method: string; path: string; body: unknown; auth: boolean }[] = []
  /** How many posts X gave, by the address: X charges for each. */
  readonly given = { own: 0, named: 0, byId: 0 }
  /** Every post, the newest first. */
  readonly all: FakeXPost[] = []
  readonly uploads = new Map<string, { name: string; category: string }>()
  /** The videos on their way: the size X was told, the segments it got (their sizes, by their number), and how many more times its state is asked before it is processed. */
  readonly videos = new Map<string, { mime: string; total: number; segments: number[]; name: string; closed: boolean; looks: number }>()
  /** How many times a video's state reads "in_progress" after it is closed; `failsVideo` makes its processing fail. */
  videoLooks = 1
  failsVideo = false
  private readonly people = new Map<string, string>()
  private readonly codes = new Map<string, { challenge: string; redirectUri: string }>()
  private readonly access = new Map<string, number>()
  readonly refresh = new Set<string>()
  private next = 5000

  /** The account's own posts and answers, the newest first. */
  get posts(): FakeXPost[] {
    return this.all.filter((post) => post.author === this.user.id)
  }

  private personId(username: string): string {
    for (const [id, name] of this.people) if (name === username) return id
    const id = `77${this.next++}`
    this.people.set(id, username)
    return id
  }

  private add(post: Omit<FakeXPost, 'id' | 'created_at' | 'conversation'> & { conversation?: string }): FakeXPost {
    const id = `18${this.next++}`
    const made: FakeXPost = { ...post, id, created_at: this.now().toISOString(), conversation: post.conversation ?? id }
    this.all.unshift(made)
    return made
  }

  /** Somebody answers a post. X puts the name of the answered person first, unless the writer takes it out (`names: false`). */
  replies(toId: string, text: string, username = 'stargazer', options: { names?: boolean } = {}): FakeXPost {
    const parent = this.all.find((post) => post.id === toId)
    if (!parent) throw new Error(`no post ${toId}`)
    const toAccount = parent.author === this.user.id
    const names = options.names ?? toAccount
    return this.add({ text: names ? `@${this.user.username} ${text}` : text, media: [], author: this.personId(username), replyTo: toId, conversation: parent.conversation, names })
  }

  /** Somebody names the account in a post of their own. */
  mentions(text: string, username = 'stargazer'): FakeXPost {
    return this.add({ text: `${text} @${this.user.username}`, media: [], author: this.personId(username), replyTo: null, names: true })
  }

  /** The owner presses "Authorize app" on X's page: X checks what the page was opened with and gives the code it sends the browser back with. */
  authorize(page: string): { code: string; state: string; redirectUri: string } {
    const url = new URL(page)
    const q = url.searchParams
    if (`${url.origin}${url.pathname}` !== 'https://x.com/i/oauth2/authorize') throw new Error('not the authorize page')
    if (q.get('response_type') !== 'code' || q.get('client_id') !== this.clientId || q.get('code_challenge_method') !== 'S256') throw new Error('the authorize page was opened wrongly')
    for (const scope of ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']) if (!(q.get('scope') ?? '').split(' ').includes(scope)) throw new Error(`scope ${scope} is missing`)
    const code = `code_${this.next++}`
    this.codes.set(code, { challenge: q.get('code_challenge') ?? '', redirectUri: q.get('redirect_uri') ?? '' })
    return { code, state: q.get('state') ?? '', redirectUri: q.get('redirect_uri') ?? '' }
  }

  private pair(): HttpResponse {
    const access = `access_${this.next++}_fakeAccessTokenOfTwoHours`
    const refresh = `refresh_${this.next++}_fakeRefreshTokenUsedOnce`
    this.access.set(access, this.now().getTime() + 7_200_000)
    this.refresh.add(refresh)
    return this.json(200, { token_type: 'bearer', expires_in: 7200, access_token: access, refresh_token: refresh, scope: 'tweet.read tweet.write users.read media.write offline.access' })
  }

  private json(status: number, body: unknown): HttpResponse {
    return { status, headers: {}, text: JSON.stringify(body) }
  }

  private problem(status: number, title: string, detail: string, type = 'about:blank'): HttpResponse {
    return this.json(status, { title, detail, type, status })
  }

  private fails(on: 'upload' | 'post'): HttpResponse | null {
    const fail = this.failNext
    if (!fail || fail === 'lost' || (fail.on ?? 'post') !== on) return null
    this.failNext = null
    return this.problem(fail.status, fail.title, fail.detail, fail.type)
  }

  /** A post as X gives it: its id and words always, the rest when asked for. */
  private shown(post: FakeXPost, fields: string[]): Record<string, unknown> {
    const parent = post.replyTo ? this.all.find((other) => other.id === post.replyTo) : undefined
    return {
      id: post.id,
      text: post.text,
      ...(fields.includes('created_at') ? { created_at: post.created_at } : {}),
      ...(fields.includes('author_id') ? { author_id: post.author } : {}),
      ...(fields.includes('conversation_id') ? { conversation_id: post.conversation } : {}),
      ...(fields.includes('in_reply_to_user_id') && parent ? { in_reply_to_user_id: parent.author } : {}),
      ...(fields.includes('referenced_tweets') && post.replyTo ? { referenced_tweets: [{ type: 'replied_to', id: post.replyTo }] } : {}),
      ...(fields.includes('public_metrics') ? { public_metrics: { retweet_count: 0, quote_count: 0, bookmark_count: 0, ...(this.numbers[post.id] ?? { like_count: 0, reply_count: 0, impression_count: 0 }) } } : {})
    }
  }

  /** A page of a list, the newest first, within what the request bounds it by. */
  private list(posts: FakeXPost[], q: URLSearchParams, counted: 'own' | 'named'): HttpResponse {
    const since = q.get('since_id')
    const until = q.get('until_id')
    const start = q.get('start_time')
    if (start !== null && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(start)) return this.problem(400, 'Invalid Request', 'The `start_time` query parameter value is not a valid RFC3339 date-time.')
    const max = Number(q.get('max_results') ?? '10')
    if (!Number.isInteger(max) || max < 5 || max > 100) return this.problem(400, 'Invalid Request', 'The `max_results` query parameter value is not between 5 and 100')
    const within = posts.filter((post) => (since === null || BigInt(post.id) > BigInt(since)) && (until === null || BigInt(post.id) < BigInt(until)) && (start === null || Date.parse(post.created_at) >= Date.parse(start)))
    const size = Math.min(max, this.pageSize)
    const from = Number(q.get('pagination_token') ?? '0')
    const page = within.slice(from, from + size)
    this.given[counted] += page.length
    const fields = (q.get('tweet.fields') ?? '').split(',')
    const authors = q.get('expansions') === 'author_id' ? [...new Set(page.map((post) => post.author))].map((id) => ({ id, name: this.people.get(id) ?? '', username: this.people.get(id) ?? '' })) : null
    return this.json(200, {
      ...(page.length > 0 ? { data: page.map((post) => this.shown(post, fields)) } : {}),
      ...(authors && authors.length > 0 ? { includes: { users: authors } } : {}),
      meta: { result_count: page.length, ...(from + size < within.length ? { next_token: String(from + size) } : {}) }
    })
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    if (url.host !== 'api.x.com' || !url.pathname.startsWith('/2/')) return this.problem(404, 'Not Found', 'Not Found')
    const path = url.pathname.slice('/2/'.length)
    const q = url.searchParams
    const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? null
    const file = req.form && typeof req.form.media === 'object' ? req.form.media.name : null
    this.calls.push({ method: req.method, path: `${path}${url.search}`, body: req.json ?? (req.urlencoded ? { grant_type: req.urlencoded.grant_type } : file ? { file } : null), auth: bearer !== null })

    if (req.method === 'POST' && path === 'oauth2/token') {
      const form = req.urlencoded ?? {}
      const invalid = (description: string): HttpResponse => this.json(400, { error: 'invalid_request', error_description: description })
      if (form.client_id !== this.clientId) return this.json(401, { error: 'unauthorized_client', error_description: 'Missing valid authorization header' })
      if (form.grant_type === 'authorization_code') {
        const issued = this.codes.get(form.code ?? '')
        this.codes.delete(form.code ?? '')
        if (!issued || issued.redirectUri !== form.redirect_uri) return invalid('Value passed for the authorization code was invalid.')
        if (createHash('sha256').update(form.code_verifier ?? '').digest('base64url') !== issued.challenge) return invalid('Value passed for the code verifier did not match the code challenge.')
        return this.pair()
      }
      if (form.grant_type === 'refresh_token') {
        // A refresh token is used once.
        if (!this.refresh.delete(form.refresh_token ?? '')) return invalid('Value passed for the token was invalid.')
        return this.pair()
      }
      return invalid('Value passed for the grant type was invalid.')
    }

    const until = bearer ? this.access.get(bearer) : undefined
    if (until === undefined || until <= this.now().getTime()) return this.problem(401, 'Unauthorized', 'Unauthorized')

    if (req.method === 'GET' && path === 'users/me') return this.json(200, { data: this.user })

    if (req.method === 'POST' && path === 'media/upload/initialize') {
      const refused = this.fails('upload')
      if (refused) return refused
      const body = req.json as { media_type?: string; total_bytes?: number; media_category?: string }
      if (!['video/mp4', 'video/quicktime'].includes(body.media_type ?? '') || !Number.isInteger(body.total_bytes) || (body.total_bytes as number) <= 0 || body.media_category !== 'tweet_video') return this.problem(400, 'Invalid Request', 'One or more parameters to your request was invalid.')
      const id = `18${this.next++}`
      this.videos.set(id, { mime: body.media_type as string, total: body.total_bytes as number, segments: [], name: '', closed: false, looks: this.videoLooks })
      return this.json(200, { data: { id, media_key: `13_${id}`, expires_after_secs: 86_400 } })
    }
    const step = /^media\/upload\/(\d+)\/(append|finalize)$/.exec(path)
    if (req.method === 'POST' && step) {
      const video = this.videos.get(step[1] as string)
      if (!video || video.closed) return this.problem(400, 'Invalid Request', 'The media upload does not exist or is closed.')
      if (step[2] === 'append') {
        const segment = req.form?.media
        const index = Number(req.form?.segment_index)
        if (!segment || typeof segment === 'string' || !segment.part || !Number.isInteger(index) || index !== video.segments.length) return this.problem(400, 'Invalid Request', 'One or more parameters to your request was invalid.')
        const size = segment.part.end - segment.part.start
        // X takes a segment of 5 MB at most.
        if (size <= 0 || size > 5 * 1024 * 1024) return this.problem(413, 'Payload Too Large', 'The segment is too large.')
        video.segments.push(size)
        video.name = segment.name
        return this.json(200, { data: { expires_at: 0 } })
      }
      if (video.segments.reduce((sum, size) => sum + size, 0) !== video.total) return this.problem(400, 'Invalid Request', 'The uploaded segments do not make the size the upload was started with.')
      video.closed = true
      this.uploads.set(step[1] as string, { name: video.name, category: 'tweet_video' })
      return this.json(200, { data: { id: step[1], media_key: `13_${step[1]}`, size: video.total, ...(video.looks > 0 || this.failsVideo ? { processing_info: { state: 'pending', check_after_secs: 1 } } : {}) } })
    }
    if (req.method === 'GET' && path === 'media/upload') {
      const video = this.videos.get(q.get('media_id') ?? '')
      if (q.get('command') !== 'STATUS' || !video || !video.closed) return this.problem(400, 'Invalid Request', 'One or more parameters to your request was invalid.')
      if (this.failsVideo) return this.json(200, { data: { id: q.get('media_id'), processing_info: { state: 'failed' } } })
      if (video.looks > 0) {
        video.looks -= 1
        return this.json(200, { data: { id: q.get('media_id'), processing_info: { state: 'in_progress', check_after_secs: 2, progress_percent: 50 } } })
      }
      return this.json(200, { data: { id: q.get('media_id'), processing_info: { state: 'succeeded', progress_percent: 100 } } })
    }

    if (req.method === 'POST' && path === 'media/upload') {
      const refused = this.fails('upload')
      if (refused) return refused
      const category = typeof req.form?.media_category === 'string' ? req.form.media_category : ''
      if (!file || !['tweet_image', 'tweet_gif'].includes(category)) return this.problem(400, 'Invalid Request', 'One or more parameters to your request was invalid.')
      const id = `19${this.next++}`
      this.uploads.set(id, { name: file, category })
      return this.json(200, { data: { id, media_key: `3_${id}`, expires_after_secs: 86_400 } })
    }

    if (req.method === 'POST' && path === 'tweets') {
      const refused = this.fails('post')
      if (refused) return refused
      const body = req.json as { text?: string; media?: { media_ids?: string[] }; reply?: { in_reply_to_tweet_id?: string } }
      const ids = body.media?.media_ids ?? []
      if (typeof body.text !== 'string' || (body.text === '' && ids.length === 0)) return this.problem(400, 'Invalid Request', 'One or more parameters to your request was invalid.')
      if ([...body.text].length > 280) return this.problem(403, 'Forbidden', 'You are not permitted to post a Post this long.')
      if (ids.some((id) => !this.uploads.has(id)) || ids.length > 4) return this.problem(400, 'Invalid Request', 'Your media IDs are invalid.')
      // A video stands alone in a post, and only once X has processed it.
      const filmed = ids.filter((id) => this.videos.has(id))
      if (filmed.length > 0 && (ids.length > 1 || (this.videos.get(filmed[0] as string)?.looks ?? 0) > 0 || this.failsVideo)) return this.problem(400, 'Invalid Request', 'Your media IDs are invalid.')
      const parent = body.reply ? this.all.find((post) => post.id === body.reply?.in_reply_to_tweet_id) : undefined
      if (body.reply && !parent) return this.problem(400, 'Invalid Request', 'You attempted to reply to a Post that is deleted or not visible to you.')
      // An answer is taken only when the answered post names the account (or is the account's own).
      if (parent && parent.author !== this.user.id && !parent.names) return this.problem(403, 'Forbidden', 'Reply to this conversation is not allowed because you have not been mentioned or otherwise engaged by the author of the post you are replying to.')
      const words = body.text.replace(/https?:\/\/\S+/g, 'https://t.co/AbCdEf')
      const names = parent && parent.author !== this.user.id ? `@${this.people.get(parent.author)} ` : ''
      const post = this.add({ text: `${names}${words}`, media: ids.map((id) => this.uploads.get(id)?.name ?? ''), author: this.user.id, replyTo: parent?.id ?? null, ...(parent ? { conversation: parent.conversation } : {}), names: false })
      if (this.failNext === 'lost') {
        this.failNext = null
        throw new HttpNoAnswerError('the connection failed')
      }
      return this.json(201, { data: this.namesPosts ? { id: post.id, text: post.text } : {} })
    }

    if (req.method === 'GET' && path === 'tweets') {
      const ids = (q.get('ids') ?? '').split(',')
      const found = this.all.filter((post) => ids.includes(post.id))
      this.given.byId += found.length
      return this.json(200, { data: found.map((post) => this.shown(post, (q.get('tweet.fields') ?? '').split(','))) })
    }

    if (req.method === 'GET' && path === `users/${this.user.id}/tweets`) {
      const exclude = (q.get('exclude') ?? '').split(',')
      return this.list(this.posts.filter((post) => !exclude.includes('replies') || post.replyTo === null), q, 'own')
    }

    if (req.method === 'GET' && path === `users/${this.user.id}/mentions`) return this.list(this.all.filter((post) => post.author !== this.user.id && post.names), q, 'named')

    return this.problem(404, 'Not Found', 'Not Found')
  }
}
