// What the owner chooses on the Settings screen about watching a channel: how often it is checked and how far back its first look goes (DEC-040).
// Pure text and numbers, so the choices are tested from src/main like the rest of the screens' logic.

import { isWatchedInBrowser, type ReadingWays } from '../feed/watching-line'
import { BROWSER_WATCH_QUERIES_HINT } from './own-posts'

export interface Choice {
  /** What the draft holds (a number as text), or CUSTOM_INTERVAL. */
  value: string
  label: string
}

/** How often a channel is checked; every 3 hours is the product's default. A channel with any other interval shows it as Custom. */
export const INTERVAL_PRESETS: readonly Choice[] = [
  { value: '60', label: 'Every hour' },
  { value: '180', label: 'Every 3 hours' },
  { value: '1440', label: 'Once a day' }
]
export const CUSTOM_INTERVAL = 'custom'
export const CUSTOM_INTERVAL_LABEL = 'Custom…'
/** Under every choice of the interval: a check never starts exactly on time, so channels never start together. */
export const INTERVAL_HINT = 'Each check starts a few minutes earlier or later, so channels never start together.'

export const isIntervalPreset = (minutes: string): boolean => INTERVAL_PRESETS.some((preset) => preset.value === minutes.trim())

/**
 * What the interval choice shows: the preset equal to the stored minutes, or Custom. While the owner has chosen Custom it stays Custom, also when the
 * minutes typed happen to equal a preset, or the minutes field would vanish under their fingers.
 */
export function intervalChoice(minutes: string, custom: boolean): string {
  return custom || !isIntervalPreset(minutes) ? CUSTOM_INTERVAL : minutes.trim()
}

/** The options of the interval choice, in the order shown. */
export const intervalChoices = (): Choice[] => [...INTERVAL_PRESETS, { value: CUSTOM_INTERVAL, label: CUSTOM_INTERVAL_LABEL }]

/** How far back the first look goes. 0 is none. */
export const LOOK_BACK_DAYS = [0, 7, 14, 30] as const
export const LOOK_BACK_HINT = 'On the first check, look at the posts of this many days back. After that, only new posts.'
/** Once the first look is made the choice cannot be used again: a channel looks back once. */
export const lookBackDoneHint = (when: string): string => `Done${when ? ` ${when}` : ''}. A channel looks back once, on its first check; after that only new posts are read.`
export const CUSTOM_INTERVAL_HINT = 'From 5 minutes to a week (10080).'

/** Under the search queries: how they are written, and for a channel the AI watches in the browser that they are searched there too (DEC-042). */
export const QUERIES_HINT = 'One per line or separated by commas.'
export const queriesHint = (channel: ReadingWays): string => (isWatchedInBrowser(channel) ? `${QUERIES_HINT} ${BROWSER_WATCH_QUERIES_HINT}` : QUERIES_HINT)

export const lookBackLabel = (days: number): string => (days === 0 ? 'None' : days === 1 ? '1 day' : `${days} days`)

/**
 * The options of the first-look choice: the presets, and the stored value too when it is none of them, so the screen shows what the channel has
 * and saving never changes it by itself. A value that is not a whole number is left out (the form refuses it when saved).
 */
export function lookBackChoices(stored: string): Choice[] {
  const days: number[] = [...LOOK_BACK_DAYS]
  const current = /^\d+$/.test(stored.trim()) ? Number(stored.trim()) : null
  if (current !== null && !days.includes(current)) days.push(current)
  return days.sort((a, b) => a - b).map((n) => ({ value: String(n), label: lookBackLabel(n) }))
}
