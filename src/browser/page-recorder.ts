// What an account's page did on the network and in its console (DEC-016). Metadata only: the host and path of a request, its
// method and status, never a query string, header, cookie or body. Nothing here runs a script in the page.

import type { PageRequestNote } from '../shared/types'

const MAX_REQUESTS = 120
const MAX_CONSOLE = 40
const MAX_CONSOLE_TEXT = 200
const MAX_PATH = 80
/** Sub-resources (images, scripts, fonts, styles) are not what a refused sign-up or a failed save is about. */
const FETCH_KINDS = new Set(['mainFrame', 'subFrame', 'xhr', 'ping'])
/** A cancelled navigation and a cache miss are Chromium's own business, not something a site did. */
const HARMLESS_ERRORS = /ERR_ABORTED|ERR_CACHE_MISS/

export interface RequestDetails {
  method: string
  resourceType: string
  url: string
  statusCode?: number
  error?: string
}

/** "www.facebook.com/reg/submit/": where a request went, without what it carried. */
export function targetOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname.slice(0, MAX_PATH)}`
  } catch {
    return url.slice(0, MAX_PATH)
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** Two addresses belong to one site when their last two host labels agree: facebook.com and www.facebook.com. */
export function sameSite(a: string, b: string): boolean {
  const key = (host: string): string => host.split('.').slice(-2).join('.').toLowerCase()
  return a !== '' && b !== '' && key(a) === key(b)
}

export class PageRecorder {
  private readonly requests: PageRequestNote[] = []
  private readonly console: string[] = []
  private lastNoteAt = Number.NEGATIVE_INFINITY
  private suppressed = 0

  /**
   * `pageHost` says which site the page is on now: only failures on that site are worth a log line. `onNote` is called at most once
   * every `noteEveryMs`; what was held back is counted into the next line.
   */
  constructor(
    private readonly now: () => number,
    private readonly pageHost: () => string,
    private readonly onNote: (text: string) => void,
    private readonly noteEveryMs = 10_000
  ) {}

  completed(details: RequestDetails): void {
    this.record(details, details.statusCode ?? null, null)
  }

  failed(details: RequestDetails): void {
    if (details.error && HARMLESS_ERRORS.test(details.error)) return
    this.record(details, null, details.error ?? 'failed')
  }

  /** Only warnings and errors: the rest of a console is chatter. */
  logged(level: string, message: string): void {
    if (!/^(error|warning|2|3)$/i.test(level)) return
    const text = message.replace(/\s+/g, ' ').trim().slice(0, MAX_CONSOLE_TEXT)
    if (text === '' || this.console.includes(text)) return
    this.console.push(text)
    if (this.console.length > MAX_CONSOLE) this.console.shift()
  }

  recentRequests(limit = 30): PageRequestNote[] {
    return this.requests.slice(-limit).map((request) => ({ ...request }))
  }

  consoleErrors(): string[] {
    return [...this.console]
  }

  private record(details: RequestDetails, status: number | null, error: string | null): void {
    const method = details.method.toUpperCase()
    const kind = details.resourceType
    const refused = error !== null || (status !== null && status >= 400)
    // A read of a page (GET) is routine; what was sent (POST and the like) and what failed is what a person asks about.
    const interesting = FETCH_KINDS.has(kind) && (method !== 'GET' || refused)
    if (!interesting) return

    const target = targetOf(details.url)
    const last = this.requests[this.requests.length - 1]
    if (last && last.method === method && last.kind === kind && last.target === target && last.status === status && last.error === error) {
      last.count += 1
    } else {
      this.requests.push({ method, kind, target, status, error, count: 1 })
      if (this.requests.length > MAX_REQUESTS) this.requests.shift()
    }
    if (refused && sameSite(hostOf(details.url), this.pageHost())) this.note(method, kind, target, status, error)
  }

  private note(method: string, kind: string, target: string, status: number | null, error: string | null): void {
    if (this.now() - this.lastNoteAt < this.noteEveryMs) {
      this.suppressed += 1
      return
    }
    this.lastNoteAt = this.now()
    const more = this.suppressed > 0 ? ` (${this.suppressed} more failed since the last line)` : ''
    this.suppressed = 0
    this.onNote(`${method} ${target} ${error ?? `answered ${status}`} (${kind})${more}`)
  }
}
