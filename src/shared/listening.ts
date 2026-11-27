// Wider listening (DEC-062): the product's name, a few phrases and a few competitors looked for on the open web, outside the connected channels.
// The AI engine searches; the application keeps what it found once per address, drops what does not name a watched term, and marks what is new.

export const MAX_PHRASES = 5
export const MAX_COMPETITORS = 5
export const MAX_TERM = 60
export const MAX_FINDS_PER_LOOK = 15
/** After the owner's first look the application looks again when the last look is this old. */
export const LOOK_EVERY_DAYS = 7

export const FIND_KINDS = ['mention', 'competitor', 'place'] as const
export type FindKind = (typeof FIND_KINDS)[number]
export const FIND_KIND_LABEL: Record<FindKind, string> = { mention: 'Your product', competitor: 'A competitor', place: 'A place to be' }

/** The terms as the owner typed them, one a line: trimmed, without empty lines and repeats, cut to the limit. */
export function cleanTerms(lines: readonly string[], limit: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const text = line.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM)
    const key = text.toLowerCase()
    if (text.length < 2 || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= limit) break
  }
  return out
}

/** The watched term a found page names, as the owner wrote it; null when it names none (such a find is dropped). */
export function watchedTerm(term: string, watched: readonly string[]): string | null {
  const key = term.replace(/\s+/g, ' ').trim().toLowerCase()
  return watched.find((w) => w.toLowerCase() === key) ?? null
}

/** An address kept as the key of a find: http(s) only, no credentials, no fragment. Null when it is not a web page. */
export function findAddress(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.username = ''
    url.password = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}
