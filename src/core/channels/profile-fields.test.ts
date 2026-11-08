import { describe, expect, it } from 'vitest'
import { ageOn, missingIdentity, readProfileFields } from './profile-fields'

const NOW = new Date('2026-11-08T12:00:00Z')
const good = { firstName: 'Selena', lastName: 'Marlowe', displayName: 'Selena Marlowe', username: 'selena.marlowe', birthDate: '1988-03-14', gender: 'female', place: 'Lisbon, Portugal', about: 'I build Natal Mystic.', website: 'https://natal.example', pictureIdea: 'A warm portrait, soft light' }

describe('ageOn', () => {
  it('counts whole years and refuses what is not a date', () => {
    expect(ageOn('1988-03-14', NOW)).toBe(38)
    expect(ageOn('1988-11-09', NOW)).toBe(37)
    expect(ageOn('1988-11-08', NOW)).toBe(38)
    expect(ageOn('1988-02-30', NOW)).toBeNull()
    expect(ageOn('14 March 1988', NOW)).toBeNull()
  })
})

describe('readProfileFields', () => {
  it('reads a complete profile and tidies the text', () => {
    const read = readProfileFields({ ...good, about: '  I build\n Natal   Mystic. ' }, NOW)
    expect(read).toEqual({ ok: true, value: good })
  })

  it('keeps empty values empty: a proposal may be incomplete, approving is what needs the identity', () => {
    const read = readProfileFields({}, NOW)
    expect(read).toMatchObject({ ok: true, value: { firstName: '', birthDate: '', gender: 'other' } })
    if (read.ok) expect(missingIdentity(read.value)).toEqual(['first name', 'last name', 'display name', 'user name', 'birth date'])
  })

  it('refuses a minor, an impossible date, a very old person and a wrong date format', () => {
    expect(readProfileFields({ ...good, birthDate: '2015-01-01' }, NOW)).toMatchObject({ ok: false, error: expect.stringContaining('adult') })
    expect(readProfileFields({ ...good, birthDate: '1988-13-01' }, NOW)).toMatchObject({ ok: false, error: expect.stringContaining('real date') })
    expect(readProfileFields({ ...good, birthDate: '1930-01-01' }, NOW)).toMatchObject({ ok: false, error: expect.stringContaining('at most') })
    expect(readProfileFields({ ...good, birthDate: '14/03/1988' }, NOW)).toMatchObject({ ok: false })
  })

  it('refuses names with digits or markup, odd user names, official-looking ones and non-web addresses', () => {
    expect(readProfileFields({ ...good, firstName: 'Sel3na' }, NOW).ok).toBe(false)
    expect(readProfileFields({ ...good, lastName: '<b>x</b>' }, NOW).ok).toBe(false)
    expect(readProfileFields({ ...good, username: 'ab' }, NOW).ok).toBe(false)
    expect(readProfileFields({ ...good, username: 'official_natal' }, NOW).ok).toBe(false)
    expect(readProfileFields({ ...good, website: 'javascript:alert(1)' }, NOW).ok).toBe(false)
    expect(readProfileFields({ ...good, website: 'https://user:pw@natal.example' }, NOW).ok).toBe(false)
  })

  it('accepts names with accents, hyphens and apostrophes, and refuses an unknown gender and too long text', () => {
    expect(readProfileFields({ ...good, firstName: 'Zoë', lastName: "O'Neil-Ägren" }, NOW).ok).toBe(true)
    expect(readProfileFields({ ...good, gender: 'robot' }, NOW)).toMatchObject({ ok: false })
    expect(readProfileFields({ ...good, about: 'x'.repeat(501) }, NOW)).toMatchObject({ ok: false, error: expect.stringContaining('too long') })
    expect(readProfileFields('nope', NOW).ok).toBe(false)
  })
})
