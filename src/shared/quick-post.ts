// The quick post (REQ-001..REQ-003, DEC-038, DEC-045, DEC-046): one picture plus a short caption for Instagram, Threads or Facebook.
// One pure module for what every layer must agree on: which channels make a quick post, what the template card is made of, where its
// headline comes from and how a quick post is named where a title would be. The core stores and validates these, the composer edits them.

import { characterCount } from './post-format'

// ───────────────────────────── the post type follows the channel ─────────────────────────────

/** `article`: the long form (title, Markdown text, pictures in the text); `quick`: one picture and a short caption. */
export type PostType = 'article' | 'quick'

/** The platforms whose posts are one picture and a caption (DEC-038). Every other platform takes the article form. */
export const QUICK_PLATFORMS: readonly string[] = ['instagram', 'threads', 'facebook']

/** The post type a channel of this platform makes. */
export const postTypeOfPlatform = (platform: string): PostType => (QUICK_PLATFORMS.includes(platform) ? 'quick' : 'article')

/**
 * Channels of the two kinds are never chosen together (DEC-041). `chosen` is the platforms already ticked; the answer is the reason the
 * channel of `platform` cannot be ticked now, or null when it can.
 */
export function mixedKindReason(platform: string, chosen: readonly string[]): string | null {
  if (chosen.length === 0) return null
  const kind = postTypeOfPlatform(platform)
  const other = chosen.find((p) => postTypeOfPlatform(p) !== kind)
  if (other === undefined) return null
  return kind === 'quick'
    ? 'A picture post and an article cannot go together. Untick the article channels to choose this one.'
    : 'An article and a picture post cannot go together. Untick the picture channels (Instagram, Threads, Facebook) to choose this one.'
}

// ───────────────────────────── the template card ─────────────────────────────

/** The shape of the card picture, with the pixels it is drawn at. `portrait` is 4:5 and `wide` is 1.91:1, the two ends of what Instagram takes. */
export const CARD_SHAPES = ['square', 'portrait', 'wide'] as const
export type CardShape = (typeof CARD_SHAPES)[number]
export const CARD_PIXELS: Record<CardShape, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  wide: { width: 1080, height: 566 }
}

/** How the headline sits on the card. */
export const CARD_STYLES = ['bold', 'quote', 'minimal'] as const
export type CardStyle = (typeof CARD_STYLES)[number]

/** The named colour of the card's background (the card renderer maps a name to a gradient). */
export const CARD_COLOURS = ['indigo', 'sunset', 'ocean', 'forest', 'berry', 'graphite'] as const
export type CardColour = (typeof CARD_COLOURS)[number]

export const CARD_HEADLINE_MAX = 140

/**
 * What the card is made of; kept in the draft (DEC-046) so a saved card can be changed and drawn again (REQ-003).
 * `headlineEdited` is false while the headline follows the first line of the caption, and true once the owner edited the headline itself.
 */
export interface QuickCard {
  style: CardStyle
  colour: CardColour
  shape: CardShape
  headline: string
  headlineEdited: boolean
}

export const DEFAULT_CARD: QuickCard = { style: 'bold', colour: 'indigo', shape: 'square', headline: '', headlineEdited: false }

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value)

/** The card parameters as they may be stored: a known style, colour and shape and a headline of a sane length; anything else is refused (null). */
export function parseQuickCard(value: unknown): QuickCard | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!oneOf(CARD_STYLES, v.style) || !oneOf(CARD_COLOURS, v.colour) || !oneOf(CARD_SHAPES, v.shape)) return null
  if (typeof v.headline !== 'string' || typeof v.headlineEdited !== 'boolean') return null
  const headline = v.headline.replace(/\s+/g, ' ').trim()
  if (characterCount(headline) > CARD_HEADLINE_MAX) return null
  return { style: v.style, colour: v.colour, shape: v.shape, headline, headlineEdited: v.headlineEdited }
}

/** The first line of the caption that has any words, trimmed and cut to what a card can show. This is the headline until the owner edits it. */
export function headlineFromCaption(caption: string): string {
  const line = caption.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).find((l) => l !== '') ?? ''
  const letters = [...line]
  return letters.length > CARD_HEADLINE_MAX ? `${letters.slice(0, CARD_HEADLINE_MAX - 1).join('').trimEnd()}…` : line
}

/** The headline the card shows now: the owner's own once they edited it, otherwise the first line of the caption. */
export const cardHeadline = (card: Pick<QuickCard, 'headline' | 'headlineEdited'>, caption: string): string => (card.headlineEdited ? card.headline : headlineFromCaption(caption))

// ───────────────────────────── naming a quick post ─────────────────────────────

const LABEL_WORDS = 8

/** The first words of a caption: the name of a quick post wherever a title would be shown (it has none). */
export function captionLabel(text: string, words = LABEL_WORDS): string {
  const parts = text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w !== '')
  if (parts.length === 0) return ''
  return parts.length > words ? `${parts.slice(0, words).join(' ')}…` : parts.join(' ')
}

/** The name of a post for a list or a heading: by its type, never by guessing from an empty title. */
export function postLabel(draft: { postType: PostType; title: string | null; text: string }): string {
  if (draft.postType === 'quick') return captionLabel(draft.text)
  return draft.title?.trim() || captionLabel(draft.text, 12)
}
