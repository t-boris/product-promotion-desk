// LinkedIn's API as this application uses it for one member with the self-serve products "Share on LinkedIn" and "Sign In with LinkedIn using
// OpenID Connect": one request, one answer in the API's own shape. The access token travels in the Authorization header and is never put
// into an error, a log line or a result.
import type { HttpFile, HttpPort, HttpResponse } from '../../core/ports'

/** The host of LinkedIn's pages for these products (read 2026-11-28); every request carries the protocol header the pages require. */
export const LINKEDIN = 'https://api.linkedin.com'
const PROTOCOL = { 'x-restli-protocol-version': '2.0.0' }

/**
 * `status` is the HTTP status. LinkedIn's error page shows one shape of a refusal: `message`, `serviceErrorCode`, `status`. `header` reads a
 * header of the answer by its name in lower case: the id of a new post comes in one (`x-restli-id`).
 */
export type LinkedInAnswer<T> = { ok: true; result: T; header(name: string): string | null } | { ok: false; status: number; message: string }

/** What `/v2/userinfo` gives: `sub` is the member's id, the one a person URN is made of. */
export interface LinkedInMember {
  sub?: string
  name?: string
}

export interface LinkedInUpload {
  value?: {
    asset?: string
    uploadMechanism?: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'?: { uploadUrl?: string; headers?: Record<string, string> } }
  }
}

/** An asset as LinkedIn describes it after an upload: each recipe says whether the file is ready (`AVAILABLE`) or still being worked on (`PROCESSING`). */
export interface LinkedInAsset {
  recipes?: { recipe?: string; status?: string }[]
}

function read<T>(response: HttpResponse, token: string, bodyless = false): LinkedInAnswer<T> {
  let parsed: unknown
  try {
    parsed = response.text === '' ? {} : JSON.parse(response.text)
  } catch {
    parsed = null
  }
  const body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  if (response.status >= 200 && response.status < 300 && (body || bodyless)) {
    return { ok: true, result: (body ?? {}) as T, header: (name) => response.headers[name] ?? null }
  }
  const said = body && typeof body.message === 'string' && body.message !== '' ? body.message : `HTTP ${response.status}`
  return { ok: false, status: response.status, message: said.replaceAll(token, '[token]') }
}

export class LinkedInApi {
  constructor(
    private readonly http: HttpPort,
    private readonly token: string
  ) {}

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, ...PROTOCOL }
  }

  /** Reads an object. It throws only when LinkedIn gave no answer (`HttpNoAnswerError`). */
  async get<T>(path: string): Promise<LinkedInAnswer<T>> {
    return read<T>(await this.http.request({ method: 'GET', url: `${LINKEDIN}/${path}`, headers: this.headers() }), this.token)
  }

  /** Makes something from a JSON body. */
  async post<T>(path: string, body: unknown): Promise<LinkedInAnswer<T>> {
    return read<T>(await this.http.request({ method: 'POST', url: `${LINKEDIN}/${path}`, headers: this.headers(), json: body }), this.token)
  }

  /**
   * Puts a file on the address LinkedIn named for it. A picture's upload carries the token and a video's must not, as LinkedIn's pages say; the
   * token is never sent to an address outside linkedin.com, whatever was named.
   */
  async upload(url: string, file: HttpFile, options: { withToken: boolean; headers?: Record<string, string> }): Promise<LinkedInAnswer<Record<string, never>>> {
    let host: string
    try {
      host = new URL(url).host
    } catch {
      return { ok: false, status: 0, message: 'LinkedIn named an upload address that is not an address.' }
    }
    if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return { ok: false, status: 0, message: `LinkedIn named an upload address outside linkedin.com (${host}).` }
    const headers = { ...(options.headers ?? {}), ...(options.withToken ? { authorization: `Bearer ${this.token}` } : {}) }
    return read<Record<string, never>>(await this.http.request({ method: 'PUT', url, headers, file, timeoutMs: 10 * 60_000 }), this.token, true)
  }
}

/** A LinkedIn access token as its token generator shows it: one long word (LinkedIn says about 500 characters, and to allow for 1000). */
export const looksLikeLinkedInToken = (key: string): boolean => /^[A-Za-z0-9_.~+/=-]{80,}$/.test(key)
