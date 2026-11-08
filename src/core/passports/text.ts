// Small text helpers shared by the source readers and the claim logic.

import { createHash } from 'node:crypto'

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Stable hash of any JSON-serializable value (object key order is irrelevant). */
export function hashJson(value: unknown): string {
  return sha256(stableStringify(value))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Comparison key for duplicate detection: case, spacing and trailing punctuation do not matter. */
export function normalizeForCompare(text: string): string {
  return collapseWhitespace(text).toLowerCase().replace(/[\s.;,!]+$/u, '')
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  hellip: '...',
  copy: '(c)',
  euro: '€',
  pound: '£'
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/**
 * Removes every `<tag ...>...</tag>` block. Linear time (indexOf instead of a lazy regex), so a hostile page with
 * thousands of unclosed tags cannot make the scan quadratic. An unclosed block swallows the rest of the document.
 */
function stripBlocks(html: string, tag: string): string {
  const lower = html.toLowerCase()
  const open = `<${tag}`
  const close = `</${tag}`
  let out = ''
  let cursor = 0
  for (;;) {
    const start = lower.indexOf(open, cursor)
    if (start < 0) break
    const next = lower[start + open.length]
    if (next !== undefined && /[a-z0-9]/.test(next)) {
      // A different tag that merely starts with the same letters (e.g. <scripture>).
      out += html.slice(cursor, start + open.length)
      cursor = start + open.length
      continue
    }
    out += html.slice(cursor, start)
    const end = lower.indexOf(close, start)
    if (end < 0) return out
    const closeEnd = lower.indexOf('>', end)
    cursor = closeEnd < 0 ? html.length : closeEnd + 1
  }
  return out + html.slice(cursor)
}

export interface PageText {
  title: string
  description: string
  siteName: string
  lang: string
  text: string
}

function metaContent(html: string, key: string): string {
  // Attribute order varies, so look at each <meta> tag on its own.
  for (const tag of html.match(/<meta\b[^>]{0,600}>/gi) ?? []) {
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    if (name !== key) continue
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const value = content?.[1] ?? content?.[2]
    if (value) return collapseWhitespace(decodeEntities(value))
  }
  return ''
}

/** Plain text of an HTML page plus the metadata that matters for a product passport. */
export function htmlToPageText(html: string): PageText {
  const title = collapseWhitespace(decodeEntities(/<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html)?.[1] ?? ''))
  const lang = /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] ?? ''
  const description = metaContent(html, 'description') || metaContent(html, 'og:description')
  const siteName = metaContent(html, 'og:site_name')
  let body = html
  for (const tag of ['script', 'style', 'noscript', 'svg', 'template', 'head']) body = stripBlocks(body, tag)
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(?:p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|blockquote|pre|form|nav|main|aside)\s*>/gi, '\n')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]{0,2000}>/g, ' ')
  const text = decodeEntities(body)
    .split('\n')
    .map(collapseWhitespace)
    .filter(Boolean)
    .join('\n')
  return { title, description, siteName, lang, text }
}
