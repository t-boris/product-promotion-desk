// The owner's choices about how a product is worked (DEC-071), all off until the owner sets them: a limit on channels in work (a number
// shown, never a block), a week with no time (the content mix prepares only one re-cut of an earlier post per channel), and whether the
// product is software (then the launch venues are listed with the owner's own checklist).

export const MAX_CHANNEL_LIMIT = 50
/** In a week with no time a channel gets one re-cut draft in this many days. */
export const RECUT_EVERY_DAYS = 7

export interface ProductChoices {
  productId: string
  /** How many channels the owner wants in work at once; null: no limit set. */
  channelLimit: number | null
  /** Channels of the product that are active now. */
  inWork: number
  lowTime: boolean
  software: boolean
}

/** "6 in work · your limit is 2 (4 over)" / "2 in work · your limit is 2" / "6 in work" */
export function limitLine(inWork: number, limit: number | null): string {
  const head = `${inWork} in work`
  if (limit === null) return head
  return inWork > limit ? `${head} · your limit is ${limit} (${inWork - limit} over)` : `${head} · your limit is ${limit}`
}

/** A place where software is launched. The application states none of its rules: it gives the venue's own page and keeps the owner's ticks. */
export interface Venue {
  id: string
  name: string
  /** The venue's own page about launching or posting there. */
  url: string
}

export const VENUES: readonly Venue[] = [
  { id: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com/launch' },
  { id: 'showhn', name: 'Hacker News (Show HN)', url: 'https://news.ycombinator.com/showhn.html' },
  { id: 'indiehackers', name: 'Indie Hackers', url: 'https://www.indiehackers.com/' },
  { id: 'betalist', name: 'BetaList', url: 'https://betalist.com/submit' },
  { id: 'alternativeto', name: 'AlternativeTo', url: 'https://alternativeto.net/' }
]

export const VENUE_STEPS = ['rules', 'page', 'day', 'launched'] as const
export type VenueStep = (typeof VENUE_STEPS)[number]
export const VENUE_STEP_LABEL: Record<VenueStep, string> = {
  rules: 'I read the venue’s own rules and how long it makes a newcomer wait',
  page: 'The page, the pictures and the first comment are ready',
  day: 'The day is chosen',
  launched: 'Launched'
}

export interface VenueState {
  venue: string
  done: VenueStep[]
}

export const isVenue = (id: unknown): id is string => VENUES.some((v) => v.id === id)
export const isVenueStep = (step: unknown): step is VenueStep => VENUE_STEPS.includes(step as VenueStep)
