// The text fields the AI can write or improve (assist.refine). Each field has its own rules: how long it may be, whether it is one
// line, several lines or prose, and what it is for. The AI never stores anything: the owner reads the text and saves it with the form.

import type { AssistField } from '../../shared/types'

export interface FieldSpec {
  /** What the field is, in words the prompt can use ("goal target action"). */
  label: string
  /** What a good text in this field is. */
  purpose: string
  /** `line`: one line. `lines`: one item per line. `prose`: sentences, paragraphs allowed. */
  shape: 'line' | 'lines' | 'prose'
  /** Longest line (`line`, `lines`) or longest text (`prose`), in characters. */
  max: number
  /** Most lines (`lines` only). */
  maxLines: number
  /**
   * What an answer must not hold. `all`: a credential, automation of posting or replying, a promise of results (text that proposes
   * something to do). `credentials`: only a credential (text about the owner's own product may say "guarantee" or "automatic").
   */
  guard: 'all' | 'credentials'
}

export const FIELDS: Record<AssistField, FieldSpec> = {
  'goal.targetAction': {
    label: 'goal target action',
    purpose: 'One concrete thing a person does after they meet the product (for example: create the first chart, join the waitlist), never a vague aim such as "grow" or "raise awareness".',
    shape: 'line',
    max: 300,
    maxLines: 1,
    guard: 'all'
  },
  'goal.metrics': {
    label: 'goal success metrics',
    purpose:
      'Short measures the owner can count by hand or read from the numbers a platform shows (replies, saves, sign-ups the owner counts). The application cannot see the owner\'s own site analytics, so no conversion rates or analytics tools.',
    shape: 'lines',
    max: 100,
    maxLines: 4,
    guard: 'all'
  },
  'goal.notes': {
    label: 'goal notes',
    purpose: 'An optional note on the goal: how the owner will judge it, a time frame or a constraint.',
    shape: 'prose',
    max: 1000,
    maxLines: 1,
    guard: 'all'
  },
  'product.description': {
    label: 'product description',
    purpose: 'Two or three plain sentences on what the product is and who it is for, as the owner would say it.',
    shape: 'prose',
    max: 600,
    maxLines: 1,
    guard: 'credentials'
  }
}

export const isAssistField = (value: unknown): value is AssistField => typeof value === 'string' && Object.prototype.hasOwnProperty.call(FIELDS, value)
