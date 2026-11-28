// The Instagram API with Instagram Login as this application uses it for one professional account: one request, one answer in the API's own
// shape. The access token travels as a parameter of a read and in the Authorization header of a write, as Meta's pages show them, and is never
// put into an error, a log line or a result.
import type { HttpPort, HttpResponse } from '../../core/ports'

/** The host and the version the examples of Meta's Instagram pages use (read 2026-11-27). The token call has no version in its address. */
export const INSTAGRAM = 'https://graph.instagram.com'
export const VERSION = 'v27.0'

/**
 * `status` is the HTTP status; `code` is the API's own number, 0 when it gave none. Meta's Instagram pages show one whole refusal, in the
 * Graph's shape (`error.message`, `error.code`, `error.error_user_msg`); the flat shape of the sign-in calls (`error_type`, `error_message`)
 * is read as well. Neither was seen from a real request.
 */
export type InstagramAnswer<T> = { ok: true; result: T } | { ok: false; status: number; code: number; message: string }

/** `user_id` is the id of the professional account, which the publishing pages use in their addresses; `id` is the id inside the app. */
export interface InstagramProfile {
  id?: string
  user_id?: string
  username?: string
  name?: string
  account_type?: string
  followers_count?: number
}

export interface InstagramMedia {
  id: string
  caption?: string
  media_type?: string
  permalink?: string
  /** ISO 8601, written like "2026-11-20T10:00:00+0000". */
  timestamp?: string
  username?: string
  comments_count?: number
  like_count?: number
}

export interface InstagramComment {
  id: string
  text?: string
  username?: string
  timestamp?: string
  from?: { id?: string; username?: string }
  parent_id?: string
  replies?: { data?: InstagramComment[] }
}

export interface InstagramList<T> {
  data?: T[]
  paging?: { cursors?: { before?: string; after?: string }; next?: string }
}

/** A container before it is published: `FINISHED` may be published, `IN_PROGRESS` is waited for, `ERROR` and `EXPIRED` never will be. */
export interface InstagramContainer {
  id: string
  status_code?: string
  /** When `status_code` is `ERROR`, what went wrong, as Instagram words it. */
  status?: string
}

export interface InstagramInsights {
  data?: { name?: string; values?: { value?: unknown }[] }[]
}

export interface InstagramToken {
  access_token?: string
  expires_in?: number
}

function read<T>(response: HttpResponse, token: string): InstagramAnswer<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    parsed = null
  }
  const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const nested = body && typeof body.error === 'object' && body.error !== null ? (body.error as Record<string, unknown>) : null
  const flat = body && typeof body.error_type === 'string' ? body : null
  const failure = nested ?? flat
  if (response.status >= 200 && response.status < 300 && body && !failure) return { ok: true, result: body as T }
  // The words Instagram wrote for a person come first: its `message` is often one word ("Fatal").
  const said = nested ? (typeof nested.error_user_msg === 'string' && nested.error_user_msg !== '' ? nested.error_user_msg : nested.message) : flat ? flat.error_message : undefined
  const message = (typeof said === 'string' && said !== '' ? said : `HTTP ${response.status}`).replaceAll(token, '[token]')
  return { ok: false, status: response.status, code: typeof failure?.code === 'number' ? failure.code : 0, message }
}

export class InstagramApi {
  constructor(
    private readonly http: HttpPort,
    private readonly token: string
  ) {}

  /** Reads an object or a list. It throws only when Instagram gave no answer (`HttpNoAnswerError`). */
  async get<T>(path: string, params: Record<string, string> = {}): Promise<InstagramAnswer<T>> {
    const query = new URLSearchParams({ ...params, access_token: this.token })
    return read<T>(await this.http.request({ method: 'GET', url: `${INSTAGRAM}/${VERSION}/${path}?${query.toString()}` }), this.token)
  }

  /** Makes something: a JSON body, the token in the Authorization header. */
  async post<T>(path: string, body: Record<string, unknown>): Promise<InstagramAnswer<T>> {
    return read<T>(await this.http.request({ method: 'POST', url: `${INSTAGRAM}/${VERSION}/${path}`, headers: { authorization: `Bearer ${this.token}` }, json: body }), this.token)
  }

  /** Makes a token of 60 days last 60 days from now. Instagram does it for a token at least a day old that has not ended; no secret is needed. */
  async refresh(): Promise<InstagramAnswer<InstagramToken>> {
    const query = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: this.token })
    return read<InstagramToken>(await this.http.request({ method: 'GET', url: `${INSTAGRAM}/refresh_access_token?${query.toString()}` }), this.token)
  }
}

/** An Instagram access token as Meta shows it: one long word. Whose it is is asked from Instagram when it is saved. */
export const looksLikeInstagramToken = (key: string): boolean => /^[A-Za-z0-9_|.-]{50,}$/.test(key)
