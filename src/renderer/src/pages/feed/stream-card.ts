// What the card of a post in the Feed shows, worked out from the post: the mark of its channel, how much of its text is shown before "Read more", the one
// line that stands for what the AI read of the thread, the numbers the site showed, and how its pictures are laid out. Pure, so it is tested from src/main.

import type { Finding } from '../../../../shared/types'

/** The round mark of a channel's platform, two letters at most; a platform that is not listed is its first letter. */
export function channelMark(platform: string): string {
  const marks: Record<string, string> = { reddit: 'r/', instagram: 'IG', facebook: 'f', threads: '@', x: 'X', linkedin: 'in', telegram: 'Tg' }
  return marks[platform] ?? (platform.trim().charAt(0).toUpperCase() || '?')
}

/** The lines of a post's text that the card shows before "Read more". */
export const BODY_LINES = 5

/** About how many characters a line of the card holds: the text that is longer than this many lines is cut by the card, and offers "Read more". */
const CHARS_PER_LINE = 80

/**
 * Whether the card cuts the text (it has more than `BODY_LINES` lines), so it offers "Read more". An estimate from the characters and the line breaks, not a
 * measure of the screen: a card that cut a little less or more than five lines is no harm, and the card never offers it for a short text.
 */
export function needsReadMore(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => Math.max(1, Math.ceil(line.trim().length / CHARS_PER_LINE)))
    .reduce((total, count) => total + count, 0)
  return text.trim() !== '' && lines > BODY_LINES
}

/** The longest the one line of the thread reading is, before it is cut. */
const SAY_LIMIT = 110

/**
 * The one line that stands for what the AI read of the thread, in the folded line under the card ("What people say: …"): the first sentence of its analysis
 * of the thread, else of its short account of the thread; null when it wrote neither. The AI's words about strangers' posts, shown as plain text.
 */
export function peopleSay(finding: Pick<Finding, 'analysis' | 'thread'>): string | null {
  for (const text of [finding.analysis, finding.thread]) {
    const flat = text.replace(/\s+/g, ' ').trim()
    if (flat === '') continue
    const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat
    return sentence.length > SAY_LIMIT ? `${sentence.slice(0, SAY_LIMIT).trimEnd()}…` : sentence
  }
  return null
}

/** A count of the site as the card writes it: 1,240 as "1.2k", under a thousand as it is. */
export function countText(count: number): string {
  if (count < 1000) return String(count)
  return `${(Math.floor(count / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`
}

/** The numbers the site showed for a post, for the card's bar; a number the site did not give is left out. Never a number the AI wrote. */
export function siteNumbers(finding: Pick<Finding, 'score' | 'replies'>): { score: string | null; comments: string | null } {
  return { score: finding.score === null ? null : countText(finding.score), comments: finding.replies === null ? null : countText(finding.replies) }
}

/** The columns the pictures of a post are laid in across the card: one picture is as wide as the card, two or more share two columns. */
export function pictureColumns(count: number): 1 | 2 {
  return count <= 1 ? 1 : 2
}
