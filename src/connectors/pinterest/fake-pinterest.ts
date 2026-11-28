// A Pinterest that lives in a test: one business account that owns one developer app, its boards and its pins, in the shapes of
// Pinterest's API v5 (the client-credentials token, the account, boards, pins, a pin's analytics).
import { HttpNoAnswerError } from '../../core/net/http'
import type { HttpPort, HttpRequest, HttpResponse } from '../../core/ports'

export const FAKE_PIN_APP_ID = '1234567'
export const FAKE_PIN_SECRET = 'fakePinterestAppSecretKey0123456789abcdef'

interface FakePin {
  id: string
  board_id: string
  title: string | null
  description: string | null
  link: string | null
  created_at: string
  /** The kind and the size of the picture that came with it. */
  picture: { type: string; bytes: number }
}

export class FakePinterest implements HttpPort {
  account = { id: '2783136121146311751', username: 'natalmystic', account_type: 'BUSINESS', business_name: 'Natal Mystic', follower_count: 10, monthly_views: 163 }
  boards = [
    { id: '549755885175', name: 'Natal Charts', privacy: 'PUBLIC' },
    { id: '549755885176', name: 'Moon & Stars!', privacy: 'PUBLIC' }
  ]
  /** The app's id and secret key Pinterest knows; changing the secret is what "the key was reset" looks like. */
  app = { id: FAKE_PIN_APP_ID, secret: FAKE_PIN_SECRET }
  /** False makes the token address refuse the way it does for an account without two-factor authentication. */
  twoFactor = true
  /** How many boards one page of the list holds. */
  pageSize = 100
  /** The next request that creates a pin fails this way, once: an error answer, or no answer at all after Pinterest acted. */
  failNext: { status: number; code: number; message: string } | 'lost' | null = null
  /** False makes Pinterest answer a new pin with no id. */
  namesPins = true
  /** The numbers of each pin: of the asked days, and since it was made. */
  numbers: Record<string, { IMPRESSION?: number; TOTAL_COMMENTS?: number; TOTAL_REACTIONS?: number }> = {}
  now: () => Date = () => new Date()
  readonly tokens = new Set<string>()
  readonly calls: { method: string; path: string; body: unknown; auth: 'basic' | 'bearer' | null }[] = []
  readonly pins: FakePin[] = []
  private next = 9000

  private json(status: number, body: unknown): HttpResponse {
    return { status, headers: {}, text: JSON.stringify(body) }
  }

  private error(status: number, code: number, message: string): HttpResponse {
    return this.json(status, { code, message })
  }

  /** Makes every token Pinterest gave stop working, as when it withdraws them. */
  withdrawTokens(): void {
    this.tokens.clear()
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/v5/')) return this.error(404, 1, 'Not found')
    const path = url.pathname.slice('/v5/'.length)
    const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]))
    const basic = /^Basic (.+)$/.exec(headers.authorization ?? '')?.[1] ?? null
    const bearer = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? null
    // A picture's bytes are not kept in the list of calls: only that one came.
    const shown = req.json && typeof req.json === 'object' && 'media_source' in req.json ? { ...(req.json as object), media_source: '[picture]' } : (req.json ?? req.urlencoded ?? null)
    this.calls.push({ method: req.method, path: `${path}${url.search}`, body: shown, auth: basic ? 'basic' : bearer ? 'bearer' : null })

    if (req.method === 'POST' && path === 'oauth/token') {
      const pair = basic ? Buffer.from(basic, 'base64').toString('utf8') : ''
      if (pair !== `${this.app.id}:${this.app.secret}`) return this.error(401, 2, 'Authentication failed.')
      if (req.urlencoded?.grant_type !== 'client_credentials' || !req.urlencoded.scope) return this.error(400, 1, 'Invalid request: grant_type')
      if (!this.twoFactor) return this.error(403, 29, 'Two-factor authentication is required for this grant type.')
      const token = `pinc_fakeTokenOfTheAppOwner_${this.next++}`
      this.tokens.add(token)
      return this.json(200, { access_token: token, response_type: 'client_credentials', token_type: 'bearer', expires_in: 2_592_000, scope: req.urlencoded.scope.replaceAll(',', ' ') })
    }

    if (bearer === null || !this.tokens.has(bearer)) return this.error(401, 2, 'Authentication failed.')

    if (req.method === 'GET' && path === 'user_account') return this.json(200, this.account)

    if (req.method === 'GET' && path === 'boards') {
      const from = Number(url.searchParams.get('bookmark') ?? '0')
      const items = this.boards.slice(from, from + this.pageSize)
      return this.json(200, { items, bookmark: from + this.pageSize < this.boards.length ? String(from + this.pageSize) : null })
    }

    if (req.method === 'GET' && path === 'pins') return this.json(200, { items: this.pins, bookmark: null })

    const analytics = /^pins\/(\d+)\/analytics$/.exec(path)
    if (req.method === 'GET' && analytics) {
      const pin = this.pins.find((p) => p.id === analytics[1])
      if (!pin) return this.error(404, 50, 'Pin not found.')
      const start = url.searchParams.get('start_date') ?? ''
      const end = url.searchParams.get('end_date') ?? ''
      const today = this.now().toISOString().slice(0, 10)
      const days = (Date.parse(end) - Date.parse(start)) / 86_400_000
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || end > today || days < 0 || days > 89 || (Date.parse(today) - Date.parse(start)) / 86_400_000 > 90) return this.error(400, 1, 'Invalid request: start_date or end_date')
      if (url.searchParams.get('metric_types') !== 'IMPRESSION,TOTAL_COMMENTS,TOTAL_REACTIONS') return this.error(400, 1, 'Invalid request: metric_types')
      const has = this.numbers[pin.id] ?? {}
      const lifetime = url.searchParams.get('pin_metrics') === 'true' ? { lifetime_metrics: { TOTAL_COMMENTS: has.TOTAL_COMMENTS ?? 0, TOTAL_REACTIONS: has.TOTAL_REACTIONS ?? 0 } } : {}
      return this.json(200, { all: { daily_metrics: [], ...lifetime, summary_metrics: { IMPRESSION: has.IMPRESSION ?? 0 } } })
    }

    if (req.method === 'POST' && path === 'pins') {
      const fail = this.failNext
      if (fail && fail !== 'lost') {
        this.failNext = null
        return this.error(fail.status, fail.code, fail.message)
      }
      const body = req.json as { board_id?: string; title?: string; description?: string; link?: string; media_source?: { source_type?: string; content_type?: string; data?: string } }
      if (!this.boards.some((board) => board.id === body.board_id)) return this.error(404, 40, 'Board not found.')
      const media = body.media_source
      if (media?.source_type !== 'image_base64' || !['image/jpeg', 'image/png'].includes(media.content_type ?? '') || !/^[a-zA-Z0-9+/=]+$/.test(media.data ?? '')) return this.error(400, 1, 'Invalid request: media_source')
      if ([...(body.title ?? '')].length > 100 || [...(body.description ?? '')].length > 800) return this.error(400, 1, 'Invalid request: title or description is too long')
      const pin: FakePin = {
        id: `81346${this.next++}`,
        board_id: body.board_id as string,
        title: body.title ?? null,
        description: body.description ?? null,
        link: body.link ?? null,
        created_at: this.now().toISOString(),
        picture: { type: media.content_type as string, bytes: Buffer.from(media.data as string, 'base64').length }
      }
      this.pins.unshift(pin)
      if (fail === 'lost') {
        this.failNext = null
        throw new HttpNoAnswerError('the connection failed')
      }
      return this.json(201, this.namesPins ? pin : {})
    }
    return this.error(404, 1, 'Not found')
  }
}
