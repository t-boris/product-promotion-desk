// The decisions of the picture help that need no screen (REQ-004): what the button can do for the picture the post has now, what is asked, whether a
// proposal still fits when it arrives, and when Undo of a used proposal is still honest. Pure, so they are tested without the interface.

import { QUICK_ANGLE_MAX, type QuickPictureArgs, type QuickPictureResult } from '../../../../../../shared/quick-ai'
import type { QuickCard } from '../../../../../../shared/quick-post'
import type { Id } from '../../../../../../shared/types'
import type { AnswerFate } from '../../../../assist/field-logic'
import { whereReason } from './caption-logic'
import type { QuickPictureSource } from './types'

/** What the button does for the picture the post has now, or why it cannot. */
export type PictureAction = { ok: true; kind: 'card' | 'illustration'; label: string } | { ok: false; hint: string }

export function pictureAction(source: QuickPictureSource, platform: string | null, illustrationWish: string): PictureAction {
  const where = whereReason(platform, 'plans the picture')
  if (where) return { ok: false, hint: where }
  switch (source) {
    case 'card':
      return { ok: true, kind: 'card', label: 'Suggest a card with AI' }
    case 'illustration':
      return { ok: true, kind: 'illustration', label: illustrationWish.trim() ? 'Improve the description with AI' : 'Suggest a description with AI' }
    case 'file':
      return { ok: false, hint: 'The AI does not change a picture you chose. Use the card, or let the AI make an illustration, to get a proposal.' }
    case 'none':
      return { ok: false, hint: 'Choose the card, or an illustration the AI makes, to get a proposal for the picture.' }
  }
}

/** The question to the core: the card's headline now (so it is improved, not replaced blind), or the description so far. */
export function pictureArgs(post: { productId: Id; channelId: Id | null; platform: string; caption: string; angle: string }, action: { kind: 'card' | 'illustration' }, current: { headline: string; description: string }): QuickPictureArgs {
  const args: QuickPictureArgs = { productId: post.productId, channelId: post.channelId, platform: post.platform, kind: action.kind, caption: post.caption }
  const headline = current.headline.trim()
  if (action.kind === 'card' && headline) args.headline = headline
  if (post.angle.trim()) args.angle = post.angle.trim().slice(0, QUICK_ANGLE_MAX)
  return args
}

/**
 * What the answer depends on besides the thing it replaces (the card's look, or the illustration's description): the channel and platform it was
 * written for, and the kind of picture. If it differs when the answer arrives, the answer is dropped (the shared fate of the AI fields).
 */
export function pictureAround(channelId: Id | null, platform: string | null, source: QuickPictureSource): string {
  return JSON.stringify([channelId, platform, source])
}

/** The card's own look as the thing a proposal replaces: if it differs when the answer arrives, the owner changed it meanwhile and typing wins. */
export const cardValue = (card: QuickCard | null): string => JSON.stringify(card ? [card.headline, card.headlineEdited, card.style, card.colour] : null)

/** What the owner is told when a proposal was dropped; null when it was used. */
export function pictureSkippedNote(fate: AnswerFate): string | null {
  switch (fate) {
    case 'apply':
      return null
    case 'typed':
      return 'You changed the picture while the AI was working, so its proposal was not used. Ask again to get it.'
    case 'draft_changed':
      return 'The post changed while the AI was working (the channel or the kind of picture), so its proposal was not used. Ask again to get it.'
    case 'locked':
      return 'The post was being saved while the AI was working, so its proposal was not used. Ask again to get it.'
  }
}

/** The look of the card the owner sees: what a proposal replaces and what Undo puts back. */
export interface CardLook {
  headline: string
  headlineEdited: boolean
  style: QuickCard['style']
  colour: QuickCard['colour']
}

export const lookOf = (card: QuickCard): CardLook => ({ headline: card.headline, headlineEdited: card.headlineEdited, style: card.style, colour: card.colour })

/** What the AI put on the card, and what was there before it. */
export interface AppliedCard {
  before: CardLook
  after: Pick<CardLook, 'headline' | 'style' | 'colour'>
}

export type CardProposal = Extract<QuickPictureResult, { kind: 'card' }>

/** Using a card proposal: the headline, the style and the colour, together (they are one proposal). */
export function appliedCard(card: QuickCard, proposal: Pick<CardProposal, 'headline' | 'style' | 'colour'>): AppliedCard {
  return { before: lookOf(card), after: { headline: proposal.headline, style: proposal.style, colour: proposal.colour } }
}

/** Undo is offered only while the card still shows what the AI put on it: once the owner changes the headline, the style or the colour, it is theirs again. */
export function cardUndoable(card: QuickCard | null, applied: AppliedCard | null): boolean {
  return card !== null && applied !== null && card.headline === applied.after.headline && card.style === applied.after.style && card.colour === applied.after.colour
}

/** What undoing calls: the headline as the owner had it (null when it followed the caption), with the style and the colour. */
export function undoCard(applied: AppliedCard): { headline: string | null; look: { style: QuickCard['style']; colour: QuickCard['colour'] } } {
  return { headline: applied.before.headlineEdited ? applied.before.headline : null, look: { style: applied.before.style, colour: applied.before.colour } }
}
