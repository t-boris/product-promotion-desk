// The Threads API as this application uses it for one profile: one request, one answer in the API's own shape. The access token travels as a
// parameter of the request and is never put into an error, a log line or a result.
import type { HttpPort, HttpResponse } from '../../core/ports'

/** The host and the version every example of Meta's Threads pages uses (read 2026-11-27). The token calls have no version in their address. */
export const THREADS = 'https://graph.threads.com'
export const VERSION = 'v1.0'

/**
 * `status` is the HTTP status; `code` is the API's own number, 0 when it gave none. Meta's Threads pages show the shape of a refusal only for
 * the token calls (`error_type`, `code`, `error_message`); the Graph's own shape (`error.message`, `error.code`) is read as well, since the
 * API is the Graph's. Neither was seen from a real request.
 */
export type ThreadsAnswer<T> = { ok: true; result: T } | { ok: false; status: number; code: number; message: string }

export interface ThreadsProfile {
  id: string
  username?: string
  name?: string
}

export interface ThreadsMedia {
  id: string
  text?: string
  /** Written like "2023-10-17T05:42:03+0000". */
  timestamp?: string
  /** Left out by Threads for a private profile, and for media flagged for copyright. */
  permalink?: string
  username?: string
  media_type?: string
  has_replies?: boolean
  replied_to?: { id?: string }
  root_post?: { id?: string }
  is_reply_owned_by_me?: boolean
  hide_status?: string
}

export interface ThreadsList<T> {
  data?: T[]
  paging?: { cursors?: { before?: string; after?: string }; next?: string }
}

/** A container before it is published: `FINISHED` may be published, `IN_PROGRESS` is waited for, `ERROR` and `EXPIRED` never will be. */
export interface ThreadsContainer {
  id: string
  status?: string
  error_message?: string
}

/** One entry per metric: the number in `values[0].value` for a post, in `total_value.value` for the profile. */
export interface ThreadsInsights {
  data?: { name?: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } }[]
}

/** What a token call gives: the token and the seconds it lasts. */
export interface ThreadsToken {
  access_token?: string
  expires_in?: number
}

/** What Threads says about a token: times are seconds since 1970. */
export interface ThreadsTokenFacts {
  data?: { is_valid?: boolean; expires_at?: number; issued_at?: number; scopes?: string[] }
}

/** Daily publishing allowance from `GET /{user-id}/threads_publishing_limit` (DEC-096). */
export interface ThreadsPublishingLimit {
  data?: {
    quota_usage?: number
    config?: { quota_total?: number; quota_duration?: number }
    reply_quota_usage?: number
    reply_config?: { quota_total?: number; quota_duration?: number }
  }[]
}

function read<T>(response: HttpResponse, token: string, secret: string | null): ThreadsAnswer<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    parsed = null
  }
  const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const nested = body && typeof body.error === 'object' && body.error !== null ? (body.error as Record<string, unknown>) : null
  // A container that could not be prepared answers with `error_message` beside its `status`: that is a state, not a refusal. A refusal names its `error_type`.
  const flat = body && typeof body.error_type === 'string' ? body : null
  const failure = nested ?? flat
  if (response.status >= 200 && response.status < 300 && body && !failure) return { ok: true, result: body as T }
  const said = nested ? nested.message : flat ? flat.error_message : undefined
  let message = typeof said === 'string' && said !== '' ? said : `HTTP ${response.status}`
  message = message.replaceAll(token, '[token]')
  if (secret) message = message.replaceAll(secret, '[secret]')
  return { ok: false, status: response.status, code: typeof failure?.code === 'number' ? failure.code : 0, message }
}

export class ThreadsApi {
  constructor(
    private readonly http: HttpPort,
    private readonly token: string
  ) {}

  /** Reads an object or a list. It throws only when Threads gave no answer (`HttpNoAnswerError`). */
  async get<T>(path: string, params: Record<string, string> = {}): Promise<ThreadsAnswer<T>> {
    const query = new URLSearchParams({ ...params, access_token: this.token })
    return read<T>(await this.http.request({ method: 'GET', url: `${THREADS}/${VERSION}/${path}?${query.toString()}` }), this.token, null)
  }

  /** Makes something: every value is a word. */
  async post<T>(path: string, form: Record<string, string>): Promise<ThreadsAnswer<T>> {
    return read<T>(await this.http.request({ method: 'POST', url: `${THREADS}/${VERSION}/${path}`, form: { ...form, access_token: this.token } }), this.token, null)
  }

  /** What Threads says about this token itself: a token of a tester of the app may ask about a token of the same app. */
  facts(): Promise<ThreadsAnswer<ThreadsTokenFacts>> {
    return this.get<ThreadsTokenFacts>('debug_token', { input_token: this.token })
  }

  /** Exchanges a token of an hour for one of 60 days. It needs the secret of the Threads app, which is sent once and kept nowhere. */
  async exchange(secret: string): Promise<ThreadsAnswer<ThreadsToken>> {
    const query = new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: secret, access_token: this.token })
    return read<ThreadsToken>(await this.http.request({ method: 'GET', url: `${THREADS}/access_token?${query.toString()}` }), this.token, secret)
  }

  /** Makes a token of 60 days last 60 days from now. Threads does it for a token at least a day old that has not ended; no secret is needed. */
  async refresh(): Promise<ThreadsAnswer<ThreadsToken>> {
    const query = new URLSearchParams({ grant_type: 'th_refresh_token', access_token: this.token })
    return read<ThreadsToken>(await this.http.request({ method: 'GET', url: `${THREADS}/refresh_access_token?${query.toString()}` }), this.token, null)
  }
}

/** A Threads access token as Meta shows it: one long word. Whose it is, and how long it lasts, is asked from Threads when it is saved. */
export const looksLikeThreadsToken = (key: string): boolean => /^[A-Za-z0-9_|.-]{50,}$/.test(key)
