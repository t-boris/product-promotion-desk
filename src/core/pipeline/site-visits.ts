// Site visits (DEC-073, changing DEC-002 for products whose owner chose an analytics service): the visitors of the product's site, read from
// the analytics service the owner named, read-only, through the core's network port. The key is kept in the vault and never shown, logged or
// given to the AI. Nothing here asks the AI.
import { ApiError } from '../../shared/api'
import { PLAUSIBLE_HOST, VISITS_STALE_MS, VISIT_DAYS, VISIT_SOURCES, looksLikeSiteId, siteIdOf, type SiteVisitsView, type VisitRow, type VisitSource } from '../../shared/site-visits'
import type { Id } from '../../shared/types'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'
import { HttpNoAnswerError } from '../net/http'
import { isRecord } from '../assist/kit'

const keyOf = (productId: Id): string => `visits:${productId}`
const MAX_KEY = 400
const MAX_ROWS = 50
const DAY_MS = 86_400_000

interface Row {
  source: string
  site_id: string
  host: string
  read_at: string | null
  error: string | null
  total: number | null
  rows_json: string
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** The host of an analytics service the owner typed: https only, no path, no credentials. */
function cleanHost(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return PLAUSIBLE_HOST
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new ApiError('invalid_input', 'The address of the analytics service must be a web address (https://…).')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new ApiError('invalid_input', 'The address of the analytics service must start with https:// and hold no login.')
  return url.origin
}

export class SiteVisits {
  constructor(private readonly core: Core) {}

  private row(productId: Id): Row | undefined {
    return this.core.db.prepare('SELECT source, site_id, host, read_at, error, total, rows_json FROM site_visits WHERE product_id = ?').get(productId) as Row | undefined
  }

  view(args: { productId: Id }): SiteVisitsView {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const row = this.row(product.id)
    const source = (VISIT_SOURCES.find((s) => s === row?.source) ?? 'none') as VisitSource
    const hasKey = this.core.secrets.has(keyOf(product.id))
    const siteId = row?.site_id ?? ''
    return {
      productId: product.id,
      source,
      siteId,
      host: row?.host || PLAUSIBLE_HOST,
      hasKey,
      canRead: source === 'plausible' && siteId !== '' && hasKey,
      days: VISIT_DAYS,
      readAt: row?.read_at ?? null,
      error: row?.error ?? null,
      total: row?.total ?? null,
      rows: row ? (JSON.parse(row.rows_json) as VisitRow[]) : [],
      tagged: product.tagSiteLink
    }
  }

  /** Says where the site is counted. A key, when given, goes to the vault; an empty key keeps the one that is there. Another source or site forgets the last reading. */
  async setSource(args: { productId: Id; source: VisitSource; siteId?: string; host?: string; key?: string }): Promise<SiteVisitsView> {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    if (!VISIT_SOURCES.includes(args.source)) throw new ApiError('invalid_input', 'Choose where the site is counted from the list.')
    const before = this.row(product.id)
    let siteId = ''
    let host = PLAUSIBLE_HOST
    if (args.source === 'plausible') {
      siteId = (typeof args.siteId === 'string' ? args.siteId.trim().toLowerCase() : '') || siteIdOf(product.websiteUrl)
      if (!looksLikeSiteId(siteId)) throw new ApiError('invalid_input', 'Name the site as Plausible lists it: its domain, like example.com.')
      host = cleanHost(args.host)
      const key = typeof args.key === 'string' ? args.key.trim() : ''
      if (key !== '') {
        if (key.length > MAX_KEY || /\s/.test(key)) throw new ApiError('invalid_input', 'This does not look like an API key. Copy it whole from Plausible.')
        if (!(await this.core.secrets.available())) throw new ApiError('vault_unavailable', 'The vault of this Mac is not available, so the key cannot be kept.')
        try {
          await this.core.secrets.set(keyOf(product.id), key)
        } catch {
          throw new ApiError('vault_failed', 'The key could not be saved to the vault.')
        }
      }
    } else {
      this.core.secrets.delete(keyOf(product.id))
    }
    const same = before && before.source === args.source && before.site_id === siteId && before.host === host
    this.core.db
      .prepare(
        `INSERT INTO site_visits (product_id, source, site_id, host, read_at, error, total, rows_json) VALUES (?, ?, ?, ?, NULL, NULL, NULL, '[]')
         ON CONFLICT(product_id) DO UPDATE SET source = excluded.source, site_id = excluded.site_id, host = excluded.host${same ? '' : ", read_at = NULL, error = NULL, total = NULL, rows_json = '[]'"}`
      )
      .run(product.id, args.source, siteId, host)
    this.core.log.info('results', `Site visits of ${product.name}: ${args.source === 'none' ? 'no analytics' : args.source}.`)
    this.core.events.changed('products')
    return this.view({ productId: product.id })
  }

  /** One read-only question to Plausible. Throws ApiError with words the owner can act on; the key is never part of a message. */
  private async ask(productId: Id, body: Record<string, unknown>): Promise<{ metrics: number[]; dimensions: string[] }[]> {
    const row = this.row(productId)
    const key = await this.core.secrets.get(keyOf(productId))
    if (!row || row.source !== 'plausible' || row.site_id === '' || !key) throw new ApiError('invalid_state', 'Site visits are not connected for this product.')
    let answer
    try {
      answer = await this.core.http.request({ method: 'POST', url: `${row.host}/api/v2/query`, headers: { authorization: `Bearer ${key}` }, json: { site_id: row.site_id, ...body } })
    } catch (error) {
      if (error instanceof HttpNoAnswerError) throw new ApiError('read_failed', `Plausible did not answer: ${error.message}.`)
      throw error
    }
    if (answer.status === 401) throw new ApiError('read_failed', 'Plausible refused the key. Create a Stats API key in Plausible and save it again.')
    if (answer.status === 402) throw new ApiError('read_failed', 'Plausible says the Stats API is not part of this plan.')
    if (answer.status === 429) throw new ApiError('read_failed', 'Plausible asks to wait: too many requests this hour.')
    if (answer.status < 200 || answer.status >= 300) throw new ApiError('read_failed', `Plausible answered with an error (${answer.status}). Check the site's name: it must be the domain Plausible lists.`)
    let parsed: unknown
    try {
      parsed = JSON.parse(answer.text)
    } catch {
      throw new ApiError('read_failed', 'Plausible answered with something that is not its usual answer.')
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.results)) throw new ApiError('read_failed', 'Plausible answered with something that is not its usual answer.')
    return parsed.results.flatMap((r) =>
      isRecord(r) && Array.isArray(r.metrics) ? [{ metrics: r.metrics.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)), dimensions: Array.isArray(r.dimensions) ? r.dimensions.map((d) => (typeof d === 'string' ? d : '')) : [] }] : []
    )
  }

  /** Unique visitors of the site between two local days, both included; for a goal's count. */
  async visitorsBetween(productId: Id, from: string, to: string): Promise<number> {
    const results = await this.ask(productId, { metrics: ['visitors'], date_range: [from, to] })
    return results[0]?.metrics[0] ?? 0
  }

  /** Reads the last days now and keeps what came back; a failure is kept as words and thrown. */
  async read(args: { productId: Id }): Promise<SiteVisitsView> {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const now = this.core.clock.now()
    const range = [day(now.getTime() - (VISIT_DAYS - 1) * DAY_MS), day(now.getTime())]
    try {
      const total = (await this.ask(product.id, { metrics: ['visitors'], date_range: range }))[0]?.metrics[0] ?? 0
      const rows = (await this.ask(product.id, { metrics: ['visitors'], date_range: range, dimensions: ['visit:utm_source', 'visit:utm_campaign'], order_by: [['visitors', 'desc']] }))
        .map((r): VisitRow => ({ source: (r.dimensions[0] ?? '').slice(0, 80), campaign: (r.dimensions[1] ?? '').slice(0, 120), visitors: r.metrics[0] ?? 0 }))
        // A visit with no tag has "(not set)" in both: it is the site's other traffic, already inside the total.
        .filter((r) => r.visitors > 0 && !(/^\(not set\)$/i.test(r.source) || r.source === ''))
        .slice(0, MAX_ROWS)
      this.core.db.prepare('UPDATE site_visits SET read_at = ?, error = NULL, total = ?, rows_json = ? WHERE product_id = ?').run(now.toISOString(), total, JSON.stringify(rows), product.id)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      this.core.db.prepare('UPDATE site_visits SET error = ? WHERE product_id = ?').run(error.message.slice(0, 300), product.id)
      this.core.events.changed('results')
      throw error
    }
    this.core.events.changed('results')
    return this.view({ productId: product.id })
  }

  /** The scheduler's job: products whose visits can be read and whose last reading is old. A failure is kept on the product and does not stop the others. */
  async readDue(stop: () => boolean = () => false): Promise<number> {
    const now = this.core.clock.now().getTime()
    const rows = this.core.db.prepare("SELECT product_id, read_at FROM site_visits WHERE source = 'plausible' AND site_id <> ''").all() as { product_id: Id; read_at: string | null }[]
    let read = 0
    for (const row of rows) {
      if (stop()) break
      if (!this.core.secrets.has(keyOf(row.product_id))) continue
      if (row.read_at && now - Date.parse(row.read_at) < VISITS_STALE_MS) continue
      try {
        await this.read({ productId: row.product_id })
        read += 1
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
      }
    }
    return read
  }
}
