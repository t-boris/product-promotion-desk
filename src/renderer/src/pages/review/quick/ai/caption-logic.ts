// The decisions of the caption help that need no screen (REQ-004): which action the button offers, what is asked, and when an answer may still be put
// in. Pure, so they are tested without the interface (lessons 101, 245). The fate of an answer and the honesty of Undo are the shared ones of the
// other AI fields (assist/field-logic): typing wins, and Undo is offered only while the field still holds what the AI wrote.

import { QUICK_PLATFORMS } from '../../../../../../shared/quick-post'
import { QUICK_ANGLE_MAX, QUICK_WISH_MAX, type QuickCaptionArgs } from '../../../../../../shared/quick-ai'
import type { Id } from '../../../../../../shared/types'

/** Why a help cannot be asked now because of where the post goes; null when it can. Every help of the composer says it the same way. */
export function whereReason(platform: string | null, what: string): string | null {
  if (platform === null) return `Choose where to post first, so the AI ${what} for that platform.`
  if (!QUICK_PLATFORMS.includes(platform)) return `The AI ${what} for Instagram, Threads and Facebook only.`
  return null
}

/** An empty caption is written by the AI; a filled one is improved, steered by the owner's wish. */
export function captionAction(caption: string): { kind: 'write' | 'improve'; label: string } {
  return caption.trim() === '' ? { kind: 'write', label: 'Write with AI' } : { kind: 'improve', label: 'Improve with AI' }
}

/** Why the caption help is off, in words; null when it can be asked. */
export function captionBlockedReason(platform: string | null): string | null {
  return whereReason(platform, 'writes')
}

/** What the answer to the caption question depends on besides the caption itself: the channel and the platform it was written for. */
export function captionAround(channelId: Id | null, platform: string | null): string {
  return JSON.stringify([channelId, platform])
}

const clean = (text: string): string => text.trim()

/**
 * The question to the core. The wish steers an improvement only (a caption written from nothing has nothing to change); the angle and the card's
 * headline are sent only when there are some, so the AI is never told about an empty one.
 */
export function captionArgs(post: { productId: Id; channelId: Id | null; platform: string; caption: string; angle: string; headline: string }, wish: string): QuickCaptionArgs {
  const improving = captionAction(post.caption).kind === 'improve'
  const args: QuickCaptionArgs = { productId: post.productId, channelId: post.channelId, platform: post.platform, caption: post.caption }
  if (improving && clean(wish)) args.wish = clean(wish).slice(0, QUICK_WISH_MAX)
  if (clean(post.angle)) args.angle = clean(post.angle).slice(0, QUICK_ANGLE_MAX)
  if (clean(post.headline)) args.headline = clean(post.headline)
  return args
}

/** The line that says which angle steers the help, so the owner sees what the AI was told; null when there is none. */
export function angleLine(angle: string): string | null {
  const text = clean(angle)
  return text ? `Steered by your angle: ${text}` : null
}
