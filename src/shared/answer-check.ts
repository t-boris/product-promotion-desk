// The AI-answer check (DEC-061): a fixed list of questions a buyer would ask, put to the installed AI engine with web search and without a word
// about the product, so the answer is what a stranger would get from it. The application, not the AI, then says whether the product was named
// and whether its site was among the sources. The engine's answer is not what a person sees in ChatGPT or Google: the screen says so.

export const MAX_QUESTIONS = 20
export const MAX_QUESTION = 200
export const MAX_ANSWER = 700
export const MAX_NAMED = 12
export const MAX_SOURCES = 8
/** The check is asked again when the last one is this old. */
export const CHECK_EVERY_DAYS = 30

const squash = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The host of an address without "www.", or null when it is not a web address. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    return parsed.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** Whether the product's name is among the names the answer recommends, or in the answer's text. Spaces, case and punctuation do not matter. */
export function productNamed(productName: string, named: readonly string[], answer: string): boolean {
  const name = squash(productName)
  if (name.length < 3) return false
  return named.some((entry) => squash(entry).includes(name)) || squash(answer).includes(name)
}

/** Whether one of the sources is a page of the product's own site. */
export function productCited(websiteUrl: string | null, sources: readonly string[]): boolean {
  const own = hostOf(websiteUrl)
  if (!own) return false
  return sources.some((source) => {
    const host = hostOf(source)
    return host !== null && (host === own || host.endsWith(`.${own}`))
  })
}

export interface AnswerTally {
  /** Questions that got an answer. */
  asked: number
  named: number
  cited: number
}

export function tally(results: readonly { state: 'ok' | 'failed'; productNamed: boolean; productCited: boolean }[]): AnswerTally {
  const ok = results.filter((r) => r.state === 'ok')
  return { asked: ok.length, named: ok.filter((r) => r.productNamed).length, cited: ok.filter((r) => r.productCited).length }
}

/** The names recommended across the answers, the most often named first: who is present where the product may not be. */
export function namedMost(results: readonly { named: readonly string[] }[], limit = 10): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>()
  for (const result of results) {
    for (const key of new Set(result.named.map((n) => squash(n)))) {
      if (key === '') continue
      const name = result.named.find((n) => squash(n) === key) as string
      const entry = counts.get(key) ?? { name, count: 0 }
      entry.count += 1
      counts.set(key, entry)
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit)
}

/** The sites cited across the answers, the most often cited first: where to be present. */
export function citedMost(results: readonly { sources: readonly string[] }[], limit = 10): { host: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const result of results) {
    for (const host of new Set(result.sources.map((s) => hostOf(s)).filter((h): h is string => h !== null))) counts.set(host, (counts.get(host) ?? 0) + 1)
  }
  return [...counts.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)).slice(0, limit)
}

/** The questions as the owner typed them, one a line: trimmed, without empty lines and repeats, at most twenty. */
export function cleanQuestions(lines: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of lines) {
    const text = line.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION)
    const key = text.toLowerCase()
    if (text === '' || seen.has(key)) continue
    seen.add(key)
    out.push(text)
    if (out.length >= MAX_QUESTIONS) break
  }
  return out
}
