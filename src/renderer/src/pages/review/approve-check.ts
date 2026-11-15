// The decisions of the check before an approval that need no screen: whose text is read, what the panel stands for, what it offers.
// Pure, so they are tested without the interface (lesson 101).

import type { DraftInput } from '../../../../shared/api'
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

/** The editor as the core reads it. */
export function checkForm(input: DraftInput): { title: string; text: string; link: string; markup: PostMarkup } {
  return { title: input.title ?? '', text: input.text, link: input.link ?? '', markup: input.markup === 'markdown' ? 'markdown' : 'legacy' }
}

/**
 * The panel is made for one text. The words that decide it (title, text, link) make its fingerprint: once they change, the findings are about
 * something that is no longer on the screen and the panel goes. The attachments are not read by the rules and are not part of it.
 */
export function fingerprint(input: DraftInput): string {
  return JSON.stringify([input.title ?? '', input.text, input.link ?? '', input.markup === 'markdown' ? 'markdown' : 'legacy'])
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

/** "Approve anyway" is offered unless a finding blocks: the approval itself refuses that one, so a button for it would only fail. */
export function mayApproveAnyway(held: Pick<Held, 'findings'>): boolean {
  return !held.findings.some((f) => f.blocks)
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
  if (!mayApproveAnyway(held)) return 'Something here has to be fixed before the text can be approved. Nothing is approved yet.'
  return "Your text breaks rules the AI's own drafts must follow. Nothing is approved yet."
}
