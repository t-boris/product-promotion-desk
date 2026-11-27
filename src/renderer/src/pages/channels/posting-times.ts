// The posting times card of a channel, as far as it is plain logic: the week as rows, adding a time to chosen days, removing one.

import { MAX_POSTING_SLOTS, WEEKDAY_NAMES, WEEKDAY_ORDER, normalizeSlots, parseSlotTime, slotTime, type PostingSlot } from '../../../../shared/schedule'

export const POSTING_TIMES_HINT =
  'The times this channel posts at. “Next free time” on a post or a reply puts it on the first of these that nothing else of the channel holds. A time decides only when: every item still needs your approval before it.'
export const NO_TIMES_LINE = 'No posting times yet. Choose the days, a time, and press Add.'

export interface WeekRow {
  weekday: number
  name: string
  times: { minute: number; label: string }[]
}

/** The days that have times, Monday first, each with its times in order. */
export function weekRows(slots: readonly PostingSlot[]): WeekRow[] {
  const ordered = normalizeSlots(slots)
  return WEEKDAY_ORDER.map((weekday) => ({
    weekday,
    name: WEEKDAY_NAMES[weekday] as string,
    times: ordered.filter((slot) => slot.weekday === weekday).map((slot) => ({ minute: slot.minute, label: slotTime(slot.minute) }))
  })).filter((row) => row.times.length > 0)
}

export type AddResult = { ok: true; slots: PostingSlot[] } | { ok: false; error: string }

/** Adds one time of day to every chosen day; a time a day already has is kept once. */
export function addTimes(slots: readonly PostingSlot[], weekdays: readonly number[], time: string): AddResult {
  if (weekdays.length === 0) return { ok: false, error: 'Choose at least one day.' }
  const minute = parseSlotTime(time)
  if (minute === null) return { ok: false, error: 'Enter the time as HH:MM.' }
  const next = normalizeSlots([...slots, ...weekdays.map((weekday) => ({ weekday, minute }))])
  if (next.length > MAX_POSTING_SLOTS) return { ok: false, error: `A channel has at most ${MAX_POSTING_SLOTS} posting times.` }
  return { ok: true, slots: next }
}

export function removeTime(slots: readonly PostingSlot[], weekday: number, minute: number): PostingSlot[] {
  return normalizeSlots(slots.filter((slot) => !(slot.weekday === weekday && slot.minute === minute)))
}

export const sameSlots = (a: readonly PostingSlot[], b: readonly PostingSlot[]): boolean => JSON.stringify(normalizeSlots(a)) === JSON.stringify(normalizeSlots(b))

/** "3 times a week" for the card's status line. */
export function timesLine(count: number): string {
  return count === 0 ? NO_TIMES_LINE : `${count} ${count === 1 ? 'time' : 'times'} a week`
}

export const DAY_CHOICES = WEEKDAY_ORDER.map((weekday) => ({ weekday, short: (WEEKDAY_NAMES[weekday] as string).slice(0, 3), name: WEEKDAY_NAMES[weekday] as string }))
