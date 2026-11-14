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
  /**
   * 'ai' (the default): an AI draft, which cites the approved facts it rests on; a price, a discount or "free" must be backed by a cited one.
   * 'owner': a text the owner wrote, which cites nothing: the rules about citing do not apply, and an amount, a discount or "free" is backed
   * when any approved fact says it.
   */
  mode?: 'ai' | 'owner'
}

/** Which rule a finding is about. */
export type FindingRule = 'unknown_claim' | 'unconfirmed' | 'prohibited' | 'price' | 'discount' | 'free' | 'link' | 'unsafe_link'

/** One thing a draft breaks, in words for the owner: the rule, the words it is about (or null), and why it is a problem. */
export interface SafetyFinding {
  rule: FindingRule
  title: string
  quote: string | null
  why: string
}

export interface SafetyReport {
  violations: string[]
  usedClaims: ClaimView[]
  /** The same problems as `violations`, one each, shaped for a screen. */
  findings: SafetyFinding[]
}

const AMOUNT = /(?:[$€£¥₽₹]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£¥₽₹]|(?:usd|eur|gbp|rub|dollars?|euros?|pounds?|bucks)\b))/gi
const DISCOUNT = /\b(?:discounts?|coupons?|promo(?:tional)?\s+codes?|vouchers?|cash\s?back|rebates?|\d{1,3}\s?%\s?off|percent\s+off|on\s+sale|special\s+offer|limited[- ]time\s+offer|price\s+drop)\b/i
const FREE = /(?<!\bfeel\s+)\bfree\b|\bfor\s+free\b|\bno\s+(?:cost|charge)\b|\bcomplimentary\b|\bgratis\b|\bfreemium\b|\bzero\s+cost\b|\bcosts?\s+nothing\b/i
// Where a draft can point to an address (REQ-003): a full address, a bare domain, a domain followed by a path, a "www." host, the target of a
// markdown link or of a reference-style link. Every one of them is a link that must lead to the product's own address; a short link such as
// "bit.ly/x" is no exception.
const SCHEME_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+/gi
const WWW_HOST = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi
const BARE_DOMAIN =
  /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|app|ai|co|dev|me|ru|info|xyz|site|online|shop|store|de|fr|uk|us|nl|es|ly|gl|gd|gy|at|tv|biz|link|page|tech|cloud|live|club|top|vip|work|space|fun|click|world|news|blog|agency|digital|network|software|studio|design|email|team|zone)\b/gi
// A domain followed by a path, whatever its ending: "bit.ly/x", "evil.de/post". Endings that name a file are left out ("Node.js/Express").
const PATH_DOMAIN = /\b(?:[a-z0-9-]+\.)+([a-z]{2,24})(?=\/)/gi
const FILE_ENDINGS = new Set(
  'js jsx ts tsx mjs cjs py rb rs go md txt json yml yaml toml html htm css scss xml csv pdf png jpg jpeg gif svg webp zip tar gz sh bat exe dll so dylib java kt swift cpp hpp c h cs php sql log lock env conf cfg ini'.split(' ')
)
const MARKDOWN_TARGET = /\]\(\s*<?([^)\s>]+)/g
const REFERENCE_TARGET = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?(\S+)/gm
const UNSAFE_SCHEME = /^(?:javascript|data|vbscript|file|blob):/i

const trimEnd = (address: string): string => address.replace(/[.,;:!?'"]+$/, '')

/**
 * The hosts a text points to, and the targets of its markdown links that are not addresses at all (a "javascript:" or "data:" link).
 * A relative link (a section, a path) leads nowhere else and is not a host.
 */
export function linksIn(text: string): { hosts: string[]; unsafe: string[] } {
  const hosts = new Set<string>()
  const unsafe: string[] = []
  // `named`: the address has a scheme or a domain ending, so a single word ("localhost") is still a host; a bare word in a link target ("docs") is not.
  const add = (address: string, named = true): void => {
    const host = hostOf(trimEnd(address))
    if (host && (named || host.includes('.'))) hosts.add(host)
  }
  for (const m of text.matchAll(SCHEME_URL)) add(m[0])
  for (const m of text.matchAll(WWW_HOST)) add(m[0])
  for (const m of text.matchAll(BARE_DOMAIN)) add(m[0])
  for (const m of text.matchAll(PATH_DOMAIN)) if (!FILE_ENDINGS.has(m[1].toLowerCase())) add(m[0])
  for (const m of [...text.matchAll(MARKDOWN_TARGET), ...text.matchAll(REFERENCE_TARGET)]) {
    const target = m[1]
    if (UNSAFE_SCHEME.test(target)) unsafe.push(target.slice(0, 20))
    else if (!/^(?:[#/.]|mailto:|tel:)/i.test(target)) add(target, /:\/\//.test(target))
  }
  return { hosts: [...hosts], unsafe }
}

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
    for (const host of linksIn(claim.text).hosts) add(host)
  }
  return [...hosts]
}

const hostAllowed = (host: string, allowed: string[]): boolean => allowed.some((a) => host === a || host.endsWith(`.${a}`))

const QUOTE_MAX = 90

/** The sentence or line the match at `index` sits in, whole but for its length: the owner sees the words, not an offset. */
function clauseAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('.', index - 1), text.lastIndexOf('!', index - 1), text.lastIndexOf('?', index - 1), text.lastIndexOf('\n', index - 1)) + 1
  const ends = [text.indexOf('.', index), text.indexOf('!', index), text.indexOf('?', index), text.indexOf('\n', index)].filter((i) => i >= 0)
  const end = ends.length > 0 ? Math.min(...ends) : text.length
  const clause = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return clause.length > QUOTE_MAX ? `${clause.slice(0, QUOTE_MAX - 1)}…` : clause
}

export function checkDraftSafety(input: SafetyInput): SafetyReport {
  const violations: string[] = []
  const findings: SafetyFinding[] = []
  const flag = (violation: string, finding: SafetyFinding): void => {
    violations.push(violation)
    findings.push(finding)
  }
  const owner = input.mode === 'owner'
  const body = [input.title ?? '', input.text, input.link ?? ''].join('\n')

  // 1. Only approved facts may be cited (an AI draft cites; the owner's own text does not).
  const approvedById = new Map(input.approved.map((c) => [c.id, c]))
  const unknown = owner ? [] : input.usedClaimIds.filter((id) => !approvedById.has(id))
  if (unknown.length > 0) {
    flag(`it relies on facts that are not approved (${unknown.length} unknown claim id(s))`, {
      rule: 'unknown_claim',
      title: 'A fact that is not approved',
      quote: null,
      why: 'The text rests on a fact that is not in the approved product knowledge.'
    })
  }
  const usedClaims = owner
    ? []
    : input.usedClaimIds.flatMap((id) => {
        const claim = approvedById.get(id)
        return claim ? [claim] : []
      })
  for (const claim of usedClaims) {
    if (claim.unconfirmedAvailability) {
      flag(`it relies on a capability whose availability is unconfirmed: "${claim.text.slice(0, 80)}"`, {
        rule: 'unconfirmed',
        title: 'A capability that is not confirmed',
        quote: claim.text.slice(0, QUOTE_MAX),
        why: 'The approved fact it rests on says the availability is not confirmed yet.'
      })
    }
  }

  // 2. Prohibited statements must never appear.
  for (const prohibited of input.prohibited) {
    if (repeatsProhibitedClaim(body, prohibited)) {
      flag(`it repeats a prohibited statement: "${prohibited.slice(0, 80)}"`, {
        rule: 'prohibited',
        title: 'A statement your product knowledge prohibits',
        quote: prohibited.replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX),
        why: 'The text repeats, or nearly repeats, a statement the product knowledge says must never be made.'
      })
    }
  }

  // 3. Money talk needs an approved supporting claim: the cited ones for an AI draft, any approved one for the owner's own text.
  const claimText = (owner ? input.approved : usedClaims).map((c) => c.text).join('\n')
  const backing = owner ? 'approved fact' : 'cited approved claim'
  const amounts = [...body.matchAll(AMOUNT)]
  if (amounts.length > 0) {
    const supported = numbersIn(claimText)
    const unsupported = amounts.filter((m) => ![...numbersIn(m[0])].every((n) => supported.has(n)))
    if (unsupported.length > 0) {
      flag(`it states a price (${unsupported[0][0].trim()}) that no cited approved claim supports`, {
        rule: 'price',
        title: 'A price no approved fact supports',
        quote: clauseAround(body, unsupported[0].index ?? 0),
        why: `No ${backing} names ${unsupported[0][0].trim()}.`
      })
    }
  }
  const discount = DISCOUNT.exec(body)
  if (discount && !DISCOUNT.test(claimText)) {
    flag('it mentions a discount or promotion that no cited approved claim supports', {
      rule: 'discount',
      title: 'A discount or promotion no approved fact supports',
      quote: clauseAround(body, discount.index),
      why: `No ${backing} mentions a discount or a promotion.`
    })
  }
  const free = FREE.exec(body)
  if (free && !FREE.test(claimText)) {
    flag('it says something is free that no cited approved claim supports', {
      rule: 'free',
      title: 'A free offer no approved fact states',
      quote: clauseAround(body, free.index),
      why: `No ${backing} says that anything is free, or for how long.`
    })
  }

  // 4. Links only to the product's own addresses: every full address, bare domain, short link and link target.
  const { hosts: found, unsafe } = linksIn(body)
  const hosts = new Set(found)
  if (input.link) {
    const host = hostOf(input.link)
    if (host) hosts.add(host)
  }
  for (const host of hosts) {
    if (!hostAllowed(host, input.allowedHosts)) {
      flag(`it links to ${host}, which is not the product's own address`, {
        rule: 'link',
        title: "A link that is not the product's own",
        quote: host,
        why: input.allowedHosts.length > 0 ? `Only ${input.allowedHosts.slice(0, 3).join(', ')} may be linked.` : 'The product has no website, and no approved fact names an address.'
      })
    }
  }
  if (unsafe.length > 0) {
    flag(`it holds a link that is not a web address (${unsafe[0]})`, {
      rule: 'unsafe_link',
      title: 'A link that is not a web address',
      quote: unsafe[0],
      why: 'Only web addresses may be linked.'
    })
  }

  return { violations, usedClaims, findings }
}
