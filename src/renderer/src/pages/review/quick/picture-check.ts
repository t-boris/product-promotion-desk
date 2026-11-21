// What the platforms of a quick post take of its picture, said beside the picture slot (REQ-003, DEC-044). The rules are the one table of
// `shared/post-pictures.ts` that the approval and the send read, so a line here that says "this fits" is the line the approval uses (lesson 209).
// This file only gathers the facts of the picture the composer holds and asks the table once for every channel ticked.

import { platformLabel } from '../../../../../shared/post-format'
import { PICTURE_RULES, pictureProblems, type PictureFacts } from '../../../../../shared/post-pictures'
import { CARD_PIXELS, type CardShape } from '../../../../../shared/quick-post'
import type { MediaItem, MediaShape } from '../../../../../shared/types'

/** The facts of a library picture: its type, bytes and pixels were measured when it was added. */
export const factsOfMedia = (item: Pick<MediaItem, 'mime' | 'bytes' | 'width' | 'height'>): PictureFacts => ({ mime: item.mime, bytes: item.bytes, width: item.width, height: item.height })

/** The facts of the template card: a PNG at the pixels of its shape (the bytes are not known until it is drawn). */
export const factsOfCard = (shape: CardShape): PictureFacts => ({ mime: 'image/png', bytes: null, ...CARD_PIXELS[shape] })

/** What the AI makes at each shape (`media.make` asks for these sizes): the picture a quick post gets from "Make a picture". */
export const MADE_PIXELS: Record<MediaShape, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  wide: { width: 1536, height: 1024 },
  tall: { width: 1024, height: 1280 }
}

/** What every ticked platform refuses about the picture, each said once however many channels share the platform. */
export function pictureCheck(platforms: readonly string[], facts: PictureFacts): string[] {
  const seen = new Set<string>()
  const problems: string[] = []
  for (const platform of new Set(platforms)) {
    for (const problem of pictureProblems(platform, facts)) {
      if (seen.has(problem)) continue
      seen.add(problem)
      problems.push(problem)
    }
  }
  return problems
}

/** A platform whose range of shapes is narrow enough for the owner to need telling (4:5 to 1.91:1 is; 1:10 to 10:1 is not). */
const NARROW_RATIO = 4

/**
 * The plain-words hint under "Make a picture" and "Choose a file": the shapes a ticked platform takes. Null when none of the ticked platforms
 * limits the shape much, so the owner is told only what matters.
 */
export function shapeHint(platforms: readonly string[]): string | null {
  const lines: string[] = []
  for (const platform of new Set(platforms)) {
    const ratio = PICTURE_RULES[platform]?.ratio
    if (ratio && ratio.max / ratio.min < NARROW_RATIO) lines.push(`${platformLabel(platform)} only takes pictures from ${ratio.tall} (tall) to ${ratio.wide} (wide); anything else is cropped.`)
  }
  return lines.length === 0 ? null : `${lines.join(' ')} The Square, Wide and Tall pictures made here all fit.`
}
