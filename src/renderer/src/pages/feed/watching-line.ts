// What the Feed, a channel's status card and an Overview tile say about WATCHING a channel (DEC-040): how often it is looked at, when it was
// last looked at and when it is next, or, honestly, why it is not being watched (automation paused, the channel paused, it needs the owner,
// its last check failed, the app does not read it, it is not set up). Pure, so it is tested from src/main/feed-logic.test.ts; it imports
// only src/shared types. The words never say more than the channel's own fields do: a time is shown only when the channel has it.

import { localDay } from '../../../../shared/local-day'
import { FAILURE_DETAIL_PREFIX, type Channel, type IsoTime } from '../../../../shared/types'

// ───────────── What the line is made of ─────────────

/** Why a channel is or is not watched: `watching`, or the one reason it is not. */
export type WatchingKind = 'watching' | 'automation_paused' | 'channel_paused' | 'needs_you' | 'error' | 'not_read' | 'setup'

/** The fields of a channel the line reads. A `Channel` is one; so is a literal in a test. */
export type WatchedChannel = Pick<Channel, 'status' | 'statusDetail' | 'reads' | 'lastRunAt' | 'nextCheckAt'> & { settings: Pick<Channel['settings'], 'checkIntervalMin'> }

export interface WatchingContext {
  /** The moment the line is for: a time before it is in the past, a time after it is still to come. */
  now: Date
  /** The owner paused all automation: nothing is looked at, whatever the channels say. */
  automationPaused: boolean
  /** The viewer's offset from UTC in minutes (east positive) at a moment; the browser's own zone when absent. A function, so a clock change in between is read right. */
  offsetAt?: (atMs: number) => number
}

export interface WatchingLine {
  kind: WatchingKind
  /** The app looks at the channel on a schedule. */
  watching: boolean
  /** The whole line: "Watching every ~3 h · last 14:05 · next ≈17:12", or the reason it is not watched. */
  text: string
  /** The how-often alone ("Every ~3 h") where the last and the next check have rows of their own; the reason (same as `text`) where there is no schedule. */
  schedule: string
}

const browserOffsetAt = (atMs: number): number => -new Date(atMs).getTimezoneOffset()

// ───────────── Words ─────────────

/**
 * How often, in the fewest words: whole hours as "every ~3 h", a whole day as "once a day", anything else in minutes ("every ~45 min").
 * The "~" is honest: each check starts a little earlier or later than the interval, so channels never start together. Null for a number
 * that is no interval.
 */
export function intervalWords(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 1) return null
  const whole = Math.round(minutes)
  if (whole === 1440) return 'once a day'
  return whole % 60 === 0 ? `every ~${whole / 60} h` : `every ~${whole} min`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000
const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * A moment as the owner reads a clock: 24 hour `HH:MM` in their own zone; with the weekday ("Thu 14:05") when it is another day of the
 * last or next six, else with the date ("Nov 22, 14:05", the year too when it is not this one). An unreadable moment is an empty string.
 */
export function clockTime(at: IsoTime, ctx: Pick<WatchingContext, 'now' | 'offsetAt'>): string {
  const atMs = Date.parse(at)
  if (Number.isNaN(atMs)) return ''
  const offsetAt = ctx.offsetAt ?? browserOffsetAt
  const nowMs = ctx.now.getTime()
  const shifted = new Date(atMs + offsetAt(atMs) * 60_000)
  const clock = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  const days = Math.round((Date.parse(`${localDay(atMs, offsetAt(atMs))}T00:00:00.000Z`) - Date.parse(`${localDay(nowMs, offsetAt(nowMs))}T00:00:00.000Z`)) / DAY_MS)
  if (days === 0) return clock
  if (Math.abs(days) <= 6) return `${WEEKDAYS[shifted.getUTCDay()]} ${clock}`
  const sameYear = shifted.getUTCFullYear() === new Date(nowMs + offsetAt(nowMs) * 60_000).getUTCFullYear()
  return `${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}${sameYear ? '' : ` ${shifted.getUTCFullYear()}`}, ${clock}`
}

/** The moment of the next check when it is still to come: null when there is none, it cannot be read, or it is due now or overdue. */
function upcoming(next: IsoTime | null, ctx: WatchingContext): number | null {
  if (next === null) return null
  const ms = Date.parse(next)
  return Number.isNaN(ms) || ms <= ctx.now.getTime() ? null : ms
}

/** "≈17:12" for a next check that is still to come, "soon" for one that is due, overdue or not known yet. */
function nextWords(next: IsoTime | null, ctx: WatchingContext): string {
  const ms = upcoming(next, ctx)
  return ms === null ? 'soon' : `≈${clockTime(new Date(ms).toISOString(), ctx)}`
}

/** "14:05" for a run that happened, "never" for a channel that was not looked at yet. */
function lastWords(last: IsoTime | null, ctx: WatchingContext): string {
  if (last === null) return 'never'
  return clockTime(last, ctx) || 'never'
}

// ───────────── One channel ─────────────

export const NOT_READ_LINE = 'The app does not read this channel'

/**
 * The reason a check failed, without the words the line says itself. The scheduler writes "Last check failed (3 times in a row): Reading the
 * channel failed: HTTP 503. Retrying in 20 min."; the line adds its own "Last check failed" and the time it retries, so only
 * "Reading the channel failed: HTTP 503" is kept. A text that does not follow that shape is kept as it is.
 */
export function failureReason(detail: string): string {
  let text = detail.trim()
  if (text.startsWith(FAILURE_DETAIL_PREFIX)) text = text.slice(FAILURE_DETAIL_PREFIX.length).replace(/^\s*(\([^)]*\))?\s*:?\s*/, '')
  return text.replace(/\s*Retrying in [^.]*\.?\s*$/, '').replace(/[.\s]+$/, '')
}

/** A channel whose last check failed and is being retried: it says so in its status text, whether or not its status is `error` (a timeout leaves it `active`). */
const failing = (channel: WatchedChannel, detail: string): boolean => channel.status === 'error' || (channel.status === 'active' && detail.startsWith(FAILURE_DETAIL_PREFIX))

function stopped(kind: Exclude<WatchingKind, 'watching'>, text: string): WatchingLine {
  return { kind, watching: false, text, schedule: text }
}

/**
 * The line of one channel. A channel the app does not read, or one not set up, is not watched whatever else is true; then automation
 * paused, which stops every channel; then the channel's own state: paused, needing the owner (its own words), or failing (still retried, at
 * the time it has). Only an active channel on a running schedule says "Watching", with how often, when it was last looked at and when it is next.
 */
export function watchingLine(channel: WatchedChannel, ctx: WatchingContext): WatchingLine {
  if (!channel.reads) return stopped('not_read', NOT_READ_LINE)
  if (channel.status === 'setup') return stopped('setup', 'Not watching yet: the channel is still being set up')
  if (ctx.automationPaused) return stopped('automation_paused', 'Not watching: automation is paused')
  const detail = channel.statusDetail.trim()
  if (failing(channel, detail)) {
    const reason = failureReason(detail)
    return stopped('error', `Last check failed${reason ? ` · ${reason}` : ''} · retrying ${nextWords(channel.nextCheckAt, ctx)}`)
  }
  switch (channel.status) {
    case 'paused':
      return stopped('channel_paused', 'Not watching: this channel is paused')
    case 'needs_user':
      return stopped('needs_you', `Not watching: needs you${detail ? ` · ${detail}` : ''}`)
    case 'error':
    case 'active':
      break
  }
  const every = intervalWords(channel.settings.checkIntervalMin)
  const rest = `last ${lastWords(channel.lastRunAt, ctx)} · next ${nextWords(channel.nextCheckAt, ctx)}`
  return {
    kind: 'watching',
    watching: true,
    text: every ? `Watching ${every} · ${rest}` : `Watching · ${rest}`,
    schedule: every ? `${every.charAt(0).toUpperCase()}${every.slice(1)}` : 'On a schedule'
  }
}

// ───────────── The product ─────────────

export interface WatchingSummary {
  /** At least one channel is being watched. */
  watching: boolean
  text: string
}

/** What is said of channels that are not watched, in the order of the words. */
const NOT_WATCHED_PARTS: readonly { kind: WatchingKind; words: (n: number) => string }[] = [
  { kind: 'channel_paused', words: (n) => `${n} paused` },
  { kind: 'needs_you', words: (n) => `${n} ${n === 1 ? 'needs' : 'need'} you` },
  { kind: 'error', words: (n) => `${n} failing` },
  { kind: 'setup', words: (n) => `${n} being set up` }
]

/**
 * One compact line for a product: with one channel the app reads, that channel's own line; with several, how many are watched and the
 * soonest next check among them ("Watching 3 channels · next ≈17:12", "Watching 2 of 3 channels · next soon"). Paused automation is said
 * as it is; with none watched the line says what stops them. Channels the app does not read are not counted (they are the Feed's "not
 * read" note). Null when the app reads no channel of the product: there is nothing to say.
 */
export function productWatching(channels: readonly WatchedChannel[], ctx: WatchingContext): WatchingSummary | null {
  const readable = channels.filter((channel) => channel.reads)
  if (readable.length === 0) return null
  const lines = readable.map((channel) => watchingLine(channel, ctx))
  if (readable.length === 1) return { watching: lines[0].watching, text: lines[0].text }
  if (lines.some((line) => line.kind === 'automation_paused')) return { watching: false, text: 'Not watching: automation is paused' }
  const watched = readable.filter((_, index) => lines[index].watching)
  if (watched.length === 0) {
    const parts = NOT_WATCHED_PARTS.map((part) => ({ part, n: lines.filter((line) => line.kind === part.kind).length })).filter(({ n }) => n > 0)
    return { watching: false, text: `Not watching any channel: ${parts.map(({ part, n }) => part.words(n)).join(', ')}` }
  }
  const nexts = watched.map((channel) => upcoming(channel.nextCheckAt, ctx))
  // A channel that is due now is the soonest there is.
  const soonest = nexts.includes(null) ? null : Math.min(...(nexts as number[]))
  const count = watched.length === readable.length ? `${watched.length} channels` : `${watched.length} of ${readable.length} channels`
  return { watching: true, text: `Watching ${count} · next ${soonest === null ? 'soon' : `≈${clockTime(new Date(soonest).toISOString(), ctx)}`}` }
}
