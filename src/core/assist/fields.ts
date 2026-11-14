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
  /** Whose text it is: a product's, or a channel's (which also gives the AI the platform and the address). */
  scope: 'product' | 'channel'
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
    scope: 'product',
    guard: 'all'
  },
  'goal.metrics': {
    label: 'goal success metrics',
    purpose:
      'Short measures the owner can count by hand or read from the numbers a platform shows (replies, saves, sign-ups the owner counts). The application cannot see the owner\'s own site analytics, so no conversion rates or analytics tools.',
    shape: 'lines',
    max: 100,
    maxLines: 4,
    scope: 'product',
    guard: 'all'
  },
  'goal.notes': {
    label: 'goal notes',
    purpose: 'An optional note on the goal: how the owner will judge it, a time frame or a constraint.',
    shape: 'prose',
    max: 1000,
    maxLines: 1,
    scope: 'product',
    guard: 'all'
  },
  'product.description': {
    label: 'product description',
    purpose: 'Two or three plain sentences on what the product is and who it is for, as the owner would say it.',
    shape: 'prose',
    max: 600,
    maxLines: 1,
    scope: 'product',
    guard: 'credentials'
  },
  'channel.style': {
    label: 'style of replies in this channel',
    purpose:
      'How the product should sound in this channel when it replies or posts: tone, length, words to avoid (for example: warm, short, no hype, no emojis). A plain description of the voice, nothing to automate.',
    shape: 'prose',
    max: 400,
    maxLines: 1,
    scope: 'channel',
    guard: 'all'
  },
  'channel.topics': {
    label: 'topics to watch in this channel',
    purpose: 'Short topics of the discussions in this channel where the product could honestly help. One topic per line, no commas inside a topic.',
    shape: 'lines',
    max: 80,
    maxLines: 8,
    scope: 'channel',
    guard: 'all'
  },
  'channel.queries': {
    label: 'search queries for this channel',
    purpose: 'Short phrases a person would type when they have the problem the product solves. One phrase per line, no commas inside a phrase.',
    shape: 'lines',
    max: 80,
    maxLines: 8,
    scope: 'channel',
    guard: 'all'
  }
}

export const isAssistField = (value: unknown): value is AssistField => typeof value === 'string' && Object.prototype.hasOwnProperty.call(FIELDS, value)
