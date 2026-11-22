// The flair of a post (a label a community asks of a post): what makes two names the same flair, and what the editor says about the line. One rule for the
// application that chooses the flair on the site and for the screen that shows it, so the two cannot disagree about which flair is meant.

import type { PostFormInfo } from './api'

const normal = (text: string): string => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/** Whether two names are the same flair (case, spacing and form of letters do not tell flairs apart). */
export const sameFlair = (a: string, b: string): boolean => normal(a) !== '' && normal(a) === normal(b)

/** The flair of a community's list that has this name, in the list's own spelling, or null. */
export const offeredFlair = (flairs: readonly string[], name: string | null): string | null => (name === null ? null : (flairs.find((flair) => sameFlair(flair, name)) ?? null))

export interface FlairChoice {
  value: string
  label: string
}

/** The choices of the list: the community's flairs, and the flair the post holds when the community no longer offers it (named so, never dropped silently). */
export function flairChoices(flairs: readonly string[], chosen: string | null): FlairChoice[] {
  const choices = flairs.map((flair) => ({ value: flair, label: flair }))
  if (chosen !== null && offeredFlair(flairs, chosen) === null) choices.unshift({ value: chosen, label: `${chosen} (the community no longer offers it)` })
  return choices
}

/** Why the post cannot be approved for want of a flair, in words, or null: the community requires one and the post has none. */
export function flairApproveReason(form: Pick<PostFormInfo, 'supported' | 'flairRequired'> | undefined, flair: string | null): string | null {
  if (!form?.supported || !form.flairRequired) return null
  return flair === null || flair.trim() === '' ? 'Choose a flair first: this community requires one.' : null
}
