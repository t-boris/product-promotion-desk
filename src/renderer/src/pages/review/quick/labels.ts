// How a post is named where a title would be (REQ-002): by its type, never by an empty title. A quick post has no title, so the first words of its
// caption stand in; an article is its title as before. Pure, so every screen that names a post asks the same function and the rule is tested once.

import { captionLabel, postLabel, type PostType } from '../../../../../shared/quick-post'

/** What a screen reads of a draft to name it. */
export interface Nameable {
  postType: PostType
  title: string | null
  text: string
}

/** The name of a post for a row, a heading or a notice: its title (an article), else the first words of its caption (a quick post). Empty when there is nothing to name it by. */
export const nameOf = (draft: Nameable): string => postLabel(draft)

/**
 * The bold line of a post in a list that shows the post's own words under it, and whether those words still add anything. An article keeps its
 * title as before (no line without one); a quick post has the first words of its caption, and the caption under it is left out when the line already
 * is all of it.
 */
export function headingOf(draft: Nameable): { heading: string | null; repeats: boolean } {
  if (draft.postType !== 'quick') return { heading: draft.title || null, repeats: false }
  const heading = nameOf(draft)
  return { heading: heading || null, repeats: heading !== '' && heading === captionLabel(draft.text, Number.MAX_SAFE_INTEGER) }
}

/** The one line a review card shows for a post of the owner's when it is closed: its name by type (a quick post by its caption's first words; an article by its title, else its text). */
export function ownPostSummary(draft: Nameable | null): string {
  if (!draft) return 'New publication'
  return (draft.postType === 'quick' ? nameOf(draft) : draft.title || draft.text) || 'New publication'
}
