// The card on a real canvas (REQ-003, DEC-045): measuring text with the canvas, drawing the card at a size, and the PNG that is saved. The only
// file of the composer that touches the DOM; what is drawn and where is decided by `card-layout.ts` and `draw-card.ts`, so the small live
// picture and the saved one are the same drawing at two scales.

import { CARD_PIXELS, type QuickCard } from '../../../../../shared/quick-post'
import { fileToBase64 } from '../useMedia'
import { layoutCard, type Measure } from './card-layout'
import { drawCard } from './draw-card'

let scratch: CanvasRenderingContext2D | null | undefined

/** The width of a text in a font, as the canvas sets it. Without a canvas (it never happens in the window) a letter is as wide as its height. */
const measure: Measure = (text, font) => {
  if (scratch === undefined) scratch = document.createElement('canvas').getContext('2d')
  if (!scratch) return text.length * 20
  scratch.font = font
  return scratch.measureText(text).width
}

/** The card drawn on a new canvas `width` pixels wide (its full size is `CARD_PIXELS`); `card.headline` is the headline as it is drawn. */
function paint(card: QuickCard, width: number): HTMLCanvasElement {
  const full = CARD_PIXELS[card.shape]
  const scale = width / full.width
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(full.width * scale)
  canvas.height = Math.round(full.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The card could not be drawn: this window has no canvas.')
  ctx.scale(scale, scale)
  drawCard(ctx, layoutCard(card.headline, card.style, card.shape, measure), card.colour)
  return canvas
}

/** The card as a small picture the page may show (a data address: nothing else is allowed as a picture). */
export const cardDataUrl = (card: QuickCard, width: number): string => paint(card, width).toDataURL('image/png')

/** The card at its full size as a PNG, ready to be stored in the library. */
export async function renderCardPng(card: QuickCard, name: string): Promise<{ base64: string; name: string }> {
  const canvas = paint(card, CARD_PIXELS[card.shape].width)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The card could not be turned into a picture. Try again.')
  return { base64: await fileToBase64(new File([blob], name, { type: 'image/png' })), name }
}
