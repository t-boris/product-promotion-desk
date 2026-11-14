import type { CommentCategory, OpportunityDecision, OpportunityKind, OpportunityState, SendState } from '../../../../shared/types'
import type { Tone } from '../../ui'

export const STATE_LABEL: Record<OpportunityState, string> = {
  discovered: 'New',
  analyzing: 'Preparing',
  draft: 'Draft',
  awaiting_approval: 'Needs your approval',
  ready: 'Approved, ready to send',
  sending: 'Sending',
  confirmed: 'Sent',
  no_reply: 'No reply needed',
  deferred: 'Deferred',
  cancelled: 'Cancelled',
  needs_user: 'Needs your input',
  error: 'Error',
  unknown_result: 'Result unknown'
}

export const STATE_TONE: Record<OpportunityState, Tone> = {
  discovered: 'info',
  analyzing: 'info',
  draft: 'neutral',
  awaiting_approval: 'warn',
  ready: 'good',
  sending: 'info',
  confirmed: 'good',
  no_reply: 'neutral',
  deferred: 'neutral',
  cancelled: 'neutral',
  needs_user: 'warn',
  error: 'bad',
  unknown_result: 'bad'
}

export const KIND_LABEL: Record<OpportunityKind, string> = { reply: 'Reply', standalone: 'Publication' }

export const CATEGORY_LABEL: Record<CommentCategory, string> = {
  product_question: 'Product question',
  thanks: 'Thanks',
  purchase_interest: 'Purchase interest',
  complaint: 'Complaint',
  criticism: 'Criticism',
  irrelevant: 'Off topic',
  spam: 'Spam'
}

export const DECISION_LABEL: Record<OpportunityDecision, string> = {
  reply: 'Reply suggested',
  ask_user: 'Asks you to decide',
  handoff: 'Handed to you',
  ignore: 'Nothing to reply'
}

export const SEND_STATE_LABEL: Record<SendState, string> = { sending: 'Sending', confirmed: 'Confirmed', failed: 'Failed', unknown: 'Result unknown' }
export const SEND_STATE_TONE: Record<SendState, Tone> = { sending: 'info', confirmed: 'good', failed: 'bad', unknown: 'bad' }

/** States in which the content is out, in flight or waiting for a send result: it can no longer be edited. */
export const LOCKED_STATES: OpportunityState[] = ['sending', 'confirmed', 'unknown_result']

/** States the owner can still work on (edit, approve, reject, defer). */
export const WORKABLE_STATES: OpportunityState[] = ['draft', 'awaiting_approval', 'ready', 'needs_user', 'error', 'no_reply', 'deferred']

/** States in which the AI can be asked to prepare (or re-prepare) a draft. */
export const PREPARABLE_STATES: OpportunityState[] = ['discovered', 'needs_user', 'error', 'no_reply', 'draft', 'awaiting_approval', 'deferred']

/** One sentence telling the owner what the state means and what to do next. */
export const STATE_HINT: Partial<Record<OpportunityState, string>> = {
  discovered: 'A new comment. No draft yet: prepare one with the AI or write the reply yourself.',
  analyzing: 'The AI is preparing a draft.',
  awaiting_approval: 'Check the text, then approve it. Nothing is published before you approve.',
  ready: 'Approved. Press Send to publish; the app re-checks the thread first and will explain if it cannot send.',
  sending: 'Being published right now.',
  unknown_result: 'It is not known whether this was published. It will not be sent again until you check the platform.',
  deferred: 'Set aside. Approve it again when you want to send it.'
}

// The core words these reasons (DEC-010); the card recognises them to say what to do about them.
const OTHER_LOGIN_REASON = 'Another login of this product already speaks in this discussion'
const UNDISCLOSED_REASON = 'mentions the product; check that it says you are connected with it'

/** True when the item is held because a different login of the same product already speaks in the discussion. */
export const isLoginConflict = (reason: string): boolean => reason.startsWith(OTHER_LOGIN_REASON)

/** True when the text names the product without the model vouching that it says the author is connected with it. */
export const isUndisclosed = (reason: string): boolean => reason.includes(UNDISCLOSED_REASON)

export const LOGIN_CONFLICT_HINT =
  'Only one login of a product speaks in a discussion. Reject or defer the other login\'s item in this discussion, then prepare or approve this one again.'

export const DISCLOSURE_HINT = 'Edit the text so it says, in a few words, that you are connected with the product (for example "I work on it"), then approve it.'

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
