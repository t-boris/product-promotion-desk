// How a post is SHOWN for each platform (DEC-030): which sketch to draw, what folds behind "more", how many pictures show and how they sit,
// the count against the limit. Pure, so every rule is tested without the screen. The words themselves come from `renderForPlatform`, the
// function the application sends with, so the sketch and the send can never differ; this file only decides how the words are laid out.

import { characterCount, formOf, platformLabel } from './post-format'

/** The layouts that differ: a thread of text with a title (Reddit), a picture first with a caption (Instagram), a feed post (Facebook, LinkedIn), a short post (Threads, X), a chat message (Telegram). */
export type PreviewKind = 'reddit' | 'instagram' | 'feed' | 'short' | 'chat' | 'plain'

const KINDS: Record<string, PreviewKind> = { reddit: 'reddit', instagram: 'instagram', facebook: 'feed', linkedin: 'feed', threads: 'short', x: 'short', telegram: 'chat' }

export const previewKind = (platform: string): PreviewKind => KINDS[platform] ?? 'plain'

/** The platforms the owner can look at a post as, in the order of the pop-up. */
export const PREVIEW_PLATFORMS: { platform: string; label: string }[] = ['reddit', 'instagram', 'facebook', 'threads', 'x', 'linkedin', 'telegram'].map((platform) => ({ platform, label: platformLabel(platform) }))

/** Where a long caption folds behind "more", for the platforms that fold. About: the platform decides on its own screen. */
const FOLD_AT: Partial<Record<PreviewKind, number>> = { instagram: 125 }

/** The words before the fold and the words behind it. The fold falls on a word, never inside one; a text that fits is not folded. */
export function fold(text: string, kind: PreviewKind): { shown: string; hidden: string } {
  const at = FOLD_AT[kind]
  // Counted and cut by character, so an emoji is never split.
  const chars = Array.from(text)
  if (at === undefined || chars.length <= at) return { shown: text, hidden: '' }
  const cut = chars.lastIndexOf(' ', at)
  const end = cut > at / 2 ? cut : at
  return { shown: chars.slice(0, end).join('').trimEnd(), hidden: chars.slice(end).join('').trimStart() }
}

/** How many pictures the sketch draws, and how many are only counted ("+2"): a feed draws five, a short post four, a chat album all. */
const SHOWN: Record<PreviewKind, number> = { reddit: 20, instagram: 1, feed: 5, short: 4, chat: 10, plain: 4 }
export function visiblePictures(kind: PreviewKind, total: number): { shown: number; more: number } {
  const shown = Math.min(total, SHOWN[kind])
  return { shown, more: total - shown }
}

/** The characters used against the limit, as a line for the owner; `over` when the platform would refuse the text. Null when the platform has no limit. */
export function counterFor(platform: string, text: string): { label: string; over: boolean } | null {
  const limit = formOf(platform).textLimit
  if (limit === null) return null
  const used = characterCount(text)
  return { label: `${used.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}`, over: used > limit }
}

/** The first letter of the name, for the round mark beside it; "?" when there is no name. */
export function initialOf(name: string): string {
  const letter = [...name.replace(/^[^\p{L}\p{N}]+/u, '')][0]
  return letter ? letter.toUpperCase() : '?'
}

/** The line under the author: where the post goes. Reddit shows the community, the others show the account only. */
export function whereLine(kind: PreviewKind, target: string, author: string): string {
  return kind === 'reddit' && target ? `${target} · ${author}` : author
}

/** What the sketch says about itself, once: it is a sketch, and for a platform other than the channel's, whose it is. */
export function sketchNote(platform: string, channelPlatform: string): string {
  return platform === channelPlatform
    ? `A sketch of how ${platformLabel(platform)} lays the post out, made from the words that will be sent.`
    : `How the same post would read on ${platformLabel(platform)}. This channel is on ${platformLabel(channelPlatform)}, so it is sent there as the sketch above shows.`
}
