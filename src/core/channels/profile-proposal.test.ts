// The AI proposes a whole profile as a strategy for a purpose (DEC-019). The answer is untrusted text: it is checked field by field.

import { describe, expect, it } from 'vitest'
import { AiError } from '../ports'
import { FakeEngine } from '../testing/fakes'
import { proposeProfile, type ProfileProposeInput } from './ai-help'

const input: ProfileProposeInput = {
  purpose: 'Answer beginners about natal charts as the person who builds the tool',
  product: { name: 'Natal Mystic', websiteUrl: 'https://natal.example/', description: 'Natal chart calculator for astrology fans' },
  claims: [
    { section: 'offer', text: 'Calculates a natal chart from birth data' },
    { section: 'audience', text: 'Hobby astrologers, mostly women 25 to 45' }
  ],
  platform: { platform: 'reddit', label: 'Reddit' },
  role: { name: 'developer', voice: 'Builds the tool and says so' },
  others: [{ displayName: 'Nora Vale', gender: 'female', birthYear: '1990', place: 'Berlin', about: 'I build Natal Mystic.' }],
  today: '2026-11-08'
}

const answer = (over: Record<string, unknown> = {}) => ({
  purpose: 'Be the approachable developer of Natal Mystic for hobby astrologers on Reddit',
  strategy: 'The audience is hobby astrologers, mostly women 25 to 45, who trust people that explain things plainly. A developer in her mid-thirties who is open about building the tool fits.',
  firstName: 'Selena',
  lastName: 'Marlowe',
  displayName: 'Selena Marlowe',
  username: 'selena.builds',
  birthDate: '1989-04-02',
  gender: 'female',
  place: 'Lisbon, Portugal',
  about: 'I build Natal Mystic, a natal chart calculator. Happy to explain how a chart is computed.',
  website: 'https://natal.example/',
  pictureIdea: 'A friendly portrait of a woman in her thirties at a desk with a laptop, daylight, relaxed smile',
  reasons: { firstName: 'Easy to read and say.', birthDate: 'Mid-thirties matches the audience.', gender: 'The audience is mostly women.', about: 'Says plainly that she builds the tool.' },
  ...over
})

const engine = (...answers: unknown[]) => {
  let n = 0
  const next = () => JSON.stringify(answers[Math.min(n++, answers.length - 1)])
  return new FakeEngine().on('accounts.profile', next).on('accounts.profile.repair', next)
}

describe('proposeProfile', () => {
  it('returns the purpose, the strategy, every personal value and a reason for each choice', async () => {
    const e = engine(answer())
    const proposal = await proposeProfile(e, input)
    expect(proposal.purpose).toContain('developer of Natal Mystic')
    expect(proposal.strategy).toContain('hobby astrologers')
    expect(proposal.fields).toMatchObject({ firstName: 'Selena', lastName: 'Marlowe', username: 'selena.builds', birthDate: '1989-04-02', gender: 'female', place: 'Lisbon, Portugal' })
    expect(proposal.reasons.birthDate).toBe('Mid-thirties matches the audience.')
    expect(e.calls).toHaveLength(1)
  })

  it('gives the engine the purpose, the product, the platform, the role and the profiles that already exist, and the honesty rules', async () => {
    const e = engine(answer())
    await proposeProfile(e, input)
    const { prompt, system } = e.calls[0]
    expect(prompt).toContain('Answer beginners about natal charts')
    expect(prompt).toContain('Natal Mystic')
    expect(prompt).toContain('Hobby astrologers, mostly women 25 to 45')
    expect(prompt).toContain('Reddit')
    expect(prompt).toContain('developer: Builds the tool and says so')
    expect(prompt).toContain('Nora Vale')
    expect(prompt).toContain('2026-11-08')
    expect(prompt).toMatch(/audience first|who the audience is/i)
    expect(prompt).toMatch(/Do not claim credentials/)
    expect(prompt).toMatch(/Differ clearly from the profiles that already exist/)
    expect(system).toMatch(/cannot browse/)
  })

  it('states the purpose itself when the owner gave none, and works for an account without a product', async () => {
    const e = engine(answer())
    await proposeProfile(e, { ...input, purpose: '', product: null, claims: [], role: null })
    expect(e.calls[0].prompt).toContain('not said: state it yourself')
    expect(e.calls[0].prompt).toContain('not tied to a product yet')
  })

  it('asks once more when the strategy is missing, and uses the repaired answer', async () => {
    const e = engine(answer({ strategy: '' }), answer())
    const proposal = await proposeProfile(e, input)
    expect(proposal.strategy).toContain('hobby astrologers')
    expect(e.calls.map((c) => c.label)).toEqual(['accounts.profile', 'accounts.profile.repair'])
    expect(e.calls[1].prompt).toContain('strategy')
  })

  it('refuses a minor, a missing identity, an invented credential, a neutral-bystander voice and a name another profile already has', async () => {
    const bad = async (over: Record<string, unknown>) => {
      const e = engine(answer(over))
      return proposeProfile(e, input).then(
        () => 'accepted',
        (error: unknown) => (error instanceof AiError ? error.message : String(error))
      )
    }
    expect(await bad({ birthDate: '2012-04-02' })).toMatch(/adult/)
    expect(await bad({ username: '' })).toMatch(/missing/)
    expect(await bad({ about: 'I am a certified astrologer with 10 years of practice.' })).toMatch(/credential/)
    expect(await bad({ about: 'Just a happy customer who loves it.' })).toMatch(/third party/)
    expect(await bad({ displayName: 'nora vale', firstName: 'Nora', lastName: 'Vale' })).toMatch(/already used/)
    expect(await bad({ about: 'My password: hunter2 for the tool' })).toMatch(/must not be offered/)
  })

  it('does not accept a made-up reason for a field that is not part of the profile, and keeps the others', async () => {
    const proposal = await proposeProfile(engine(answer({ reasons: { firstName: 'Easy to read.', shoeSize: 'x' } })), input)
    expect(proposal.reasons).toEqual({ firstName: 'Easy to read.' })
  })

  it('rethrows a cancel and an unavailable engine untouched', async () => {
    const e = new FakeEngine().on('accounts.profile', () => {
      throw new AiError('timeout', 'too slow')
    })
    await expect(proposeProfile(e, input)).rejects.toMatchObject({ kind: 'timeout' })
  })
})
