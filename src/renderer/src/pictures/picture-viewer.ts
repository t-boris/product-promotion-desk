// What the picture viewer works out without the screen: where a picture comes from and how it is saved, the line that names it, the walk through a group of
// pictures, the focus that stays inside the viewer. Pure, so it is tested from src/main.

import type { FindingPicture } from '../../../shared/types'

/** Where a picture is kept, so the viewer can ask for a large copy of it and for the original to save. */
export type PictureSource =
  | { kind: 'media'; id: string }
  | { kind: 'finding'; id: string }
  | { kind: 'profile'; id: string }
  /** A picture drawn on the screen (a page capture, the card of a quick post): the data address itself. */
  | { kind: 'drawn'; dataUrl: string }

/** One picture the viewer can show. */
export interface ViewerPicture {
  /** Tells the pictures of a group apart (a stored id, or the name of a drawn one). */
  key: string
  source: PictureSource
  /** What the line of the viewer calls it. For a drawn picture it is also the name the Save dialog proposes. */
  name: string
  alt: string
  /** The size of the original when it is known; otherwise the viewer measures the copy it shows. */
  width?: number | null
  height?: number | null
  /** A small copy the screen already holds: shown when the large one cannot be made. */
  preview?: string
}

/** What the card of a quick post is called where it is shown large and saved: it is drawn on the screen and has no name of its own. */
export const CARD_PICTURE_NAME = 'Post card'

/** The longest side, in pixels, of the large copy the viewer asks for. */
export const VIEWER_SIDE = 2048

export const mediaPicture = (item: { id: string; name: string; description?: string; width?: number | null; height?: number | null }, preview?: string): ViewerPicture => ({
  key: item.id,
  source: { kind: 'media', id: item.id },
  name: item.name,
  alt: item.description || item.name,
  width: item.width ?? null,
  height: item.height ?? null,
  preview
})

/** A picture of a post, named by its place among the post's pictures ("post-picture-2"): the same name the Save dialog proposes. */
export const postPicture = (picture: Pick<FindingPicture, 'id' | 'alt' | 'width' | 'height'>, place: number, preview?: string): ViewerPicture => ({
  key: picture.id,
  source: { kind: 'finding', id: picture.id },
  name: `post-picture-${place}`,
  alt: picture.alt || 'A picture of the post',
  width: picture.width,
  height: picture.height,
  preview
})

export const profilePicture = (profileId: string, dataUrl: string): ViewerPicture => ({ key: `profile-${profileId}`, source: { kind: 'profile', id: profileId }, name: 'Profile picture', alt: 'Profile', preview: dataUrl })

export const drawnPicture = (dataUrl: string, name: string, alt: string): ViewerPicture => ({ key: name, source: { kind: 'drawn', dataUrl }, name, alt, preview: dataUrl })

/** How much larger than its own size a picture is shown when the window has room: a small picture is enlarged to be seen, but not so far that it is only blocks of colour. */
export const MAX_ENLARGE = 4

/**
 * The size a picture is shown at: as large as the room allows without cropping it and keeping its proportions, at most `MAX_ENLARGE` times its own size. A picture
 * that is larger than the room is made smaller to fit. The sizes are whole pixels; no room or no picture gives nothing to show.
 */
export function fitSize(natural: { width: number; height: number }, room: { width: number; height: number }, maxEnlarge = MAX_ENLARGE): { width: number; height: number } | null {
  if (natural.width <= 0 || natural.height <= 0 || room.width <= 0 || room.height <= 0) return null
  const scale = Math.min(room.width / natural.width, room.height / natural.height, maxEnlarge)
  return { width: Math.max(1, Math.floor(natural.width * scale)), height: Math.max(1, Math.floor(natural.height * scale)) }
}

/** "1080 × 1350", or an empty text while the size is not known. */
export function sizeLabel(width: number | null | undefined, height: number | null | undefined): string {
  return width && height ? `${width} × ${height}` : ''
}

/** The line at the top of the viewer: the name, and the size when it is known ("post-picture-2 · 1080 × 1350"). */
export function infoLine(picture: Pick<ViewerPicture, 'name' | 'width' | 'height'>, measured: { width: number; height: number } | null): string {
  const size = sizeLabel(picture.width ?? measured?.width, picture.height ?? measured?.height)
  return size ? `${picture.name} · ${size}` : picture.name
}

/** "2 of 5" for a picture of a group, and nothing for a picture that stands alone. */
export function groupLabel(index: number, length: number): string | null {
  return length > 1 ? `${index + 1} of ${length}` : null
}

/** Whether a step of `delta` stays inside the group: the walk stops at the first and the last picture, it does not go round. */
export function canStep(index: number, delta: number, length: number): boolean {
  const next = index + delta
  return next >= 0 && next < length
}

/** The index after a step; the same index when the step would leave the group. */
export function stepIndex(index: number, delta: number, length: number): number {
  return canStep(index, delta, length) ? index + delta : index
}

/** The index to open a group at: the picture with `key`, or the first when it is not in the group. */
export function startIndex(pictures: readonly Pick<ViewerPicture, 'key'>[], key: string): number {
  const at = pictures.findIndex((picture) => picture.key === key)
  return at < 0 ? 0 : at
}

/** Which of `count` places inside the viewer takes the focus after Tab (or Shift+Tab) from `current`: it goes round, so the focus never leaves the viewer. `current` is -1 when the focus is outside. */
export function nextFocus(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return backwards ? count - 1 : 0
  return backwards ? (current - 1 + count) % count : (current + 1) % count
}

/** What the viewer says after a download: where the picture was saved. */
export function savedLine(path: string): string {
  return `Saved to ${path}`
}
