// The AI in the quick-post composer (REQ-004, DEC-039, DEC-040, DEC-042, DEC-043): four helps, each one the owner's own press, none of them
// ever changing the post by itself. The contract every layer agrees on: what a help is asked, what it answers and which words it may use.
//
//   quick.caption  writes or improves the caption, for the platform's own form (its limit, plain text, hashtags, no link where the platform has no field).
//   quick.picture  proposes what the picture is: a card's headline, style and colour, or the description of an illustration.
//   quick.trends   searches the platform for what is talked about now, in the account's AI browser (read-only), and proposes an angle.
//   quick.assess   the marketer: judges the caption and the picture against the product's promotion goal, taken from the approved knowledge.
//
// All of them stand on the approved product knowledge (facts only from it, nothing prohibited, no price or promotion without a claim), and none of
// them stores anything: the owner reads the answer and presses to use it.

import { formOf } from './post-format'
import type { CardColour, CardStyle } from './quick-post'
import type { Id } from './types'

// ───────────────────────────── limits ─────────────────────────────

/** The longest caption the AI writes, whatever the platform would take: a quick post is a few lines, and Facebook's own limit is 63 thousand characters. */
export const QUICK_CAPTION_CEILING = 2_200
/** What the owner may type to steer a help ("shorter", "more playful"): one line, never cut (a cut wish can lose its restriction). */
export const QUICK_WISH_MAX = 300
/** What the owner may type to steer the search ("astrology memes"). */
export const QUICK_SEARCH_WISH_MAX = 120
/** The longest angle: one or two sentences. */
export const QUICK_ANGLE_MAX = 300
/** The most points and the most suggestions the marketer gives. */
export const QUICK_POINTS_MAX = 5
export const QUICK_SUGGESTIONS_MAX = 2
/** The longest illustration description (the same limit the picture library keeps). */
export const QUICK_ILLUSTRATION_MAX = 600

/** The most characters the AI's caption may hold on this platform: the platform's own limit, and never more than the ceiling. */
export function captionLimit(platform: string): number {
  const limit = formOf(platform).textLimit
  return limit === null ? QUICK_CAPTION_CEILING : Math.min(limit, QUICK_CAPTION_CEILING)
}

/**
 * The platform whose form is the tightest of those chosen: when one caption goes to several channels, the AI writes for the one that takes the least,
 * so the caption fits all of them. The first of equals; null for an empty list.
 */
export function strictestPlatform(platforms: readonly string[]): string | null {
  let best: string | null = null
  for (const platform of platforms) if (best === null || captionLimit(platform) < captionLimit(best)) best = platform
  return best
}

// ───────────────────────────── the caption ─────────────────────────────

export interface QuickCaptionArgs {
  productId: Id
  /** The channel the post goes to, for its style, languages and the role of its login; without it the platform's form alone steers the AI. */
  channelId?: Id | null
  platform: string
  /** What the caption field holds now; empty means the AI writes from nothing, filled means it improves what is there. */
  caption: string
  /** What to change, in the owner's words ("shorter", "friendlier"). */
  wish?: string
  /** The angle the owner chose from the trends (data, never an order). */
  angle?: string | null
  /** The card's headline, when the picture is a card: the caption goes with it and does not repeat it. */
  headline?: string | null
}

export interface QuickCaptionResult {
  caption: string
}

// ───────────────────────────── the picture ─────────────────────────────

/** What the AI proposes for: the card's headline, style and colour, or the description of an illustration. */
export type QuickPictureKind = 'card' | 'illustration'

export interface QuickPictureArgs {
  productId: Id
  channelId?: Id | null
  platform: string
  kind: QuickPictureKind
  /** The caption the picture goes with. */
  caption: string
  /** The card's headline now (improved when it is filled). */
  headline?: string | null
  wish?: string
  angle?: string | null
}

export type QuickPictureResult =
  | { kind: 'card'; headline: string; style: CardStyle; colour: CardColour; why: string }
  | { kind: 'illustration'; description: string; why: string }

// ───────────────────────────── the search for trends ─────────────────────────────

/**
 * What the AI looks for in the browser (DEC-045): `trends` is what people talk about around a subject (the site's own search; the default), `now` is what is
 * happening in the place at this moment (its newest posts), `feed` is an analysis of the place's feed: what kinds of posts get a response and what falls flat.
 */
export type QuickLookMode = 'trends' | 'now' | 'feed'
export const QUICK_LOOK_MODES: readonly QuickLookMode[] = ['trends', 'now', 'feed']

export interface QuickTrendsArgs {
  productId: Id
  /** The channel whose account's browser does the search; the platform, the site and the account come from it. Any channel, not only a picture post's. */
  channelId: Id
  /** What to look for, in the owner's words; without it the search is for the channel's own topics and queries. */
  wish?: string
  /** What kind of look; `trends` when absent. */
  mode?: QuickLookMode
}

/** One thing the search found people are talking about. `url` is a page of the platform that shows it, when there is one. */
export interface QuickTopic {
  topic: string
  what: string
  url: string | null
}

/** The way in to a post the search proposes: one or two sentences, and why. It steers the next AI helps only when the owner presses Use. */
export interface QuickAngle {
  text: string
  why: string
}

/**
 * `ready`: the search ran and found topics; `angle` is null when the AI could not form one from them (the owner reads the topics and writes their own).
 * Every other state is a message in words, and the owner can write the caption and make the picture all the same:
 * `unavailable` (the search could not start: no account's browser, an engine that cannot work the browser, a browser in use),
 * `needs_owner` (a sign-in or a check stopped it), `failed` (it found nothing, or broke), `stopped` (the owner stopped it).
 */
export type QuickTrendsResult =
  | { state: 'ready'; topics: QuickTopic[]; angle: QuickAngle | null; searched: string[]; note: string | null }
  | { state: 'unavailable' | 'needs_owner' | 'failed' | 'stopped'; message: string }

/** What the progress panel of the search is told to show (the runs of the engine carry it as their subject). */
export const quickTrendsSubject = (channelId: Id): string => `quick-trends:${channelId}`

// ───────────────────────────── the marketer ─────────────────────────────

/** The picture as the marketer is told of it: the card's words and look, an illustration's description, or only that a file was chosen. The marketer cannot see pixels. */
export type QuickPictureFacts =
  | { kind: 'card'; headline: string; style: CardStyle; colour: CardColour }
  | { kind: 'illustration'; description: string }
  | { kind: 'file' }
  | { kind: 'none' }

export interface QuickAssessArgs {
  productId: Id
  channelId?: Id | null
  platform: string
  caption: string
  picture: QuickPictureFacts
  angle?: string | null
}

/** How the post stands against the promotion goal: `unclear` when the approved knowledge does not say what the promotion is for. */
export type QuickVerdict = 'on_goal' | 'partly' | 'off_goal' | 'unclear'

export interface QuickPoint {
  about: 'caption' | 'picture' | 'both'
  /** True for something that works, false for something to fix. */
  good: boolean
  text: string
}

/** Something the owner may apply with one press; nothing is applied by the assessment itself. */
export type QuickSuggestion = { kind: 'caption'; caption: string; why: string } | { kind: 'headline'; headline: string; why: string }

export interface QuickAssessment {
  verdict: QuickVerdict
  /** One or two sentences. */
  summary: string
  /** The promotion goal the assessment used, in words, taken from the approved knowledge (DEC-043); null when the knowledge does not say. */
  goal: string | null
  /** The approved facts the goal rests on, as the passport words them: the owner can check where it came from. */
  goalBasis: string[]
  points: QuickPoint[]
  suggestions: QuickSuggestion[]
}
