// Meta's Graph API as this application uses it for a Facebook Page: one request, one answer in the Graph's own shape. The Page access token
// travels as a parameter of the request and is never put into an error, a log line or a result.
import type { HttpFile, HttpPort } from '../../core/ports'

/** The version the documentation's examples were written for when this was built (2026-11-27). */
export const GRAPH = 'https://graph.facebook.com/v27.0'
/** Where the file of a Reel is sent (Reels Publishing API, step 2): Facebook's upload host, not the Graph. */
export const REEL_UPLOAD = 'https://rupload.facebook.com/video-upload/v27.0'

/** What Facebook says of a video on its way to being a Reel (`GET /{video-id}?fields=status`): its phases, each with its state and what went wrong. */
interface GraphPhase {
  status?: string
  publish_status?: string
  error?: { message?: string }
  errors?: { message?: string }[]
}
export interface GraphVideoStatus {
  status?: { video_status?: string; uploading_phase?: GraphPhase; processing_phase?: GraphPhase; publishing_phase?: GraphPhase }
}

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
  /** False while Facebook keeps the post for its time. */
  is_published?: boolean
  /** Seconds since 1970, or a written time: Facebook gives either. */
  scheduled_publish_time?: number | string
}

export interface GraphComment {
  id: string
  message?: string
  created_time?: string
  permalink_url?: string
  from?: GraphFrom
  parent?: { id?: string }
  /** Whether the Page hid this comment from other readers (DEC-096). */
  is_hidden?: boolean
}

export interface GraphList<T> {
  data?: T[]
  paging?: { next?: string }
}

export interface GraphCounts {
  reactions?: { summary?: { total_count?: number } }
  comments?: { summary?: { total_count?: number } }
}

/** What `/{post-id}/insights` answers: one entry per metric, the number in `values[0].value`. */
export interface GraphInsights {
  data?: { name?: string; period?: string; values?: { value?: unknown }[] }[]
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

  /** Makes something: every value is a word or a file read from its path. `timeoutMs`: how long a request that carries a large file may take. */
  async post<T>(path: string, form: Record<string, string | HttpFile>, timeoutMs?: number): Promise<GraphAnswer<T>> {
    return this.read<T>(await this.http.request({ method: 'POST', url: `${GRAPH}/${path}`, form: { ...form, access_token: this.token }, ...(timeoutMs ? { timeoutMs } : {}) }))
  }

  /** Deletes an object. */
  async delete<T>(path: string): Promise<GraphAnswer<T>> {
    const query = new URLSearchParams({ access_token: this.token })
    return this.read<T>(await this.http.request({ method: 'DELETE', url: `${GRAPH}/${path}?${query.toString()}` }))
  }

  /**
   * Sends the file of a Reel, whole, to Facebook's upload host under the number the Graph gave the video. The address is built here from that
   * number, never taken from an answer: the token goes in a header, and it goes nowhere but to Facebook.
   */
  async uploadReel(videoId: string, file: HttpFile, bytes: number, timeoutMs: number): Promise<GraphAnswer<{ success?: boolean }>> {
    return this.read(
      await this.http.request({
        method: 'POST',
        url: `${REEL_UPLOAD}/${videoId}`,
        headers: { authorization: `OAuth ${this.token}`, offset: '0', file_size: String(bytes) },
        file: { ...file, mime: 'application/octet-stream' },
        timeoutMs
      })
    )
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
