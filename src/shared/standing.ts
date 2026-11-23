// A confirmed post as the site shows it later (DEC-047 slice, 0.47.0, 0.49.0): how long the application keeps looking, whether a post was taken
// down, and the words the owner reads about it. Pure, so the card, the list and the core read one rule.

import { toPlainText } from './post-format'
import type { CommunityNotice, OpportunityState, SendAction } from './types'

/** A post is looked at for this long after it was published; a removal later than that is not followed. */
export const STANDING_WINDOW_MS = 3 * 24 * 60 * 60_000

/** The first words of the community's message shown before "Show all". */
export const NOTICE_EXCERPT = 220

/** A confirmed post that the site took down after it was published (the application read it again). */
export function isTakenDown(state: OpportunityState, action: Pick<SendAction, 'standing'> | null | undefined): boolean {
  return state === 'confirmed' && action?.standing === 'removed'
}

/** Until when the post is looked at again: its publication plus the window. Null without a publication time. */
export function watchedUntil(action: Pick<SendAction, 'completedAt'>): string | null {
  const at = action.completedAt ? Date.parse(action.completedAt) : Number.NaN
  return Number.isNaN(at) ? null : new Date(at + STANDING_WINDOW_MS).toISOString()
}

/** "Nov 25": a day in the viewer's zone. */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** What the owner reads about the looking under a removed post: until when it goes on and what they will hear, or that it has ended. */
export function watchWords(action: Pick<SendAction, 'completedAt'>, nowMs: number): string | null {
  const until = watchedUntil(action)
  if (!until) return null
  return nowMs < Date.parse(until) ? `Looked at until ${day(until)}. If a moderator approves it, you will be told.` : `It was looked at until ${day(until)} and is no longer followed.`
}

/** Who wrote the community's words, as the owner reads it: the community's bot, or the moderator by name. */
export function noticeAuthor(notice: CommunityNotice): string {
  return notice.by === 'AutoModerator' ? "The community's bot" : `The moderator u/${notice.by}`
}

/** The community's words as plain text (Reddit writes them in Markdown: links, lists, emphasis). */
export function noticeText(notice: CommunityNotice): string {
  return toPlainText(notice.text).trim()
}

/** The start of the community's words, cut at a word, or the whole text when it is short; `cut` says whether "Show all" has more to show. */
export function noticeExcerpt(text: string, limit = NOTICE_EXCERPT): { text: string; cut: boolean } {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= limit) return { text: flat, cut: flat !== text.trim() }
  const head = flat.slice(0, limit)
  const space = head.lastIndexOf(' ')
  return { text: `${(space > limit * 0.6 ? head.slice(0, space) : head).trimEnd()}…`, cut: true }
}
