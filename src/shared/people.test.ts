import { describe, expect, it } from 'vitest'
import { emptyPerson, personChanged, shownPeople, usableTestimonial, type Person } from './people'

const person = (over: Partial<Person>): Person => ({ id: 'p', productId: 'x', ...emptyPerson(), handle: 'someone', createdAt: '', updatedAt: '', ...over })

describe('people: the plain rules', () => {
  it('filters by what is owed and by testimonials, and searches the notes', () => {
    const people = [person({ id: 'a', handle: 'u/moon_reader', owed: 'Send the guide' }), person({ id: 'b', handle: '@clay', testimonial: 'Loved it', note: 'met at a fair' }), person({ id: 'c' })]
    expect(shownPeople(people, 'all', '').map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(shownPeople(people, 'owed', '').map((p) => p.id)).toEqual(['a'])
    expect(shownPeople(people, 'testimonials', '').map((p) => p.id)).toEqual(['b'])
    expect(shownPeople(people, 'all', ' FAIR ').map((p) => p.id)).toEqual(['b'])
  })

  it('calls a testimonial usable only with permission given, and knows an edited form', () => {
    expect(usableTestimonial({ testimonial: 'Loved it', permission: 'asked' })).toBe(false)
    expect(usableTestimonial({ testimonial: 'Loved it', permission: 'given' })).toBe(true)
    expect(usableTestimonial({ testimonial: ' ', permission: 'given' })).toBe(false)
    expect(personChanged({ ...emptyPerson(), handle: ' a ' }, { ...emptyPerson(), handle: 'a' })).toBe(false)
    expect(personChanged({ ...emptyPerson(), handle: 'a', owed: 'x' }, { ...emptyPerson(), handle: 'a' })).toBe(true)
  })
})
