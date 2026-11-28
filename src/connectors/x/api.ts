// X's API v2 as this application uses it for the account that signed in through X's own window (OAuth 2.0 with a code and PKCE, a public
// client): one request, one answer in the API's own shape. A token travels in the Authorization header or in the form of the token address;
// neither a token nor a code is ever put into an error, a log line or a result.
import type { HttpFile, HttpPort, HttpResponse } from '../../core/ports'

/** The hosts of X's pages (read 2026-11-28). */
export const X_API = 'https://api.x.com/2'
export const X_AUTHORIZE = 'https://x.com/i/oauth2/authorize'
/** What the application asks to be allowed: to post, to upload a picture, to see the account and its posts, and to stay signed in. */
export const X_SCOPES = 'tweet.read tweet.write users.read media.write offline.access'

/** `status` is the HTTP status; `type` is the address X names the problem by ("…/usage-capped"), empty when it gave none. */
export type XAnswer<T> = { ok: true; result: T } | { ok: false; status: number; type: string; message: string }

export interface XToken {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

export interface XUser {
  id: string
  name?: string
  username?: string
}

export interface XPost {
  id: string
  text?: string
  created_at?: string
  public_metrics?: { like_count?: number; reply_count?: number; impression_count?: number }
}

const words = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

function read<T>(response: HttpResponse, hide: string[]): XAnswer<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(response.text)
  } catch {
    parsed = null
  }
  const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  if (response.status >= 200 && response.status < 300 && body) return { ok: true, result: body as T }
  // A refusal comes as a problem (title, detail, type), as a list of errors, or, from the token address, as error and error_description.
  const first = body && Array.isArray(body.errors) && body.errors[0] && typeof body.errors[0] === 'object' ? (body.errors[0] as Record<string, unknown>) : null
  let message = words(body?.detail) ?? words(body?.error_description) ?? words(first?.message) ?? words(first?.detail) ?? words(body?.title) ?? words(body?.error) ?? `HTTP ${response.status}`
  for (const secret of hide) if (secret) message = message.replaceAll(secret, '[key]')
  return { ok: false, status: response.status, type: words(body?.type) ?? words(first?.type) ?? '', message }
}

/** Asks the token address for a pair of tokens: for the code of a sign-in, or for a refresh token. It throws only when X gave no answer. */
export async function askToken(http: HttpPort, form: Record<string, string>): Promise<XAnswer<XToken>> {
  return read<XToken>(await http.request({ method: 'POST', url: `${X_API}/oauth2/token`, urlencoded: form }), [form.code ?? '', form.refresh_token ?? '', form.code_verifier ?? ''])
}

export class XApi {
  constructor(
    private readonly http: HttpPort,
    private readonly token: string
  ) {}

  private get auth(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` }
  }

  /** Reads an object or a list. It throws only when X gave no answer (`HttpNoAnswerError`). */
  async get<T>(path: string, params: Record<string, string> = {}): Promise<XAnswer<T>> {
    const query = new URLSearchParams(params).toString()
    return read<T>(await this.http.request({ method: 'GET', url: `${X_API}/${path}${query ? `?${query}` : ''}`, headers: this.auth }), [this.token])
  }

  async post<T>(path: string, body: unknown): Promise<XAnswer<T>> {
    return read<T>(await this.http.request({ method: 'POST', url: `${X_API}/${path}`, headers: this.auth, json: body }), [this.token])
  }

  /** Uploads one picture in one request; X answers with the id a post names it by. */
  async upload(file: HttpFile, category: 'tweet_image' | 'tweet_gif'): Promise<XAnswer<{ data?: { id?: string } }>> {
    return read(await this.http.request({ method: 'POST', url: `${X_API}/media/upload`, headers: this.auth, form: { media_category: category, media: file } }), [this.token])
  }
}

/** The id of an app's OAuth 2.0 client as X's Developer Console shows it: one word of letters, digits, hyphens and underscores. */
export const looksLikeClientId = (value: string): boolean => /^[A-Za-z0-9_-]{15,80}$/.test(value)
