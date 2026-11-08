import { describe, expect, it } from 'vitest'
import { EMPTY_FIELDS, ageOn, fieldsOf, profileLine, sameFields } from './profile'

const NOW = new Date('2026-11-08T12:00:00Z')

describe('ageOn', () => {
  it('counts whole years and refuses what is not a date', () => {
    expect(ageOn('1988-03-14', NOW)).toBe(38)
    expect(ageOn('1988-11-09', NOW)).toBe(37)
    expect(ageOn('1988-11-08', NOW)).toBe(38)
    expect(ageOn('1988-02-30', NOW)).toBeNull()
    expect(ageOn('14 March 1988', NOW)).toBeNull()
  })
})

describe('profileLine', () => {
  it('says who the profile is in one line: name, age, city', () => {
    expect(profileLine({ displayName: 'Selena Marlowe', firstName: 'Selena', lastName: 'Marlowe', birthDate: '1989-04-02', place: 'Lisbon, Portugal' }, NOW)).toBe('Selena Marlowe, 37, Lisbon')
  })
  it('falls back to the first and last name, and leaves out what is empty', () => {
    expect(profileLine({ displayName: '', firstName: 'Selena', lastName: 'Marlowe', birthDate: '', place: '' }, NOW)).toBe('Selena Marlowe')
  })
})

describe('fieldsOf and sameFields', () => {
  it('compare only the values the owner edits', () => {
    const stored = { ...EMPTY_FIELDS, firstName: 'A', accountId: 'x', purpose: 'p', strategy: 's', reasons: {}, hasPicture: false, status: 'proposed' as const, updatedAt: 't' }
    expect(fieldsOf(stored)).toEqual({ ...EMPTY_FIELDS, firstName: 'A' })
    expect(sameFields(stored, { ...EMPTY_FIELDS, firstName: 'A' })).toBe(true)
    expect(sameFields(stored, { ...EMPTY_FIELDS, firstName: 'B' })).toBe(false)
  })
})
