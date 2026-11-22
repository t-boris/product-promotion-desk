// The flairs a community offers for a post, and whether it requires one: read from the two answers Reddit gives to a signed-in account, read-only.
// A flair the owner may choose is one with a name that is not for moderators only; the order is Reddit's own.

import type { PostForm } from '../../core/ports'
import { asRecord, str } from '../text'

/** The longest name kept: a flair is a short label (Reddit's own limit is 64 characters). */
const MAX_NAME = 100
/** The most flairs kept: a community offers a few dozen, never thousands. */
const MAX_FLAIRS = 300

/** The flair names of Reddit's `link_flair_v2` answer, in its order, without the ones for moderators, without a name, and without repeats. */
export function flairNames(json: unknown): string[] | null {
  if (!Array.isArray(json)) return null
  const seen = new Set<string>()
  const names: string[] = []
  for (const item of json) {
    const flair = asRecord(item)
    if (!flair || flair.mod_only === true) continue
    const name = str(flair.text).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    names.push(name)
    if (names.length >= MAX_FLAIRS) break
  }
  return names
}

/** Whether the community requires a flair on a post: the `is_flair_required` of Reddit's post requirements. Null when the answer says nothing of it. */
export function flairRequired(json: unknown): boolean | null {
  const requirements = asRecord(json)
  return requirements && typeof requirements.is_flair_required === 'boolean' ? requirements.is_flair_required : null
}

/** The form of a post in a community, or null when the flair list could not be read (a community with no flairs answers an empty list, which is a reading). */
export function mapPostForm(flairs: unknown, requirements: unknown): PostForm | null {
  const names = flairNames(flairs)
  if (names === null) return null
  return { flairs: names, flairRequired: flairRequired(requirements) === true }
}
