// What each platform takes of a picture that goes with a quick post (REQ-006, DEC-044): which types, how big, which shapes. One pure table
// that the approval, the gate, the group view and the quick-post composer all read, so a line that says "this fits" is the one the approval
// uses (lesson 209). It judges the facts of the picture (type, bytes, pixels), never its pixels.
//
// Where the numbers come from, and how sure they are: the caption limits are in `post-format.ts` (PLATFORM_FORMS). Here, Instagram's range of
// shapes (4:5 to 1.91:1) is what every size guide gives for a feed photo, and a picture outside it is cropped by Instagram's own post form, so
// what is published would not be what the owner approved; Threads' types, size and ratio are Meta's published ones for the Threads API (JPEG and
// PNG, 8 MB, 10:1); Facebook's types are the ones its guides list (JPEG, PNG, GIF). They were NOT tried against the real post forms (live
// acceptance, issue #8): a rule here that a real form turns out not to need is one line of this table.

import { platformLabel } from './post-format'

/** What is known of a picture without looking at its pixels: from the library row (type, bytes, pixels) or from the attachment (type only). */
export interface PictureFacts {
  /** The MIME type; empty when it is not known (the picture is then not judged by its type). */
  mime: string
  bytes: number | null
  width: number | null
  height: number | null
}

export interface PictureRules {
  /** The types the platform's form takes, by MIME. */
  types: readonly string[]
  /** The most bytes one picture may have, or null when the platform sets none that this application knows of beyond its own 10 MB. */
  maxBytes: number | null
  /** Width over height: the shapes the platform takes without cropping or refusing, or null for any. */
  ratio: { min: number; max: number; tall: string; wide: string } | null
}

const MB = 1024 * 1024

/**
 * How much a ratio may miss its limit and still pass: a picture drawn at 1080 × 566 is 1.908:1, one cut at 1080 × 565 is 1.9115:1, and the
 * platform itself rounds. Half a percent is a pixel or two at the sizes the composer makes.
 */
export const RATIO_SLACK = 0.005

export const PICTURE_RULES: Record<string, PictureRules> = {
  // A feed photo is 4:5 (tall) to 1.91:1 (wide); anything else is cropped by the post form. The two ends of it are what the card shapes are drawn at.
  instagram: { types: ['image/png', 'image/jpeg'], maxBytes: 8 * MB, ratio: { min: 4 / 5, max: 1.91, tall: '4:5', wide: '1.91:1' } },
  threads: { types: ['image/png', 'image/jpeg'], maxBytes: 8 * MB, ratio: { min: 1 / 10, max: 10, tall: '1:10', wide: '10:1' } },
  facebook: { types: ['image/png', 'image/jpeg', 'image/gif'], maxBytes: null, ratio: null }
}

const TYPE_NAMES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/gif': 'GIF', 'image/webp': 'WebP' }
const typeName = (mime: string): string => TYPE_NAMES[mime] ?? mime

const list = (items: string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`)

const megabytes = (bytes: number): string => `${Math.round((bytes / MB) * 10) / 10} MB`

/** What a platform refuses about one picture, in the owner's words; empty when it takes it, or when nothing is known that it refuses. */
export function pictureProblems(platform: string, picture: PictureFacts): string[] {
  const rules = PICTURE_RULES[platform]
  if (!rules) return []
  const label = platformLabel(platform)
  const problems: string[] = []
  if (picture.mime !== '' && !rules.types.includes(picture.mime)) {
    problems.push(`${label} takes ${list(rules.types.map(typeName))} pictures; this one is ${typeName(picture.mime)}. Use one of those.`)
  }
  if (rules.maxBytes !== null && picture.bytes !== null && picture.bytes > rules.maxBytes) {
    problems.push(`The picture is ${megabytes(picture.bytes)}; ${label} takes up to ${megabytes(rules.maxBytes)}. Use a smaller one.`)
  }
  // A header that says 0 × 0 (or nothing) is not a shape: such a picture is not judged by it.
  const { width, height } = picture
  if (rules.ratio && width !== null && height !== null && width > 0 && height > 0) {
    const ratio = width / height
    if (ratio < rules.ratio.min * (1 - RATIO_SLACK)) {
      problems.push(`The picture is ${width} × ${height} pixels, taller than ${label} takes (down to ${rules.ratio.tall}), which would crop it. Use a picture inside that shape.`)
    } else if (ratio > rules.ratio.max * (1 + RATIO_SLACK)) {
      problems.push(`The picture is ${width} × ${height} pixels, wider than ${label} takes (up to ${rules.ratio.wide}), which would crop it. Use a picture inside that shape.`)
    }
  }
  return problems
}

/**
 * The line the composer shows next to the picture slot: what the platform takes, from the same table the approval reads. Null for a platform
 * with nothing to say (the picture is judged only by the application's own limits there).
 */
export function pictureRulesText(platform: string): string | null {
  const rules = PICTURE_RULES[platform]
  if (!rules) return null
  const parts = [`${list(rules.types.map(typeName))} pictures`]
  if (rules.maxBytes !== null) parts.push(`up to ${megabytes(rules.maxBytes)}`)
  if (rules.ratio) parts.push(`from ${rules.ratio.tall} (tall) to ${rules.ratio.wide} (wide)`)
  return `${platformLabel(platform)} takes ${parts.join(', ')}.`
}
