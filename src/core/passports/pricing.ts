// "Unknown price is never turned into a promise" (SRC-001 section 2). Price and free-of-charge statements are the
// riskiest claims, so they get dedicated checks: they must be grounded in the cited evidence, and a claim that is
// not a sourced fact can never be approved for use.

// `\b` does not work for Cyrillic, so word edges are spelled out with Unicode-aware look-arounds.
const START = '(?<![\\p{L}\\p{N}_])'
const END = '(?![\\p{L}\\p{N}_])'

const PRICE_WORDS = new RegExp(
  `${START}(?:(?:price|prices|pricing|cost|costs|subscription|subscriptions|fee|fees|discount|discounts|one-time|per (?:month|year|week|user|seat))${END}|цен|стоимост|подписк|тариф)|/\\s?(?:mo|month|yr|year)${END}`,
  'iu'
)
const FREE_WORDS = new RegExp(`${START}(?:(?:free|freemium|gratis|complimentary|no cost|at no charge)${END}|бесплатн)|${START}0\\s?(?:usd|eur|\\$|€)`, 'iu')
const PRICE_AMOUNT = /(?:[$€£₽]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£₽]|usd|eur|gbp|rub|руб))/giu

function hasAmount(text: string): boolean {
  PRICE_AMOUNT.lastIndex = 0
  return PRICE_AMOUNT.test(text)
}

/** Any statement about what the product costs or whether it is free. */
export function mentionsPricing(text: string): boolean {
  return PRICE_WORDS.test(text) || FREE_WORDS.test(text) || hasAmount(text)
}

const digitsOnly = (value: string): string => value.replace(/\D/g, '')

/**
 * True when every concrete price in `claim` also appears in the evidence text, and a "free" statement is backed by
 * evidence that says so. A claim without figures or free-wording passes (there is nothing to verify).
 */
export function pricingGrounded(claim: string, evidence: string): boolean {
  const evidenceDigits = digitsOnly(evidence)
  PRICE_AMOUNT.lastIndex = 0
  const amounts = claim.match(PRICE_AMOUNT) ?? []
  for (const amount of amounts) {
    const digits = digitsOnly(amount)
    if (digits && !evidenceDigits.includes(digits)) return false
  }
  if (FREE_WORDS.test(claim) && !FREE_WORDS.test(evidence)) return false
  return true
}

export const PRICE_UNKNOWN_TEXT =
  'The current price and whether the product is free are not confirmed by any source. Do not mention prices or free access until this is confirmed.'
