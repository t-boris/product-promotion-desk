// The people met while promoting a product (DEC-066): who, where, what was said, what is owed, and their words about the product with their
// permission. The owner types every entry; the application gives none of it to the AI and quotes nobody by itself.

export const PERMISSIONS = ['none', 'asked', 'given'] as const
export type Permission = (typeof PERMISSIONS)[number]
export const PERMISSION_LABEL: Record<Permission, string> = { none: 'Not asked', asked: 'Asked', given: 'Given' }

export const MAX_HANDLE = 80
export const MAX_WHERE = 120
export const MAX_NOTE = 1000
export const MAX_OWED = 300
export const MAX_TESTIMONIAL = 600
export const MAX_SOURCE = 500
export const MAX_PEOPLE = 500

export interface Person {
  id: string
  productId: string
  /** The name or handle the owner knows them by. */
  handle: string
  /** A platform name from the list, or '' when it is none of them. */
  platform: string
  /** Where they met: a community, an event, a thread. */
  where: string
  /** What was said. */
  note: string
  /** What the owner owes them; '' when nothing. */
  owed: string
  /** Their words about the product; '' when none. */
  testimonial: string
  /** The address where they said it; '' when unknown. */
  testimonialSource: string
  permission: Permission
  createdAt: string
  updatedAt: string
}

export type PersonFields = Pick<Person, 'handle' | 'platform' | 'where' | 'note' | 'owed' | 'testimonial' | 'testimonialSource' | 'permission'>

export const emptyPerson = (): PersonFields => ({ handle: '', platform: '', where: '', note: '', owed: '', testimonial: '', testimonialSource: '', permission: 'none' })

export const PEOPLE_FILTERS = ['all', 'owed', 'testimonials'] as const
export type PeopleFilter = (typeof PEOPLE_FILTERS)[number]

export function matchesFilter(person: Pick<Person, 'owed' | 'testimonial'>, filter: PeopleFilter): boolean {
  return filter === 'all' || (filter === 'owed' ? person.owed.trim() !== '' : person.testimonial.trim() !== '')
}

/** The people a filter and a search show: the search reads the handle, the place and the notes. */
export function shownPeople<T extends Person>(people: readonly T[], filter: PeopleFilter, query: string): T[] {
  const q = query.trim().toLowerCase()
  return people.filter((p) => matchesFilter(p, filter) && (q === '' || `${p.handle}\n${p.where}\n${p.note}\n${p.owed}\n${p.testimonial}`.toLowerCase().includes(q)))
}

/** Whether a person's words may be quoted: there are words and the permission is given. */
export function usableTestimonial(person: Pick<Person, 'testimonial' | 'permission'>): boolean {
  return person.testimonial.trim() !== '' && person.permission === 'given'
}

/** Whether the form differs from the kept entry. */
export function personChanged(form: PersonFields, kept: PersonFields): boolean {
  return (Object.keys(emptyPerson()) as (keyof PersonFields)[]).some((key) => form[key].trim() !== kept[key].trim())
}
