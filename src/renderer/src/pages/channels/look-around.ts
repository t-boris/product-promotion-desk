// The words and decisions of the "Look around" card of a channel (DEC-045) that need no screen: what each button asks, what is sent, and what the
// owner is told while it works. The AI only reads; everything it finds is shown to the owner, nothing is saved, posted or changed by it.

import { QUICK_SEARCH_WISH_MAX, type QuickAngle, type QuickLookMode, type QuickTopic, type QuickTrendsArgs, type QuickTrendsResult } from '../../../../shared/quick-ai'
import type { Channel } from '../../../../shared/types'

export interface LookButton {
  mode: QuickLookMode
  label: string
  /** One line under the buttons while this one is the last asked: what the AI is looking at. */
  what: string
}

export const LOOK_BUTTONS: readonly LookButton[] = [
  { mode: 'trends', label: 'What people talk about', what: 'what people are talking about around your subjects' },
  { mode: 'now', label: 'What is happening now', what: 'what is being posted and asked here right now' },
  { mode: 'feed', label: 'Analyse the feed', what: 'which kinds of posts get a response here, and which do not' }
]

export const LOOK_AROUND_INTRO = "The AI opens this place in the browser of its account, looks at it the way you would, and tells you what it saw. It only reads: it posts nothing, answers nothing and presses nothing."

/** What the card sends for a button; the owner's words (optional) steer the look. */
export function lookArgs(channel: Pick<Channel, 'id' | 'productId'>, mode: QuickLookMode, wish: string): QuickTrendsArgs {
  const text = wish.trim().slice(0, QUICK_SEARCH_WISH_MAX)
  return { productId: channel.productId, channelId: channel.id, mode, ...(text ? { wish: text } : {}) }
}

export const lookButtonOf = (mode: QuickLookMode | null): LookButton | undefined => LOOK_BUTTONS.find((b) => b.mode === mode)

/** Why the buttons are off for a channel, in words; null when they can be pressed. A channel that is paused is left alone until the owner resumes it. */
export const lookBlockedReason = (channel: Pick<Channel, 'status'>): string | null => (channel.status === 'paused' ? 'This channel is paused. Resume it to let the AI look at it.' : null)

export type LookView =
  | { kind: 'topics'; topics: QuickTopic[]; angle: QuickAngle | null; searched: string | null; note: string | null }
  | { kind: 'message'; state: 'unavailable' | 'needs_owner' | 'failed' | 'stopped'; tone: 'warn' | 'neutral'; text: string }

/** What the owner is shown of an answer: what the AI saw and the angle it proposes, or one message in words (a look that was stopped is not a problem). */
export function lookView(result: QuickTrendsResult): LookView {
  if (result.state === 'ready') {
    return { kind: 'topics', topics: result.topics, angle: result.angle, searched: result.searched.length > 0 ? `Looked for: ${result.searched.join(', ')}` : null, note: result.note }
  }
  return { kind: 'message', state: result.state, tone: result.state === 'stopped' ? 'neutral' : 'warn', text: result.message }
}
