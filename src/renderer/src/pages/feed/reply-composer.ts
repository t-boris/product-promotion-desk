// What the reply window of the Feed keeps about one place of one thread: the text and the rounds of asking the AI. Pure, so it is tested from src/main.

import type { FindingSendResult } from '../../../../shared/api'
import type { FindingComment, OpportunityState } from '../../../../shared/types'

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

/** Why Send cannot be pressed now, in words; an empty text when it can. What the application itself will refuse is said by the application after the press. */
export function sendBlock(args: { text: string; blocked: string; state: OpportunityState | null; comment: Pick<FindingComment, 'url'> | null; busy: boolean }): string {
  if (args.busy) return ''
  if (args.blocked) return args.blocked
  if (args.state === 'confirmed') return 'A comment was already posted here.'
  if (args.state === 'sending') return 'A comment is being posted here right now.'
  if (args.state === 'unknown_result') return 'What happened to the earlier comment here is not known yet: look at the post and tell the app below.'
  if (args.state === 'cancelled') return 'An earlier attempt here was stopped for good.'
  if (args.comment && args.comment.url.trim() === '') return 'This comment has no address of its own that the AI could open. Press Check again with AI to look for it, or answer it on the post yourself.'
  if (args.text.trim() === '') return 'Write the comment first.'
  return ''
}

export type SendTone = 'good' | 'warn' | 'bad'

/** What the window says after a press of Send: how it ended, in the owner's words, and how strongly to say it. */
export function sendLine(result: FindingSendResult): { tone: SendTone; text: string } {
  switch (result.state) {
    case 'sent':
      return { tone: 'good', text: result.url ? `Posted: ${result.url}` : result.message }
    case 'unknown':
      return { tone: 'warn', text: result.message }
    case 'failed':
      return { tone: 'bad', text: `Not posted. ${result.message}` }
    case 'held':
      return { tone: 'warn', text: `Not posted yet. ${result.message} Press Send to try again.` }
    case 'refused':
      return { tone: 'warn', text: `Not posted. ${result.message}` }
  }
}

/** What Send will do, said before it is pressed: who opens the post, what is typed and where, and that nothing goes out until the press. */
export function sendNote(accountLabel: string, where: string): string {
  const browser = accountLabel.trim() ? `the browser of ${accountLabel.trim()}` : "the account's browser"
  return `Send: the AI opens the post in ${browser} and types this text, exactly as written, as a reply to ${where}. Nothing is posted before you press it.`
}
