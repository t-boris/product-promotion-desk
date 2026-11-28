// The decisions of the check before an approval that need no screen: whose text is read, what the panel stands for, what it offers.
// Pure, so they are tested without the interface (lesson 101).

import type { DraftInput } from '../../../../shared/api'
import { cardHeadline } from '../../../../shared/quick-post'
import type { DraftFinding, PostMarkup } from '../../../../shared/types'

/** What was pressed: "Approve" or "Approve and send". The panel keeps it so "Approve anyway" does exactly that. */
export type Approving = 'approve' | 'approve_send'

/**
 * Whether the text is read against the rules of an AI draft before it is approved: a text the owner wrote, or changed and has not saved.
 * An AI draft the owner left as it is passed those rules when it was written and is not read again.
 */
export function needsCheck(draft: { author: 'ai' | 'user' } | null, dirty: boolean): boolean {
  return dirty || draft?.author === 'user'
}

/**
 * Whether there is something to save or approve: some text, a link or a picture, and nothing the form itself stops (`blocked`: a quick post
 * without a headline on its card, or without the picture the owner chose). A card post always has a picture, so it is the form's own reason that
 * stops an empty card, never the picture.
 */
export const hasContent = (input: DraftInput, blocked: string | null): boolean => (input.text.trim().length > 0 || Boolean(input.link) || (input.attachments?.length ?? 0) > 0) && blocked === null

/** The editor as the core reads it. Includes the card headline on a quick post with a template card (Q-008, DEC-095). */
export function checkForm(input: DraftInput): { title: string; text: string; link: string; markup: PostMarkup; cardHeadline?: string } {
  const headline = input.postType === 'quick' && input.card ? cardHeadline(input.card, input.text) : ''
  return {
    title: input.title ?? '',
    text: input.text,
    link: input.link ?? '',
    markup: input.markup === 'markdown' ? 'markdown' : 'legacy',
    ...(headline ? { cardHeadline: headline } : {})
  }
}

/**
 * The panel is made for one text. The words that decide it (title, text, link, and card headline on a quick post) make its fingerprint:
 * once they change, the findings are about something that is no longer on the screen and the panel goes. The attachments are not read by the rules and are not part of it.
 */
export function fingerprint(input: DraftInput): string {
  const headline = input.postType === 'quick' && input.card ? cardHeadline(input.card, input.text) : ''
  return JSON.stringify([input.title ?? '', input.text, input.link ?? '', input.markup === 'markdown' ? 'markdown' : 'legacy', ...(headline ? [headline] : [])])
}

/** What the panel shows: the findings (or why the check could not be made) for the text with this fingerprint, after this button. */
export interface Held {
  which: Approving
  findings: DraftFinding[]
  /** Set when the check itself failed; the owner may still approve, nothing here is blocked by it. */
  error: string | null
  fingerprint: string
}

/** The panel, while the text it was made for is still the one on the screen. */
export function heldFor(held: Held | null, input: DraftInput): Held | null {
  return held !== null && held.fingerprint === fingerprint(input) ? held : null
}

export function approveAnywayLabel(which: Approving): string {
  return which === 'approve_send' ? 'Approve and send anyway' : 'Approve anyway'
}

/** The count beside the title of the panel. */
export function countLabel(findings: DraftFinding[]): string {
  return findings.length === 1 ? '1 thing' : `${findings.length} things`
}

/** The sentence under the title: what the panel is, and that nothing is approved yet. */
export function introLine(held: Pick<Held, 'findings' | 'error'>): string {
  if (held.error !== null) return `The text could not be checked (${held.error}). Nothing is approved yet; you can still approve it.`
  return "Your text breaks rules the AI's own drafts must follow. Nothing is approved yet."
}
