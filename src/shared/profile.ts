// Small pure helpers about an account profile (DEC-019), shared by the core (the age rule) and the screen (the one-line summary).

import type { AccountProfile, ProfileFields } from './types'

/** Whole years between a YYYY-MM-DD birth date and `now`; null when the text is not a real date. */
export function ageOn(birthDate: string, now: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  let age = now.getUTCFullYear() - year
  if (now.getUTCMonth() < month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() < day)) age -= 1
  return age
}

/** "Selena Marlowe, 37, Lisbon": who the profile is, in one line. Parts that are empty are left out. */
export function profileLine(profile: Pick<ProfileFields, 'displayName' | 'firstName' | 'lastName' | 'birthDate' | 'place'>, now: Date): string {
  const name = profile.displayName || `${profile.firstName} ${profile.lastName}`.trim()
  const age = ageOn(profile.birthDate, now)
  const city = profile.place.split(',')[0]?.trim() ?? ''
  return [name, age === null ? '' : String(age), city].filter(Boolean).join(', ')
}

/** The values the owner edits, without the bookkeeping fields of a stored profile. */
export function fieldsOf(profile: AccountProfile | ProfileFields): ProfileFields {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    displayName: profile.displayName,
    username: profile.username,
    birthDate: profile.birthDate,
    gender: profile.gender,
    place: profile.place,
    about: profile.about,
    website: profile.website,
    pictureIdea: profile.pictureIdea
  }
}

export const EMPTY_FIELDS: ProfileFields = { firstName: '', lastName: '', displayName: '', username: '', birthDate: '', gender: 'other', place: '', about: '', website: '', pictureIdea: '' }

/** True when two sets of values are the same, so "Save" is offered only when something changed. */
export const sameFields = (a: ProfileFields, b: ProfileFields): boolean => JSON.stringify(fieldsOf(a)) === JSON.stringify(fieldsOf(b))
