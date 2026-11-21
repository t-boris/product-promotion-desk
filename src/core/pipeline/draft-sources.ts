// The pages a post was built on, as the owner sees them ("What the AI found"). When the engine searches the web for a post, it lists the pages it used
// (a title, the address, the fact it took from the page). What an engine says about the web is untrusted, so the list is read strictly here before it
// is shown: only the https address of a public page (no address of this computer or of a private network, no credentials in it), a fact and a title of a
// sensible length, no credential in the text, no page twice, at most eight. An entry that fails is dropped, never repaired by guessing. The addresses
// are only ever shown and opened by the owner; they are never put into the text of the post.

import type { DraftSource } from '../../shared/types'
import { holdsCredential, isRecord, plainText } from '../assist/kit'
import { publicSite } from '../channels/site-outline'

export const MAX_SOURCES = 8
const MAX_TITLE = 150
const MAX_FACT = 300
const MAX_ADDRESS = 500

/** The address of a page the owner may open: https, a public site's name, no credentials, no more than a plain address. Null for anything else. */
export function sourceAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '' || text.length > MAX_ADDRESS || /\s/.test(text)) return null
  try {
    if (new URL(text).protocol !== 'https:') return null
    return publicSite(text).url
  } catch {
    return null
  }
}

/** The host of a source address, for showing it ("astro.com"). */
export function sourceHost(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** What an engine listed as its sources, read strictly: the entries that are real pages with a fact, once each, at most eight. Nothing else survives. */
export function readSources(raw: unknown): DraftSource[] {
  if (!Array.isArray(raw)) return []
  const sources: DraftSource[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (sources.length >= MAX_SOURCES) break
    if (!isRecord(entry)) continue
    const url = sourceAddress(entry.url)
    const fact = plainText(typeof entry.fact === 'string' ? entry.fact : '', MAX_FACT)
    if (!url || fact === '' || holdsCredential(fact) || seen.has(url)) continue
    seen.add(url)
    sources.push({ title: plainText(typeof entry.title === 'string' ? entry.title : '', MAX_TITLE) || sourceHost(url), url, fact })
  }
  return sources
}
