import { describe, expect, it } from 'vitest'
import { mentionsPricing, pricingGrounded } from './pricing'

describe('pricing guards (unknown price is never turned into a promise)', () => {
  it('recognizes statements about price and free access in English and Russian', () => {
    for (const text of ['The Pro plan costs $9 per month', 'Free first chart', 'Pricing starts at 5 EUR', 'Бесплатный расчёт карты', 'Цена подписки не указана', 'It is a one-time purchase']) {
      expect(mentionsPricing(text), text).toBe(true)
    }
    for (const text of ['Natal charts for astrology fans', 'Available in English and Russian', 'The freely available ephemeris']) {
      expect(mentionsPricing(text), text).toBe(false)
    }
  })

  it('accepts a price only if the evidence contains the same figure', () => {
    expect(pricingGrounded('Pro costs $9 per month', 'Pro plan: $9/month, cancel anytime')).toBe(true)
    expect(pricingGrounded('Pro costs $19 per month', 'Pro plan: $9/month')).toBe(false)
    expect(pricingGrounded('Pro costs $9 per month', '')).toBe(false)
  })

  it('accepts "free" only if the evidence says so', () => {
    expect(pricingGrounded('The first chart is free', 'Your first chart is free of charge')).toBe(true)
    expect(pricingGrounded('The product is free', 'Birth charts for everyone')).toBe(false)
    expect(pricingGrounded('Бесплатно', 'Расчёт бесплатно')).toBe(true)
  })

  it('lets claims without figures or free-wording pass (nothing to verify)', () => {
    expect(pricingGrounded('Calculates natal charts', '')).toBe(true)
  })
})
