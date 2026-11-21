// What "What the AI found" shows and when. Pure, so it is tested without the interface (lesson 101).
//
// The pages the AI read belong to the one text it wrote from them. They sit under the text while that text is the one in the field, and are gone the moment
// it is not: when the owner types (the text is theirs again), when the owner presses Undo (the text the AI wrote is gone), and when the AI is asked again.

import type { DraftSource } from '../../../../shared/types'

/** The pages the AI found, with the exact text they were found for. */
export interface FoundFor {
  text: string
  sources: DraftSource[]
}

/** The AI's answer went into the field: its pages belong to that text. An answer that searched for nothing leaves nothing to show. */
export function foundForAnswer(text: string, sources: readonly DraftSource[] | undefined): FoundFor | null {
  return sources !== undefined && sources.length > 0 ? { text, sources: [...sources] } : null
}

/**
 * What stays when the field now holds `value`: the pages, while the field holds exactly the text they were found for; nothing otherwise, and what went
 * does not come back when the same words are typed again.
 */
export function keepFound(found: FoundFor | null, value: string): FoundFor | null {
  return found !== null && found.text === value ? found : null
}
