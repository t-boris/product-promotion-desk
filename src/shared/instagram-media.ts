// Instagram API publishing options (DEC-097): Stories (`media_type=STORIES`), custom picture `alt_text`,
// and picture `user_tags` (`[{ username, x, y }]`). Shared between the core (validation, approval hashing,
// connector publishing) and the screen (editor fields, live preview notes) so both enforce the exact same rules.

import { isVideoMime, type Attachment } from './types'

/** A form Instagram offers besides the usual feed post / reel / carousel. */
export type InstagramPostForm = 'story'

/** One tagged Instagram account on a picture: username (without `@`) and normalized coordinates in `[0, 1]`. */
export interface InstagramUserTag {
  username: string
  x: number
  y: number
}

export const ALT_TEXT_MAX = 1_000
export const USER_TAGS_MAX = 20
export const STORY_HINT = 'A Story disappears after 24 hours and is published without a caption, alt text or people tags.'

const HANDLE_PATTERN = /^[A-Za-z0-9._]{1,30}$/

const countPictures = (attachments: readonly Pick<Attachment, 'mime'>[]): number => attachments.filter((a) => !isVideoMime(a.mime)).length

/** Trims surrounding whitespace; empty becomes null. */
export const normalizeAltText = (value: string | null | undefined): string | null => {
  const clean = (value ?? '').trim()
  return clean === '' ? null : clean
}

/** Why the alt text is refused, or null when it fits. */
export function altTextProblem(value: string | null | undefined): string | null {
  const clean = normalizeAltText(value)
  if (!clean) return null
  const length = [...clean].length
  return length > ALT_TEXT_MAX ? `Alt text is ${length} characters; Instagram allows ${ALT_TEXT_MAX}.` : null
}

/** Strips surrounding whitespace and any leading `@` signs from an Instagram handle. */
export const cleanInstagramHandle = (raw: string): string => raw.trim().replace(/^@+/, '')

/** Rounds a coordinate to 4 decimal places so approval hashes and persisted JSON stay deterministic. */
const roundCoord = (value: number): number => Math.round(value * 10_000) / 10_000

/**
 * Validates and normalizes a list of Instagram people tags (`user_tags`). Deduplicates by lowercase username.
 * Coordinates default to `0.5` (center) when omitted and must lie in `[0, 1]`.
 */
export function parseInstagramUserTags(raw: unknown): { tags: InstagramUserTag[]; error: string | null } {
  if (raw === null || raw === undefined) return { tags: [], error: null }
  if (!Array.isArray(raw)) return { tags: [], error: 'People tags must be a list of Instagram accounts.' }
  if (raw.length > USER_TAGS_MAX) return { tags: [], error: `Instagram allows at most ${USER_TAGS_MAX} tagged people on a picture.` }
  const seen = new Set<string>()
  const tags: InstagramUserTag[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { tags: [], error: 'Each tagged person must have an Instagram username.' }
    const candidate = item as { username?: unknown; x?: unknown; y?: unknown }
    if (typeof candidate.username !== 'string') return { tags: [], error: 'Each tagged person must have an Instagram username.' }
    const username = cleanInstagramHandle(candidate.username)
    if (!HANDLE_PATTERN.test(username)) {
      return { tags: [], error: `“${candidate.username}” is not a valid Instagram username (letters, numbers, dots and underscores, up to 30 characters).` }
    }
    const xRaw = candidate.x === undefined ? 0.5 : Number(candidate.x)
    const yRaw = candidate.y === undefined ? 0.5 : Number(candidate.y)
    if (!Number.isFinite(xRaw) || xRaw < 0 || xRaw > 1 || !Number.isFinite(yRaw) || yRaw < 0 || yRaw > 1) {
      return { tags: [], error: `Tag position for @${username} must be between 0 and 1 (0% to 100%).` }
    }
    const key = username.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push({ username, x: roundCoord(xRaw), y: roundCoord(yRaw) })
  }
  return { tags, error: null }
}

/** Why the draft's attachments cannot be published as an Instagram Story, or null when they fit. */
export function storyProblem(attachments: readonly Pick<Attachment, 'mime'>[]): string | null {
  if (attachments.length === 0) return 'An Instagram Story needs one picture or one video.'
  if (attachments.length > 1) return 'An Instagram Story is one picture or one video, not several.'
  return null
}

export interface InstagramMediaOptions {
  postForm?: InstagramPostForm | null
  altText?: string | null
  userTags?: readonly InstagramUserTag[]
  attachments: readonly Pick<Attachment, 'mime'>[]
}

/** True when any Instagram-specific API publishing option is set on the draft. */
export function hasInstagramMediaOptions(options: Pick<InstagramMediaOptions, 'postForm' | 'altText' | 'userTags'>): boolean {
  return options.postForm === 'story' || normalizeAltText(options.altText) !== null || (options.userTags?.length ?? 0) > 0
}

/**
 * Why the Instagram publishing options on this draft cannot go out as they stand. Empty when everything fits.
 * Checked when saving a draft, before approving, and before uploading in the Instagram API connector.
 */
export function instagramMediaFitProblems(options: InstagramMediaOptions): string[] {
  const problems: string[] = []
  const alt = normalizeAltText(options.altText)
  const tags = options.userTags ?? []
  if (options.postForm === 'story') {
    const story = storyProblem(options.attachments)
    if (story) problems.push(`${story} Leave one attachment on the post, or choose “Feed post”.`)
    if (alt) problems.push('An Instagram Story cannot carry alt text: clear the alt text or choose “Feed post”.')
    if (tags.length > 0) problems.push('An Instagram Story cannot carry people tags through the API: remove the tags or choose “Feed post”.')
    return problems
  }
  const pictures = countPictures(options.attachments)
  const altErr = altTextProblem(alt)
  if (altErr) problems.push(altErr)
  if (alt && pictures === 0) problems.push('Alt text applies to a picture post: add a picture or clear the alt text.')
  if (tags.length > USER_TAGS_MAX) problems.push(`Instagram allows at most ${USER_TAGS_MAX} tagged people on a picture.`)
  if (tags.length > 0 && pictures === 0) problems.push('People tags apply to a picture post: add a picture or remove the tags.')
  return problems
}

/** Plain notes shown in the post preview so the owner sees what Instagram will receive. */
export function instagramMediaNotes(options: InstagramMediaOptions, text: string): string[] {
  const notes: string[] = []
  if (options.postForm === 'story') {
    if (storyProblem(options.attachments) === null) {
      notes.push('Published as a 24-hour Instagram Story.')
      if (text.trim() !== '') notes.push('Instagram Stories do not show captions: the text will not be sent.')
    }
    return notes
  }
  const pictures = countPictures(options.attachments)
  if (pictures > 0) {
    if (normalizeAltText(options.altText)) notes.push('Includes custom alt text for the picture.')
    if ((options.userTags?.length ?? 0) > 0) {
      notes.push(`Tagging ${(options.userTags ?? []).map((t) => `@${t.username}`).join(', ')} on the picture.`)
    }
  }
  return notes
}
