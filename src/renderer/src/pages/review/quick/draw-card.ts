// Draws the template card (REQ-003, DEC-045): the one function used for the live preview and for the PNG that is saved. It follows a
// `CardLayout` (where each line goes, `card-layout.ts`) and a palette (`card-colours.ts`) and touches the canvas only through the few calls of
// `CardContext`, so it is tested with a recording stand-in and needs no canvas (the real 2D context satisfies the interface as it is).

import type { CardColour } from '../../../../../shared/quick-post'
import { CARD_PALETTES } from './card-colours'
import type { CardLayout } from './card-layout'

/** A gradient the context hands out. */
export interface CardGradient {
  addColorStop(offset: number, colour: string): void
}

/** The part of a 2D canvas context the card is drawn with. */
export interface CardContext {
  fillStyle: unknown
  font: string
  textAlign: string
  textBaseline: string
  globalAlpha: number
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CardGradient
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  beginPath(): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  fill(): void
  save(): void
  restore(): void
}

/** How see-through the soft decorations are (the mark of the quote, the circle of the bold style): they are quiet shapes behind the words. */
const MARK_ALPHA = 0.28
const SHAPE_ALPHA = 0.1

/** The large circle at a corner of a bold card: it gives a flat colour some depth without competing with the headline. */
function drawCircle(ctx: CardContext, layout: CardLayout, ink: string): void {
  const radius = Math.round(layout.width * 0.42)
  ctx.save()
  ctx.globalAlpha = SHAPE_ALPHA
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(layout.width - Math.round(radius * 0.25), Math.round(radius * 0.25), radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Draws the card in its full size: the gradient, the mark of the style, the headline. The caller scales the context for a smaller picture. */
export function drawCard(ctx: CardContext, layout: CardLayout, colour: CardColour): void {
  const palette = CARD_PALETTES[colour]
  const gradient = ctx.createLinearGradient(0, 0, layout.width, layout.height)
  palette.stops.forEach((stop, index) => gradient.addColorStop(index / (palette.stops.length - 1), stop))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, layout.width, layout.height)

  if (layout.style === 'bold') drawCircle(ctx, layout, palette.ink)
  ctx.fillStyle = palette.ink
  ctx.textBaseline = 'middle'

  if (layout.mark) {
    ctx.save()
    ctx.globalAlpha = MARK_ALPHA
    ctx.font = layout.mark.font
    ctx.textAlign = 'center'
    ctx.fillText(layout.mark.text, layout.mark.x, layout.mark.y)
    ctx.restore()
  }
  if (layout.rule) ctx.fillRect(layout.rule.x, layout.rule.y, layout.rule.width, layout.rule.height)

  ctx.font = layout.font
  ctx.textAlign = layout.align
  for (const line of layout.lines) ctx.fillText(line.text, line.x, line.y)
}
