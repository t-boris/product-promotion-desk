// The decisions of the trends help that need no screen (REQ-004, DEC-042): when the search can be asked, what is asked, what the owner is shown of the
// answer, and when an answer may still be shown. Pure, so they are tested without the interface.
//
// The search only reads. What it finds is shown to the owner first; the owner presses "Use this angle" for anything to steer a later help, and
// nothing in the post changes by itself.

import { QUICK_ANGLE_MAX, QUICK_SEARCH_WISH_MAX, quickTrendsSubject, type QuickTopic, type QuickTrendsArgs, type QuickTrendsResult } from '../../../../../../shared/quick-ai'
import type { Id } from '../../../../../../shared/types'
import { whereReason } from './caption-logic'

/** Why the search cannot be asked now; null when it can. It runs in the browser of the channel's account, so it needs a channel. */
export function trendsBlockedReason(channelId: Id | null, platform: string | null): string | null {
  if (channelId === null) return 'Choose a channel first: the search is made in that channel\'s own browser, on its platform.'
  return whereReason(platform, 'searches')
}

export function trendsArgs(productId: Id, channelId: Id, wish: string): QuickTrendsArgs {
  const text = wish.trim().slice(0, QUICK_SEARCH_WISH_MAX)
  return text ? { productId, channelId, wish: text } : { productId, channelId }
}

/** The subject the progress panel filters by: only this channel's search is shown here. */
export const progressSubject = (channelId: Id | null): string | undefined => (channelId === null ? undefined : quickTrendsSubject(channelId))

/** Said after every message that is not an answer: the search is a help, and the owner does not need it to go on. */
export const STILL_YOURS = 'You can still write the caption and make the picture yourself.'

export type TrendsView =
  | { kind: 'topics'; topics: QuickTopic[]; angle: { text: string; why: string } | null; searched: string | null; note: string | null }
  | { kind: 'message'; state: 'unavailable' | 'needs_owner' | 'failed' | 'stopped'; tone: 'warn' | 'neutral'; text: string }

/** What the owner is shown of an answer: the topics and the angle, or one message in words. */
export function trendsView(result: QuickTrendsResult): TrendsView {
  if (result.state === 'ready') {
    return {
      kind: 'topics',
      topics: result.topics,
      angle: result.angle,
      searched: result.searched.length > 0 ? `Searched for: ${result.searched.join(', ')}` : null,
      note: result.note
    }
  }
  const stopped = result.state === 'stopped'
  return { kind: 'message', state: result.state, tone: stopped ? 'neutral' : 'warn', text: stopped ? result.message : `${result.message} ${STILL_YOURS}` }
}

export type TrendsFate = 'show' | 'channel_changed'

/** The topics were found in one channel's browser, on its platform: if the post goes elsewhere when they arrive, they are not shown. */
export function trendsFate(askedChannel: Id, nowChannel: Id | null): TrendsFate {
  return askedChannel === nowChannel ? 'show' : 'channel_changed'
}

export const trendsSkippedNote = (fate: TrendsFate): string | null => (fate === 'show' ? null : 'You changed the channel while the AI was searching, so its answer was not shown. Search again to get it.')

/** The angle the owner may use is one or two sentences, never empty. */
export const angleUsable = (text: string): boolean => text.trim() !== '' && text.trim().length <= QUICK_ANGLE_MAX

/** The angle as it is handed on: what the owner typed, trimmed. */
export const angleToUse = (text: string): string => text.trim().slice(0, QUICK_ANGLE_MAX)

/** The proposed angle is offered while the owner has none in use; once one is used, "Use" gives way to "In use" and "Clear". */
export const angleInUse = (inUse: string, draft: string): boolean => inUse.trim() !== '' && inUse.trim() === draft.trim()
