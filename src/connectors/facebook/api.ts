// Meta's Graph API as this application uses it for a Facebook Page: one request, one answer in the Graph's own shape. The Page access token
// travels as a parameter of the request and is never put into an error, a log line or a result.
import type { HttpFile, HttpPort } from '../../core/ports'

/** The version the documentation's examples were written for when this was built (2026-11-27). */
export const GRAPH = 'https://graph.facebook.com/v27.0'

/** `status` is the HTTP status; `code` and `subcode` are the Graph's own (190: the token is not accepted; 100: a wrong parameter or field). */
export type GraphAnswer<T> = { ok: true; result: T } | { ok: false; status: number; code: number; subcode: number | null; message: string }

export interface GraphPage {
  id: string
  name?: string
  username?: string
  link?: string
  category?: string
}

export interface GraphFrom {
  id?: string
  name?: string
}

export interface GraphPost {
  id: string
  message?: string
  created_time?: string
  permalink_url?: string
  from?: GraphFrom
}

export interface GraphComment {
  id: string
  message?: string
  created_time?: string
  permalink_url?: string
  from?: GraphFrom
  parent?: { id?: string }
}

export interface GraphList<T> {
  data?: T[]
  paging?: { next?: string }
}

export interface GraphCounts {
  reactions?: { summary?: { total_count?: number } }
  comments?: { summary?: { total_count?: number } }
}

export class GraphApi {
  constructor(
    private readonly http: HttpPort,
    private readonly token: string
  ) {}

  /** Reads an object or a list. It throws only when Facebook gave no answer (`HttpNoAnswerError`). */
  async get<T>(path: string, params: Record<string, string> = {}): Promise<GraphAnswer<T>> {
    const query = new URLSearchParams({ ...params, access_token: this.token })
    return this.read<T>(await this.http.request({ method: 'GET', url: `${GRAPH}/${path}?${query.toString()}` }))
  }

  /** Makes something: every value is a word or a file read from its path. */
  async post<T>(path: string, form: Record<string, string | HttpFile>): Promise<GraphAnswer<T>> {
    return this.read<T>(await this.http.request({ method: 'POST', url: `${GRAPH}/${path}`, form: { ...form, access_token: this.token } }))
  }

  private read<T>(response: { status: number; text: string }): GraphAnswer<T> {
    let parsed: unknown
    try {
      parsed = JSON.parse(response.text)
    } catch {
      parsed = null
    }
    const failure = parsed && typeof parsed === 'object' ? (parsed as { error?: { message?: unknown; code?: unknown; error_subcode?: unknown } }).error : undefined
    if (response.status >= 200 && response.status < 300 && parsed && typeof parsed === 'object' && !failure) return { ok: true, result: parsed as T }
    return {
      ok: false,
      status: response.status,
      code: typeof failure?.code === 'number' ? failure.code : 0,
      subcode: typeof failure?.error_subcode === 'number' ? failure.error_subcode : null,
      message: typeof failure?.message === 'string' ? failure.message.replaceAll(this.token, '[token]') : `HTTP ${response.status}`
    }
  }
}

/** An access token as Meta shows it: one long word. What it is a token of is asked from Facebook when it is saved. */
export const looksLikeAccessToken = (key: string): boolean => /^[A-Za-z0-9_|.-]{50,}$/.test(key)
