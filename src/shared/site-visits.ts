// Site visits (DEC-073): where a product's site is counted, chosen per product by the owner. "None" is a valid answer. With Plausible the
// application reads the visitors itself, read-only, with a key the owner saves; the numbers come from the analytics service, never from the AI.

export const VISIT_SOURCES = ['none', 'plausible', 'google'] as const
export type VisitSource = (typeof VISIT_SOURCES)[number]

export const VISIT_SOURCE_LABEL: Record<VisitSource, string> = {
  none: 'No analytics on the site',
  plausible: 'Plausible',
  google: 'Google Analytics'
}

/** Visits are read over this many days. */
export const VISIT_DAYS = 30
export const PLAUSIBLE_HOST = 'https://plausible.io'
/** A reading older than this is read again by the daily job. */
export const VISITS_STALE_MS = 20 * 3_600_000

export interface VisitRow {
  /** utm_source of the visit: the platform, when the post's address carried the tags. */
  source: string
  /** utm_campaign of the visit: the channel. */
  campaign: string
  visitors: number
}

export interface SiteVisitsView {
  productId: string
  source: VisitSource
  /** The site as the analytics service names it (a domain for Plausible); '' when not set. */
  siteId: string
  /** The address of the analytics service (Plausible's own, or the owner's own instance). */
  host: string
  hasKey: boolean
  /** The application can read the visits: a source it can read, a site and a key. */
  canRead: boolean
  days: number
  readAt: string | null
  error: string | null
  /** Unique visitors of the site in the days; null while never read. */
  total: number | null
  /** Visitors that came by a tagged address, the most first. */
  rows: VisitRow[]
  /** The product's posts carry the tags that name the platform and the channel. */
  tagged: boolean
}

/** A domain as Plausible names a site: example.com (no scheme, no path). */
export function looksLikeSiteId(text: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/[a-z0-9._~-]+)*$/i.test(text)
}

/** The site id a product's own address suggests: its host without "www.". */
export function siteIdOf(websiteUrl: string | null): string {
  if (!websiteUrl) return ''
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

/** "reddit · beginnerastrology" / "reddit" / "(no tag)" */
export function visitRowName(row: Pick<VisitRow, 'source' | 'campaign'>): string {
  return [row.source, row.campaign].filter((part) => part !== '').join(' · ') || '(no tag)'
}
