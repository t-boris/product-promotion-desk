// Whether a new post is about something the channel is for (DEC-039). Pure.
//
// A post becomes a Feed item only when it names one of the channel's topics or search queries, as a whole word or phrase: "tarot" is in
// "I pulled a tarot card" and not in "Startarot"; "habit tracker" is in "a Habit  Tracker app" (any case, any run of spaces). With no topic and no
// query nothing matches, so a channel that was never told what it is for queues no post at all.

/** A letter, a digit or an underscore, in any script: what a word is made of. */
const WORD_CHAR = /[\p{L}\p{N}_]/u

const MAX_TEXT_CHARS = 20_000
const MAX_TERM_CHARS = 200

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The terms a post is compared with: topics and queries, trimmed, in one run of spaces, without empty ones and without repeats (case aside). */
export function termsOf(lists: { topics: readonly string[]; queries: readonly string[] }): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of [...lists.topics, ...lists.queries]) {
    const term = raw.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_CHARS)
    const key = term.toLowerCase()
    if (term === '' || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
  }
  return terms
}

/**
 * A boundary is required on a side only where the term itself ends in a word character: "c++" must not be found inside "abc++" (it starts with a
 * letter) but is found in "c++ is fast" (it ends with a sign, which no word continues).
 */
function patternOf(term: string): RegExp {
  const body = term.split(' ').map(escapeRegExp).join('\\s+')
  const first = [...term][0] ?? ''
  const last = [...term].at(-1) ?? ''
  const before = WORD_CHAR.test(first) ? '(?<![\\p{L}\\p{N}_])' : ''
  const after = WORD_CHAR.test(last) ? '(?![\\p{L}\\p{N}_])' : ''
  return new RegExp(`${before}${body}${after}`, 'iu')
}

/** The first topic or query the post names, as the owner wrote it, or null when it names none. */
export function matchedTerm(post: { title: string; body: string }, lists: { topics: readonly string[]; queries: readonly string[] }): string | null {
  const terms = termsOf(lists)
  if (terms.length === 0) return null
  const text = `${post.title}\n${post.body}`.normalize('NFC').slice(0, MAX_TEXT_CHARS)
  for (const term of terms) if (patternOf(term).test(text)) return term
  return null
}

export function matchesTopics(post: { title: string; body: string }, lists: { topics: readonly string[]; queries: readonly string[] }): boolean {
  return matchedTerm(post, lists) !== null
}
