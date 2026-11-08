import { describe, expect, it } from 'vitest'
import { analyzeRules } from './rules-text'

describe('community rules analysis', () => {
  it.each([
    ['No bots', 'Posts or comments made by bots or automated accounts are not allowed.'],
    ['No AI content', 'AI-generated content is banned. Do not post text written by ChatGPT.'],
    ['Automation', 'Automated posting will be removed and the account permanently banned.']
  ])('flags a rule that forbids automation: %s', (name, text) => {
    const result = analyzeRules([{ name: 'Be kind', text: 'Treat others with respect.' }, { name, text }])
    expect(result.automationForbidden?.name).toBe(name)
  })

  it('does not flag harmless or permissive rules', () => {
    const result = analyzeRules([
      { name: 'Be civil', text: 'No personal attacks.' },
      { name: 'Helper bots', text: 'Bots are welcome if they are flaired and approved by the moderators.' },
      { name: 'Astrology only', text: 'Posts must be about astrology.' }
    ])
    expect(result.automationForbidden).toBeNull()
  })

  it('collects self-promotion rules as warnings without treating them as automation bans', () => {
    const result = analyzeRules([
      { name: 'No self-promotion', text: 'Do not advertise your own products more than once a month.' },
      { name: 'Be civil', text: 'Respect others.' }
    ])
    expect(result.promotionRules.map((r) => r.name)).toEqual(['No self-promotion'])
    expect(result.automationForbidden).toBeNull()
  })
})
