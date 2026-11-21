// What the quick-post composer holds while the owner works (REQ-002, REQ-003): the caption, the card, the picture the owner chose instead of the
// card, and what each of them becomes in a draft. Pure, so every rule of the form (when the headline follows the caption, when the picture is a
// card, what a save sends, what stops it) is tested without the screen.

import type { DraftInput } from '../../../../../shared/api'
import { characterCount } from '../../../../../shared/post-format'
import { CARD_HEADLINE_MAX, cardHeadline, DEFAULT_CARD, type CardColour, type CardShape, type CardStyle, type QuickCard } from '../../../../../shared/quick-post'
import type { Attachment, Draft } from '../../../../../shared/types'

/** `card`: the app draws the picture from the headline (the default). `picture`: the owner's own, an AI illustration, a file or a library picture. */
export type PictureSource = 'card' | 'picture'

export interface QuickForm {
  caption: string
  /** Style, colour, shape and the headline the owner typed. What is drawn is `drawnCard`: the headline follows the caption until the owner edits it. */
  card: QuickCard
  source: PictureSource
  /** The picture of the library the owner chose. Kept when the owner goes back to the card, so changing their mind loses nothing. */
  picture: Attachment | null
  /** A link a saved draft carries. The composer has no field for it (a link goes in the caption), so a saved one stays as it was. */
  link: string | null
  /**
   * What the AI's helps work with and the post does not keep (REQ-004): the angle the owner chose from the trends, and the description an illustration
   * is made from. They live in the form so that switching to an article and back loses neither, and they are no part of what is saved or of what is
   * changed: only the owner's words, the card and the picture are.
   */
  angle: string
  illustrationWish: string
}

export const emptyQuickForm = (): QuickForm => ({ caption: '', card: { ...DEFAULT_CARD }, source: 'card', picture: null, link: null, angle: '', illustrationWish: '' })

/**
 * A saved quick post as the form: its card parameters when the picture is a card, its picture otherwise. A draft that is not a quick post (or none)
 * gives the empty form, so the form never shows an article's title as a caption.
 */
export function quickFormOf(draft: Draft | null): QuickForm {
  if (!draft || draft.postType !== 'quick') return emptyQuickForm()
  const picture = draft.attachments[0] ?? null
  return {
    caption: draft.text,
    card: draft.card ? { ...draft.card } : { ...DEFAULT_CARD },
    source: draft.card ? 'card' : picture ? 'picture' : 'card',
    picture: draft.card ? null : picture,
    link: draft.link,
    angle: '',
    illustrationWish: ''
  }
}

/** True when the picture of the post is the card the app draws. */
export const isCardPicture = (form: QuickForm): boolean => form.source === 'card'

/** The card as it is drawn: the owner's headline once they edited it, otherwise the first line of the caption. */
export const drawnCard = (form: QuickForm): QuickCard => ({ ...form.card, headline: cardHeadline(form.card, form.caption) })

// ───────────────────────────── changes ─────────────────────────────

export const withCaption = (form: QuickForm, caption: string): QuickForm => ({ ...form, caption })

export const withAngle = (form: QuickForm, angle: string): QuickForm => ({ ...form, angle })
export const withIllustrationWish = (form: QuickForm, illustrationWish: string): QuickForm => ({ ...form, illustrationWish })

/** The most a headline holds, counted like every limit (an emoji is one character): what the core refuses to store beyond. */
export const clampHeadline = (headline: string): string => [...headline].slice(0, CARD_HEADLINE_MAX).join('')

/**
 * The owner typed in the headline field: from now on the headline is theirs and never follows the caption again. The field stops at the limit
 * the core stores (a longer one was drawn and added to the library before the core refused the draft, and left a picture nobody uses).
 */
export const withHeadline = (form: QuickForm, headline: string): QuickForm => ({ ...form, card: { ...form.card, headline: clampHeadline(headline), headlineEdited: true } })

/** Takes the headline from the caption again, as it was before the owner edited it. */
export const followCaption = (form: QuickForm): QuickForm => ({ ...form, card: { ...form.card, headline: '', headlineEdited: false } })

export const withStyle = (form: QuickForm, style: CardStyle): QuickForm => ({ ...form, card: { ...form.card, style } })
export const withColour = (form: QuickForm, colour: CardColour): QuickForm => ({ ...form, card: { ...form.card, colour } })
export const withShape = (form: QuickForm, shape: CardShape): QuickForm => ({ ...form, card: { ...form.card, shape } })

/** Style, colour and shape together, any of them: what a help that proposes a look sets in one change. */
export const withLook = (form: QuickForm, look: { style?: CardStyle; colour?: CardColour; shape?: CardShape }): QuickForm => ({
  ...form,
  card: { ...form.card, style: look.style ?? form.card.style, colour: look.colour ?? form.card.colour, shape: look.shape ?? form.card.shape }
})

/**
 * What the picture is, in the words the helps know (`QuickPictureSource`): the card the app draws; a picture the owner chose, made or pasted (the AI cannot
 * change it); or no picture yet, where the AI can propose the description of one to make. Pure, so the mapping is tested once.
 */
export function pictureSourceOf(form: Pick<QuickForm, 'source' | 'picture'>): 'card' | 'illustration' | 'file' {
  if (form.source === 'card') return 'card'
  return form.picture ? 'file' : 'illustration'
}

/** The card makes the picture again (the default). */
export const chooseCard = (form: QuickForm): QuickForm => ({ ...form, source: 'card' })

/** The owner's own picture makes the picture: an illustration, a file or a library picture. */
export const choosePicture = (form: QuickForm, picture: Attachment | null = form.picture): QuickForm => ({ ...form, source: 'picture', picture })

/** The picture is taken out; the card is not touched. */
export const withoutPicture = (form: QuickForm): QuickForm => ({ ...form, picture: null })

// ───────────────────────────── what the form becomes ─────────────────────────────

/** Stands for the card that is drawn when the post is saved: the questions asked before that (where it fits, whether it can be saved) count it as the one picture. */
export const CARD_TO_DRAW: Attachment = { name: 'card.png', path: '', mime: 'image/png', sha256: '' }

/**
 * The draft this form makes. `drawn` is the picture of the card once it was drawn and stored (a save renders it first); without it the card is
 * `CARD_TO_DRAW`, which is enough to ask a question but is never saved.
 */
export function quickInput(form: QuickForm, drawn: Attachment = CARD_TO_DRAW): DraftInput {
  const card = isCardPicture(form)
  return {
    title: null,
    text: form.caption.trim(),
    link: form.link,
    attachments: card ? [drawn] : form.picture ? [form.picture] : [],
    markup: 'legacy',
    postType: 'quick',
    card: card ? drawnCard(form) : null
  }
}

/** What the channels are asked about the post: its words and its picture, never the card's colours (changing a colour does not change what fits where). */
export function quickQuestion(form: QuickForm): DraftInput {
  const { card: _card, ...question } = quickInput(form)
  return question
}

/**
 * The picture a saved quick post already has, while the card needs no new drawing (so nothing is drawn or stored until the owner saves); the stand-in
 * for the card to be drawn otherwise. Undefined for a picture of the owner's own (`quickInput` then uses it).
 */
export function cardAttachment(form: QuickForm, saved: Draft | null): Attachment | undefined {
  if (!isCardPicture(form)) return undefined
  return needsNewCard(form, saved) ? CARD_TO_DRAW : saved?.attachments[0]
}

/** What the picture of the card is made of: it changes when the picture would look different, and for nothing else. */
export const cardSignature = (card: QuickCard): string => JSON.stringify([card.style, card.colour, card.shape, card.headline])

/** The whole form as one string, to tell a changed form from the saved one. */
export function quickSignature(form: QuickForm): string {
  return JSON.stringify([form.caption.trim(), form.link, form.source, form.source === 'card' ? [cardSignature(drawnCard(form)), form.card.headlineEdited] : (form.picture?.mediaId ?? form.picture?.path ?? null)])
}

/**
 * True when the owner changed something the saved draft does not have, or when what the form would draw is not the picture the draft has: the
 * caption of a saved card post can change without the owner (the group's "Adapt with AI" rewrites it), and then its headline, which follows the
 * caption, would no longer be on the card. Such a post is offered for saving, so the picture that is approved is the one that is shown.
 */
export const quickDirty = (form: QuickForm, saved: Draft | null): boolean =>
  quickSignature(form) !== quickSignature(quickFormOf(saved)) || (saved?.postType === 'quick' && needsNewCard(form, saved))

/**
 * True when saving must draw the card again: the picture is a card, and either the saved draft has no card or the card would look different
 * from the saved one. A changed caption alone does not draw it again when the headline is the owner's own.
 */
export function needsNewCard(form: QuickForm, saved: Draft | null): boolean {
  if (!isCardPicture(form)) return false
  if (!saved || saved.postType !== 'quick' || !saved.card || !saved.attachments[0]) return true
  return cardSignature(drawnCard(form)) !== cardSignature(saved.card)
}

// ───────────────────────────── what stops a save ─────────────────────────────

export const WRITE_A_CAPTION = 'Write a caption first.'
export const CHOOSE_A_PICTURE = 'Choose a picture, or go back to the card.'
export const WRITE_A_HEADLINE = 'Write a headline for the card, or choose a picture of your own.'
export const HEADLINE_TOO_LONG = `The headline is longer than ${CARD_HEADLINE_MAX} characters. Shorten it before saving.`

/**
 * Why the post cannot be saved yet, or null: nothing to say (no caption and no headline on the card), a card without a headline, or a picture
 * that was not chosen. The platform's own limits are not here: a post over a limit is saved, and its version says what is wrong.
 */
export function quickReason(form: QuickForm): string | null {
  const caption = form.caption.trim()
  if (isCardPicture(form)) {
    if (caption === '' && drawnCard(form).headline.trim() === '') return WRITE_A_CAPTION
    if (drawnCard(form).headline.trim() === '') return WRITE_A_HEADLINE
    // Checked before anything is drawn or added to the library: the core refuses a card whose headline is longer than it stores.
    if (characterCount(drawnCard(form).headline) > CARD_HEADLINE_MAX) return HEADLINE_TOO_LONG
    return null
  }
  return form.picture ? null : CHOOSE_A_PICTURE
}

/** The name the card's picture has in the library: "card-" and the first words of its headline, safe as a file name. */
export function cardFileName(headline: string): string {
  const words = headline
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '')
    .slice(0, 5)
  return `${['card', ...words].join('-')}.png`
}
