// What the reply window of the Feed keeps about one place of one thread: the text and the rounds of asking the AI. Pure, so it is tested from src/main.

import type { FindingReplyPlace, FindingSendResult } from '../../../../shared/api'
import { COMMENT_SCHEDULE_MAX_DAYS } from '../../../../shared/finding-reply'
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

/** What the window does when it opens: ask the AI with the wish it was opened with, show the text the place already holds, ask for a first text, or leave the text it kept. */
export type OpeningMove = { move: 'ask'; wish: string } | { move: 'show'; text: string } | { move: 'nothing' }

export function openingMove(args: { initialWish: string; kept: boolean; stored: string | null }): OpeningMove {
  // A wish the window was opened with is asked for whatever the place already holds: the text it holds is what the AI starts from.
  if (args.initialWish.trim() !== '') return { move: 'ask', wish: args.initialWish.trim() }
  if (args.kept) return { move: 'nothing' }
  if (args.stored !== null) return { move: 'show', text: args.stored }
  return { move: 'ask', wish: '' }
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

/** What the owner pressed: the reply window asks the same way for a send and for a schedule, and says a refusal for the one that was pressed. */
export type Doing = 'send' | 'schedule'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** The evening and the morning of the Schedule menu, in the owner's own clock. */
export const EVENING_HOUR = 19
export const MORNING_HOUR = 9

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** "7:00 pm", "9:30 am": the owner's clock, the twelve-hour way the menu says it. */
function clock(at: Date): string {
  const hours = at.getHours()
  return `${hours % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`
}

/** A planned time in the owner's words: "today 7:00 pm", "tomorrow 9:00 am", or the day when it is further away ("Mon 24 Nov, 9:00 am"). */
export function whenWords(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'a time that is not known'
  if (sameDay(at, now)) return `today ${clock(at)}`
  if (sameDay(at, new Date(now.getTime() + DAY_MS))) return `tomorrow ${clock(at)}`
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}, ${clock(at)}`
}

/** One time the Schedule menu offers without typing. */
export interface ScheduleChoice {
  id: 'hour' | 'evening' | 'tomorrow'
  label: string
  at: string
}

/** The times of the Schedule menu: in an hour, this evening (only while it is before 7 pm), and tomorrow morning. */
export function scheduleChoices(now: Date): ScheduleChoice[] {
  const choices: ScheduleChoice[] = [{ id: 'hour', label: 'In 1 hour', at: new Date(now.getTime() + HOUR_MS).toISOString() }]
  const evening = new Date(now)
  evening.setHours(EVENING_HOUR, 0, 0, 0)
  if (now.getTime() < evening.getTime()) choices.push({ id: 'evening', label: 'This evening 7:00 pm', at: evening.toISOString() })
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(MORNING_HOUR, 0, 0, 0)
  choices.push({ id: 'tomorrow', label: 'Tomorrow 9:00 am', at: tomorrow.toISOString() })
  return choices
}

/** A time for the field "Pick a time…" (the value of a datetime-local input, in the owner's clock). */
export function localInputValue(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** What the owner typed into "Pick a time…": the time to send at, or the sentence that says why not (the core says the same). */
export function pickedTime(value: string, now: Date): { ok: true; at: string } | { ok: false; message: string } {
  if (value.trim() === '') return { ok: false, message: 'Pick a day and a time.' }
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return { ok: false, message: 'Pick a day and a time.' }
  if (at.getTime() <= now.getTime()) return { ok: false, message: 'That time has already passed. Pick a time in the future.' }
  if (at.getTime() - now.getTime() > COMMENT_SCHEDULE_MAX_DAYS * DAY_MS) return { ok: false, message: `A comment can be scheduled up to ${COMMENT_SCHEDULE_MAX_DAYS} days ahead.` }
  return { ok: true, at: at.toISOString() }
}

/** What the window says after a press: how it ended, in the owner's words, and how strongly to say it. */
export function sendLine(result: FindingSendResult, now: Date = new Date(), doing: Doing = 'send'): { tone: SendTone; text: string } {
  const not = doing === 'schedule' ? 'Not scheduled.' : 'Not posted.'
  switch (result.state) {
    case 'sent':
      return { tone: 'good', text: result.url ? `Posted: ${result.url}` : result.message }
    case 'scheduled':
      return { tone: 'good', text: result.at ? `Scheduled for ${whenWords(result.at, now)}.` : result.message }
    case 'unknown':
      return { tone: 'warn', text: result.message }
    case 'failed':
      return { tone: 'bad', text: `${not} ${result.message}` }
    case 'held':
      return { tone: 'warn', text: doing === 'schedule' ? `${not} ${result.message}` : `Not posted yet. ${result.message} Press Send now to try again.` }
    case 'refused':
      return { tone: 'warn', text: `${not} ${result.message}` }
  }
}

/** A press did not go through (held, refused or failed): the comment can be copied and the post opened, to do it by hand. Nothing for any other ending. */
export function byHand(result: FindingSendResult | null): boolean {
  return result !== null && (result.state === 'held' || result.state === 'refused' || result.state === 'failed')
}

/** The states in which a place's stored text is still the owner's to use again when the window is opened anew (it was kept, edited in full, or planned). */
const REOPENABLE: readonly OpportunityState[] = ['draft', 'awaiting_approval', 'ready', 'needs_user']

/** The text this place already holds, to open the window on instead of asking the AI for a new one; null when there is none. */
export function storedText(place: Pick<FindingReplyPlace, 'state' | 'text'> | null): string | null {
  if (!place || !REOPENABLE.includes(place.state) || place.text.trim() === '') return null
  return place.text
}

/** When this place is planned, in the line of the window: the time, and a word when the text above is no longer the planned one. */
export function scheduledLine(place: Pick<FindingReplyPlace, 'scheduledAt' | 'text'>, text: string, now: Date): string | null {
  if (!place.scheduledAt) return null
  const when = `Scheduled for ${whenWords(place.scheduledAt, now)}`
  return place.text.trim() === text.trim() ? when : `${when}, with the text it had when you scheduled it. Change plans the text above instead.`
}

/** What Send now will do, said before it is pressed: who opens the post, what is typed and where, and that nothing goes out until a press. */
export function sendNote(accountLabel: string, where: string): string {
  const browser = accountLabel.trim() ? `the browser of ${accountLabel.trim()}` : "the account's browser"
  return `Send now: the AI opens the post in ${browser} and types this text, exactly as written, as a reply to ${where}. Nothing is posted before you press a button.`
}
