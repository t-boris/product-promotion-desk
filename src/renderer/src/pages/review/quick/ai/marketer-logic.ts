// The decisions of the marketer's read that need no screen (REQ-004, DEC-043): what the marketer is told of the picture, when there is something to
// read, how the answer is worded for the owner, and when a suggestion may still be applied. Pure, so they are tested without the interface.
//
// The marketer judges against the promotion goal in the approved knowledge; the goal it used is shown, and a suggestion changes the post only when the
// owner presses it, and only while the thing it would replace is still what it was read from (typing wins).

import { QUICK_ANGLE_MAX, type QuickAssessArgs, type QuickAssessment, type QuickPictureFacts, type QuickPoint, type QuickSuggestion, type QuickVerdict } from '../../../../../../shared/quick-ai'
import type { QuickCard } from '../../../../../../shared/quick-post'
import type { Id } from '../../../../../../shared/types'
import type { Tone } from '../../../../tone'
import { whereReason } from './caption-logic'
import type { QuickPictureSource } from './types'

/** The picture as the marketer is told of it. An illustration with no description yet, and a card with no words, are not pictures it can judge. */
export function pictureFacts(source: QuickPictureSource, card: QuickCard | null, illustrationWish: string): QuickPictureFacts {
  switch (source) {
    case 'card':
      return card && card.headline.trim() ? { kind: 'card', headline: card.headline.trim(), style: card.style, colour: card.colour } : { kind: 'none' }
    case 'illustration':
      return illustrationWish.trim() ? { kind: 'illustration', description: illustrationWish.trim() } : { kind: 'none' }
    case 'file':
      return { kind: 'file' }
    case 'none':
      return { kind: 'none' }
  }
}

/** Why there is nothing to read yet; null when there is. */
export function marketerBlockedReason(platform: string | null, caption: string, facts: QuickPictureFacts): string | null {
  const where = whereReason(platform, 'reads the post')
  if (where) return where
  if (caption.trim() === '' && facts.kind === 'none') return 'Write a caption or choose a picture first: there is nothing to read yet.'
  return null
}

export function assessArgs(post: { productId: Id; channelId: Id | null; platform: string; caption: string; angle: string }, picture: QuickPictureFacts): QuickAssessArgs {
  const args: QuickAssessArgs = { productId: post.productId, channelId: post.channelId, platform: post.platform, caption: post.caption, picture }
  if (post.angle.trim()) args.angle = post.angle.trim().slice(0, QUICK_ANGLE_MAX)
  return args
}

/** What a reading was made from, and what a suggestion would replace. A reading of an earlier version says so. */
export interface Reading {
  caption: string
  /** The card's headline when the picture is a card; '' otherwise. */
  headline: string
  source: QuickPictureSource
  channelId: Id | null
  platform: string | null
  angle: string
}

export function readingOf(post: { caption: string; angle: string; channelId: Id | null; platform: string | null }, source: QuickPictureSource, card: QuickCard | null, illustrationWish: string): Reading & { illustration: string } {
  return { caption: post.caption, headline: source === 'card' && card ? card.headline : '', source, channelId: post.channelId, platform: post.platform, angle: post.angle, illustration: source === 'illustration' ? illustrationWish : '' }
}

/** A reading is current while nothing it was made from has changed. */
export function readingCurrent(asked: Reading & { illustration: string }, now: Reading & { illustration: string }): boolean {
  return JSON.stringify(asked) === JSON.stringify(now)
}

export type SuggestionState = { usable: true } | { usable: false; reason: string }

/**
 * A suggestion is applied only to what it was written for. A caption suggestion replaces the caption, so it waits for the caption it was read from; a
 * headline suggestion replaces the card's headline, so it waits for the same card. Anything else changed meanwhile means the owner moved on, and the
 * reading is asked again.
 */
export function suggestionState(suggestion: QuickSuggestion, asked: Reading, now: Reading): SuggestionState {
  if (suggestion.kind === 'caption') {
    return now.caption === asked.caption ? { usable: true } : { usable: false, reason: 'The caption changed since this reading. Read the post again to get a fresh suggestion.' }
  }
  if (now.source !== 'card' || asked.source !== 'card') return { usable: false, reason: 'The picture is not the card any more. Read the post again to get a fresh suggestion.' }
  return now.headline === asked.headline ? { usable: true } : { usable: false, reason: 'The card changed since this reading. Read the post again to get a fresh suggestion.' }
}

// ───────────────────────────── the words ─────────────────────────────

export const VERDICT_VIEW: Record<QuickVerdict, { label: string; tone: Tone }> = {
  on_goal: { label: 'On goal', tone: 'good' },
  partly: { label: 'Partly on goal', tone: 'warn' },
  off_goal: { label: 'Off goal', tone: 'bad' },
  unclear: { label: 'Goal unclear', tone: 'neutral' }
}

/** The goal the marketer used, said as the owner reads it; when the approved knowledge does not say, that is said, with where to say it. */
export function goalLine(assessment: Pick<QuickAssessment, 'goal'>): string {
  return assessment.goal ? `Goal used: ${assessment.goal}` : 'The approved product passport does not say what this promotion is for, so the post cannot be judged against a goal. Add the promotion goal to the passport and approve it.'
}

export const POINT_ABOUT: Record<QuickPoint['about'], string> = { caption: 'Caption', picture: 'Picture', both: 'Caption and picture' }

/** What a suggestion offers, said on its button. */
export const suggestionLabel = (suggestion: QuickSuggestion): string => (suggestion.kind === 'caption' ? 'Use this caption' : 'Use this headline')

/** The text of a suggestion, to read before pressing. */
export const suggestionText = (suggestion: QuickSuggestion): string => (suggestion.kind === 'caption' ? suggestion.caption : suggestion.headline)
