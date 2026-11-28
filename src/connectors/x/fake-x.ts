// An X that lives in a test: one account, one developer app that is a public client, the token address of OAuth 2.0 with PKCE (a code used
// once, an access token of two hours, a refresh token used once), and the few addresses of API v2 this application calls.
import { createHash } from 'node:crypto'
import { HttpNoAnswerError } from '../../core/net/http'
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'

export const FAKE_X_CLIENT = 'ZmFrZUNsaWVudElkT2ZUaGVBcHA6MTpjaQ'

interface FakeXPost {
  id: string
  text: string
  created_at: string
  /** The names of the uploaded files, in their order. */
  media: string[]
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
  readonly calls: { method: string; path: string; body: unknown; auth: boolean }[] = []
  readonly posts: FakeXPost[] = []
  readonly uploads = new Map<string, { name: string; category: string }>()
  private readonly codes = new Map<string, { challenge: string; redirectUri: string }>()
  private readonly access = new Map<string, number>()
  readonly refresh = new Set<string>()
  private next = 5000

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

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    if (url.host !== 'api.x.com' || !url.pathname.startsWith('/2/')) return this.problem(404, 'Not Found', 'Not Found')
    const path = url.pathname.slice('/2/'.length)
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
      const body = req.json as { text?: string; media?: { media_ids?: string[] } }
      const ids = body.media?.media_ids ?? []
      if (typeof body.text !== 'string' || (body.text === '' && ids.length === 0)) return this.problem(400, 'Invalid Request', 'One or more parameters to your request was invalid.')
      if ([...body.text].length > 280) return this.problem(403, 'Forbidden', 'You are not permitted to post a Post this long.')
      if (ids.some((id) => !this.uploads.has(id)) || ids.length > 4) return this.problem(400, 'Invalid Request', 'Your media IDs are invalid.')
      const post: FakeXPost = { id: `18${this.next++}`, text: body.text.replace(/https?:\/\/\S+/g, 'https://t.co/AbCdEf'), created_at: this.now().toISOString(), media: ids.map((id) => this.uploads.get(id)?.name ?? '') }
      this.posts.unshift(post)
      if (this.failNext === 'lost') {
        this.failNext = null
        throw new HttpNoAnswerError('the connection failed')
      }
      return this.json(201, { data: this.namesPosts ? { id: post.id, text: post.text } : {} })
    }

    if (req.method === 'GET' && path === 'tweets') {
      const ids = (url.searchParams.get('ids') ?? '').split(',')
      if (url.searchParams.get('tweet.fields') !== 'public_metrics') return this.problem(400, 'Invalid Request', 'tweet.fields')
      const data = this.posts.filter((post) => ids.includes(post.id)).map((post) => ({ id: post.id, text: post.text, public_metrics: { retweet_count: 0, quote_count: 0, bookmark_count: 0, ...(this.numbers[post.id] ?? { like_count: 0, reply_count: 0, impression_count: 0 }) } }))
      return this.json(200, { data })
    }

    if (req.method === 'GET' && path === `users/${this.user.id}/tweets`) return this.json(200, { data: this.posts.slice(0, 5).map((post) => ({ id: post.id, text: post.text, created_at: post.created_at })) })

    return this.problem(404, 'Not Found', 'Not Found')
  }
}
