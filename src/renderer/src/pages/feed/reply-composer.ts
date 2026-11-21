// What the reply window of the Feed keeps about one place of one thread: the text and the rounds of asking the AI. Pure, so it is tested from src/main.

import type { FindingComment } from '../../../../shared/types'

/** One round: what the owner asked for (empty for the AI's first text) and the text the AI gave. */
export interface Round {
  wish: string
  text: string
}

/** The place whose reply is open: the post itself, or the position of one comment. */
export type Place = 'post' | number

export const placeKey = (findingId: string, place: Place): string => `${findingId}:${place}`

/** Who is answered, in words: "the post by u/anna" or "anna's comment: Try a free chart site…". */
export function placeLabel(place: Place, postAuthor: string, comments: readonly FindingComment[]): string {
  if (place === 'post') return postAuthor.trim() ? `the post by ${postAuthor.trim()}` : 'the post'
  const comment = comments.find((c) => c.position === place)
  if (!comment) return 'a comment'
  const words = comment.text.length > 60 ? `${comment.text.slice(0, 60).trimEnd()}…` : comment.text
  return `${comment.author.trim() || 'someone'}'s comment: ${words}`
}

/** What the window sends to the AI for the next round: the text as it stands now (the owner may have changed it) and the wish. */
export function nextAsk(text: string, wish: string): { current: string; instruction: string } {
  return { current: text, instruction: wish.trim() }
}

/** The rounds with the new one added (an empty wish on a later round is "make it better"); the list never holds more than the last 20. */
export function withRound(rounds: readonly Round[], wish: string, text: string): Round[] {
  return [...rounds, { wish: wish.trim(), text }].slice(-20)
}
