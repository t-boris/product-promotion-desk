// The personal values of an account profile (DEC-019): one reader for what the owner types and for what the AI proposes, so both are
// held to the same rules. It returns the problem in words instead of throwing; the owner's screen shows it, the AI gets it back to repair.

import { ageOn } from '../../shared/profile'
import type { ProfileFields, ProfileGender } from '../../shared/types'

export { ageOn }

export const MIN_AGE = 18
export const MAX_AGE = 80
const MAX_NAME = 40
const MAX_DISPLAY = 60
const MAX_PLACE = 80
const MAX_ABOUT = 500
const MAX_WEBSITE = 200
const MAX_PICTURE_IDEA = 300

export const GENDERS: ProfileGender[] = ['female', 'male', 'other']

type Read = { ok: true; value: ProfileFields } | { ok: false; error: string }

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim()
const hasControl = (text: string): boolean => [...text].some((char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159))
const PERSON_NAME = /^[\p{L}][\p{L}\p{M}' -]*$/u
const USERNAME = /^[A-Za-z0-9._-]{3,30}$/
const OFFICIAL_LOOK = /official|admin|moderator|verified/i

function text(source: Record<string, unknown>, key: keyof ProfileFields, max: number, label: string): { ok: true; value: string } | { ok: false; error: string } {
  const raw = source[key]
  if (raw === undefined || raw === null) return { ok: true, value: '' }
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be text.` }
  const value = tidy(raw)
  if (hasControl(value)) return { ok: false, error: `${label} must not contain control characters.` }
  if ([...value].length > max) return { ok: false, error: `${label} is too long (limit ${max} characters).` }
  return { ok: true, value }
}

/** Reads the personal values of a profile. Empty values stay empty (a proposal may be incomplete); `requireIdentity` is for approving. */
export function readProfileFields(input: unknown, now: Date): Read {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'The profile must be an object.' }
  const source = input as Record<string, unknown>
  const out: Record<string, string> = {}
  const specs: [keyof ProfileFields, number, string][] = [
    ['firstName', MAX_NAME, 'The first name'],
    ['lastName', MAX_NAME, 'The last name'],
    ['displayName', MAX_DISPLAY, 'The display name'],
    ['username', 30, 'The user name'],
    ['place', MAX_PLACE, 'The place'],
    ['about', MAX_ABOUT, 'The about-text'],
    ['website', MAX_WEBSITE, 'The website'],
    ['pictureIdea', MAX_PICTURE_IDEA, 'The picture description']
  ]
  for (const [key, max, label] of specs) {
    const read = text(source, key, max, label)
    if (!read.ok) return read
    out[key] = read.value
  }
  for (const key of ['firstName', 'lastName'] as const) {
    if (out[key] && !PERSON_NAME.test(out[key])) return { ok: false, error: `${key === 'firstName' ? 'The first name' : 'The last name'} may hold letters, spaces, hyphens and apostrophes only.` }
  }
  if (out.username) {
    if (!USERNAME.test(out.username)) return { ok: false, error: 'The user name is 3 to 30 characters: letters, digits, dot, dash and underscore.' }
    if (OFFICIAL_LOOK.test(out.username)) return { ok: false, error: 'The user name must not look official (no "official", "admin", "moderator", "verified").' }
  }
  if (out.website) {
    let url: URL | null
    try {
      url = new URL(out.website)
    } catch {
      url = null
    }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { ok: false, error: 'The website must be a web address (http or https) without a login in it.' }
  }
  const birth = text(source, 'birthDate', 10, 'The birth date')
  if (!birth.ok) return birth
  if (birth.value) {
    const age = ageOn(birth.value, now)
    if (age === null) return { ok: false, error: 'The birth date must be a real date written YYYY-MM-DD.' }
    if (age < MIN_AGE) return { ok: false, error: `The person must be an adult (at least ${MIN_AGE}).` }
    if (age > MAX_AGE) return { ok: false, error: `The person must be at most ${MAX_AGE} years old.` }
  }
  const gender = source.gender === undefined || source.gender === null || source.gender === '' ? 'other' : source.gender
  if (typeof gender !== 'string' || !GENDERS.includes(gender as ProfileGender)) return { ok: false, error: 'The gender must be "female", "male" or "other".' }
  return {
    ok: true,
    value: {
      firstName: out.firstName,
      lastName: out.lastName,
      displayName: out.displayName,
      username: out.username,
      birthDate: birth.value,
      gender: gender as ProfileGender,
      place: out.place,
      about: out.about,
      website: out.website,
      pictureIdea: out.pictureIdea
    }
  }
}

/** What is still missing for the profile to be approved: the identity every sign-up needs. Empty when it is complete. */
export function missingIdentity(fields: ProfileFields): string[] {
  const missing: string[] = []
  if (!fields.firstName) missing.push('first name')
  if (!fields.lastName) missing.push('last name')
  if (!fields.displayName) missing.push('display name')
  if (!fields.username) missing.push('user name')
  if (!fields.birthDate) missing.push('birth date')
  return missing
}
