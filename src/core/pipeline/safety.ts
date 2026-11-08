// Local safety checks applied to every AI draft before it is saved (REQ-003, SRC-001 section 4 step 5).
// They do not trust the model: a draft must not contain prohibited statements, must not mention prices,
// discounts or free access without an approved supporting claim, and must not rely on unapproved claims.
//
// The patterns are English and currency based; a draft in another language is still checked for amounts,
// links, prohibited claims and cited claim ids, and everything touching money goes to the owner in auto mode.

import type { ClaimView } from './context'

export interface SafetyInput {
  text: string
  title?: string | null
  link?: string | null
  /** Ids the AI cited as the basis of the draft. */
  usedClaimIds: string[]
  approved: ClaimView[]
  prohibited: string[]
  /** Hosts a link may point to (the product website and hosts named in approved claims). */
  allowedHosts: string[]
}

export interface SafetyReport {
  violations: string[]
  usedClaims: ClaimView[]
}

const AMOUNT = /(?:[$€£¥₽₹]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£¥₽₹]|(?:usd|eur|gbp|rub|dollars?|euros?|pounds?|bucks)\b))/gi
const DISCOUNT = /\b(?:discounts?|coupons?|promo(?:tional)?\s+codes?|vouchers?|cash\s?back|rebates?|\d{1,3}\s?%\s?off|percent\s+off|on\s+sale|special\s+offer|limited[- ]time\s+offer|price\s+drop)\b/i
const FREE = /(?<!\bfeel\s+)\bfree\b|\bfor\s+free\b|\bno\s+(?:cost|charge)\b|\bcomplimentary\b|\bgratis\b|\bfreemium\b|\bzero\s+cost\b|\bcosts?\s+nothing\b/i
const URL_IN_TEXT = /https?:\/\/[^\s<>)\]]+/gi
const BARE_DOMAIN = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|app|ai|co|dev|me|ru|info|xyz|site|online|shop|store)\b/gi

/** Web addresses in free text, without the punctuation that ends the sentence. */
const urlsIn = (text: string): string[] => [...text.matchAll(URL_IN_TEXT)].map((m) => m[0].replace(/[.,;:!?'"]+$/, ''))

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'you', 'your', 'our', 'can', 'from', 'has', 'have', 'not', 'but', 'all', 'any', 'its', 'was', 'were', 'will', 'one', 'use', 'get'])

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const contentWords = (s: string): string[] => normalize(s).split(' ').filter((w) => w.length >= 3 && !STOP_WORDS.has(w))

function numbersIn(text: string): Set<string> {
  const numbers = new Set<string>()
  for (const m of text.matchAll(/\d[\d.,]*/g)) numbers.add(m[0].replace(/[.,]+$/, '').replace(',', '.'))
  return numbers
}

/** True when `text` states (or nearly restates) the prohibited claim. */
export function repeatsProhibitedClaim(text: string, claim: string): boolean {
  const normalizedClaim = normalize(claim)
  if (normalizedClaim.length >= 8 && normalize(text).includes(normalizedClaim)) return true
  const claimWords = new Set(contentWords(claim))
  if (claimWords.size < 3) return false
  return text.split(/[.!?\n]+/).some((sentence) => {
    const words = new Set(contentWords(sentence))
    let hits = 0
    for (const w of claimWords) if (words.has(w)) hits++
    return hits / claimWords.size >= 0.8
  })
}

export function hostOf(address: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(address) ? address : `https://${address}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Hosts a draft may link to: the product website plus any host named inside an approved claim. */
export function allowedHostsFor(website: string | null, approved: ClaimView[]): string[] {
  const hosts = new Set<string>()
  const add = (address: string | null): void => {
    const host = address ? hostOf(address) : null
    if (host) hosts.add(host)
  }
  add(website)
  for (const claim of approved) {
    for (const url of urlsIn(claim.text)) add(url)
    for (const m of claim.text.matchAll(BARE_DOMAIN)) add(m[0])
  }
  return [...hosts]
}

const hostAllowed = (host: string, allowed: string[]): boolean => allowed.some((a) => host === a || host.endsWith(`.${a}`))

export function checkDraftSafety(input: SafetyInput): SafetyReport {
  const violations: string[] = []
  const body = [input.title ?? '', input.text, input.link ?? ''].join('\n')

  // 1. Only approved facts may be cited.
  const approvedById = new Map(input.approved.map((c) => [c.id, c]))
  const unknown = input.usedClaimIds.filter((id) => !approvedById.has(id))
  if (unknown.length > 0) violations.push(`it relies on facts that are not approved (${unknown.length} unknown claim id(s))`)
  const usedClaims = input.usedClaimIds.flatMap((id) => {
    const claim = approvedById.get(id)
    return claim ? [claim] : []
  })
  for (const claim of usedClaims) {
    if (claim.unconfirmedAvailability) violations.push(`it relies on a capability whose availability is unconfirmed: "${claim.text.slice(0, 80)}"`)
  }

  // 2. Prohibited statements must never appear.
  for (const prohibited of input.prohibited) {
    if (repeatsProhibitedClaim(body, prohibited)) violations.push(`it repeats a prohibited statement: "${prohibited.slice(0, 80)}"`)
  }

  // 3. Money talk needs an approved supporting claim.
  const claimText = usedClaims.map((c) => c.text).join('\n')
  const amounts = [...body.matchAll(AMOUNT)]
  if (amounts.length > 0) {
    const supported = numbersIn(claimText)
    const unsupported = amounts.filter((m) => ![...numbersIn(m[0])].every((n) => supported.has(n)))
    if (unsupported.length > 0) violations.push(`it states a price (${unsupported[0][0].trim()}) that no cited approved claim supports`)
  }
  if (DISCOUNT.test(body) && !DISCOUNT.test(claimText)) violations.push('it mentions a discount or promotion that no cited approved claim supports')
  if (FREE.test(body) && !FREE.test(claimText)) violations.push('it says something is free that no cited approved claim supports')

  // 4. Links only to the product's own addresses.
  const hosts = new Set<string>()
  for (const url of urlsIn(body)) {
    const host = hostOf(url)
    if (host) hosts.add(host)
  }
  for (const m of body.matchAll(BARE_DOMAIN)) {
    const host = hostOf(m[0])
    if (host) hosts.add(host)
  }
  if (input.link) {
    const host = hostOf(input.link)
    if (host) hosts.add(host)
  }
  for (const host of hosts) {
    if (!hostAllowed(host, input.allowedHosts)) violations.push(`it links to ${host}, which is not the product's own address`)
  }

  return { violations, usedClaims }
}
