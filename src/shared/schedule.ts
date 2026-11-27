// The schedule of posts, as far as it is plain arithmetic: how late a scheduled item may still go out, and the posting times of a channel
// (weekday + time of day, in the Mac's own time zone) with the rule that puts a post on the next free one (DEC-053).

export const DEFAULT_SCHEDULE_GRACE_HOURS = 6
export const MIN_SCHEDULE_GRACE_HOURS = 1
export const MAX_SCHEDULE_GRACE_HOURS = 48

export const isScheduleGraceHours = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= MIN_SCHEDULE_GRACE_HOURS && value <= MAX_SCHEDULE_GRACE_HOURS

/** The lateness limit in milliseconds; a stored value that is not a valid number of hours reads as the default. */
export const scheduleGraceMs = (hours: unknown): number => (isScheduleGraceHours(hours) ? hours : DEFAULT_SCHEDULE_GRACE_HOURS) * 60 * 60 * 1000

/** One posting time of a channel: a day of the week (0 = Sunday, as `Date.getDay`) and a minute of that day (0-1439), in local time. */
export interface PostingSlot {
  weekday: number
  minute: number
}

export const MAX_POSTING_SLOTS = 50
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
/** The order a week is shown in: Monday first. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export const isPostingSlot = (value: unknown): value is PostingSlot => {
  if (typeof value !== 'object' || value === null) return false
  const { weekday, minute } = value as Record<string, unknown>
  return typeof weekday === 'number' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 && typeof minute === 'number' && Number.isInteger(minute) && minute >= 0 && minute < 24 * 60
}

/** The slots without repeats, Monday first and by time within a day: the one order they are stored and shown in. */
export function normalizeSlots(slots: readonly PostingSlot[]): PostingSlot[] {
  const rank = (slot: PostingSlot): number => WEEKDAY_ORDER.indexOf(slot.weekday as (typeof WEEKDAY_ORDER)[number]) * 24 * 60 + slot.minute
  const seen = new Set<number>()
  return [...slots]
    .sort((a, b) => rank(a) - rank(b))
    .filter((slot) => {
      const key = rank(slot)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(({ weekday, minute }) => ({ weekday, minute }))
}

/** "09:30" for a minute of the day. */
export function slotTime(minute: number): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
}

/** The minute of the day for "09:30" (what a time input gives); null when it is not a time. */
export function parseSlotTime(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** Times closer than this to "now" are not offered: the owner still has to approve the item before its time. */
export const SLOT_LEAD_MS = 5 * 60 * 1000
const SEARCH_DAYS = 370

/**
 * The first posting time after `now` that no other item of the channel already holds (`taken`: the planned times of the channel's unsent items).
 * Null when the channel has no posting times, or every one of them within a year is taken.
 */
export function nextFreeSlot(slots: readonly PostingSlot[], taken: readonly string[], now: Date): Date | null {
  const wanted = normalizeSlots(slots.filter(isPostingSlot))
  if (wanted.length === 0) return null
  const held = new Set(taken.map((at) => Date.parse(at)).filter((ms) => !Number.isNaN(ms)))
  const earliest = now.getTime() + SLOT_LEAD_MS
  for (let day = 0; day < SEARCH_DAYS; day++) {
    // Built from the calendar date, so a day with a clock change still gives the wall-clock time the owner chose.
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day)
    const today = wanted.filter((slot) => slot.weekday === date.getDay()).sort((a, b) => a.minute - b.minute)
    for (const slot of today) {
      const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(slot.minute / 60), slot.minute % 60)
      if (at.getTime() >= earliest && !held.has(at.getTime())) return at
    }
  }
  return null
}

/** The lateness limits offered in Settings (hours). A stored value outside the list is shown as one more choice, never lost. */
export const SCHEDULE_GRACE_CHOICES = [1, 2, 3, 6, 12, 24, 48] as const

export function graceChoices(current: number): { hours: number; label: string }[] {
  const all = SCHEDULE_GRACE_CHOICES.includes(current as (typeof SCHEDULE_GRACE_CHOICES)[number]) || !isScheduleGraceHours(current) ? [...SCHEDULE_GRACE_CHOICES] : [...SCHEDULE_GRACE_CHOICES, current].sort((a, b) => a - b)
  return all.map((hours) => ({ hours, label: hours === 1 ? '1 hour' : `${hours} hours` }))
}
