// Pinterest's API v5 as this application uses it for the account that owns a developer app: one request, one answer in the API's own shape.
// The token is asked for with the app's id and secret key (the client-credentials grant) and travels in the Authorization header; neither the
// secret key nor a token is ever put into an error, a log line or a result.
import type { HttpPort, HttpResponse } from '../../core/ports'

/** The host and version of Pinterest's pages (read 2026-11-28). */
export const PINTEREST = 'https://api.pinterest.com/v5'
/** What the application asks to be allowed: to see the account, its boards and its pins, and to create pins. */
export const SCOPES = 'user_accounts:read,boards:read,pins:read,pins:write'

/** `status` is the HTTP status; `code` is the API's own number, 0 when it gave none. Pinterest's pages show one shape of a refusal: `code`, `message`. */
export type PinterestAnswer<T> = { ok: true; result: T } | { ok: false; status: number; code: number; message: string }

export interface PinterestToken {
  access_token?: string
  expires_in?: number
  scope?: string
}

export interface PinterestAccount {
  id?: string
  username?: string
  account_type?: string
  business_name?: string | null
}

export interface PinterestBoard {
  id: string
  name: string
  privacy?: string
}

/** A video Pinterest was told is coming (`POST /media`): where to upload it and with which form fields, and how far its processing is. */
export interface PinterestMedia {
  media_id?: string
  media_type?: string
  status?: string
  upload_url?: string
  upload_parameters?: Record<string, string>
}

export interface PinterestPin {
  id: string
  created_at?: string
  title?: string | null
  description?: string | null
  link?: string | null
  board_id?: string
}

export interface PinterestList<T> {
  items?: T[]
  bookmark?: string | null
}

/** A pin's numbers: of the asked period (`summary_metrics`) and since it was made (`lifetime_metrics`). The answer is keyed by a word ("all"). */
export interface PinterestPinNumbers {
  summary_metrics?: Record<string, number>
  lifetime_metrics?: Record<string, number>
}

function read<T>(response: HttpResponse, hide: string[]): PinterestAnswer<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    parsed = null
  }
  const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  if (response.status >= 200 && response.status < 300 && body) return { ok: true, result: body as T }
  let message = body && typeof body.message === 'string' && body.message !== '' ? body.message : `HTTP ${response.status}`
  for (const secret of hide) if (secret) message = message.replaceAll(secret, '[key]')
  return { ok: false, status: response.status, code: body && typeof body.code === 'number' ? body.code : 0, message }
}

/** Asks Pinterest for a token for the account that owns the app. It throws only when Pinterest gave no answer. */
export async function askToken(http: HttpPort, appId: string, secretKey: string): Promise<PinterestAnswer<PinterestToken>> {
  const basic = Buffer.from(`${appId}:${secretKey}`, 'utf8').toString('base64')
  return read<PinterestToken>(await http.request({ method: 'POST', url: `${PINTEREST}/oauth/token`, headers: { authorization: `Basic ${basic}` }, urlencoded: { grant_type: 'client_credentials', scope: SCOPES } }), [secretKey, basic])
}

export class PinterestApi {
  constructor(
    private readonly http: HttpPort,
    private readonly token: string
  ) {}

  /** Reads an object or a list. It throws only when Pinterest gave no answer (`HttpNoAnswerError`). */
  async get<T>(path: string, params: Record<string, string> = {}): Promise<PinterestAnswer<T>> {
    const query = new URLSearchParams(params).toString()
    return read<T>(await this.http.request({ method: 'GET', url: `${PINTEREST}/${path}${query ? `?${query}` : ''}`, headers: { authorization: `Bearer ${this.token}` } }), [this.token])
  }

  /** Makes something from a JSON body. A picture travels inside it, so it is given the time of an upload. */
  async post<T>(path: string, body: unknown): Promise<PinterestAnswer<T>> {
    return read<T>(await this.http.request({ method: 'POST', url: `${PINTEREST}/${path}`, headers: { authorization: `Bearer ${this.token}` }, json: body, timeoutMs: 5 * 60_000 }), [this.token])
  }
}

/** The two values of a Pinterest app as its "My apps" page shows them: the app id is a number, the app secret key one word. */
export const looksLikeAppId = (value: string): boolean => /^\d{5,25}$/.test(value)
export const looksLikeSecretKey = (key: string): boolean => /^[A-Za-z0-9_-]{16,256}$/.test(key)
