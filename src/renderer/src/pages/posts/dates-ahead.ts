// The plain logic of the "Dates ahead" card of the Posts calendar (DEC-060), apart from the component so it is tested without the interface.
import { localDay } from '../../../../shared/local-day'
import type { SeasonalEventView } from '../../../../shared/types'

/** The names of the dates ahead by the viewer's day, for the cells of the month. */
export function datesByDay(events: readonly SeasonalEventView[], offsetMinutes: number): Map<string, string[]> {
  const days = new Map<string, string[]>()
  for (const event of events) {
    const day = localDay(new Date(event.at), offsetMinutes)
    days.set(day, [...(days.get(day) ?? []), event.name])
  }
  return days
}

/** "today", "tomorrow", "in 12 days". */
export function inDays(days: number): string {
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
}

export type EventStanding = 'skipped' | 'prepared' | 'due' | 'ahead'

/** Where a date stands: skipped by the owner, prepared for every channel it is time for, time to prepare, or still ahead of every lead time. */
export function standingOf(event: SeasonalEventView): EventStanding {
  if (event.skipped) return 'skipped'
  const due = event.channels.filter((c) => c.due)
  if (due.some((c) => c.opportunityId === null)) return 'due'
  return event.channels.some((c) => c.opportunityId !== null) ? 'prepared' : 'ahead'
}

/** When a channel's time to prepare comes: "now", or "in 21 days" (the days left until its lead time opens). */
export function prepareFrom(days: number, leadDays: number): string {
  return days <= leadDays ? 'now' : inDays(days - leadDays)
}

/** The dates the card shows first: those it is time to prepare for, then the rest in order; skipped ones last. */
export function orderedEvents(events: readonly SeasonalEventView[]): SeasonalEventView[] {
  const rank: Record<EventStanding, number> = { due: 0, prepared: 1, ahead: 1, skipped: 2 }
  return [...events].sort((a, b) => rank[standingOf(a)] - rank[standingOf(b)] || a.days - b.days || a.key.localeCompare(b.key))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "December 1, every year" / "December 12, 2026". */
export function ownDateLine(date: { month: number; day: number; year: number | null }): string {
  return `${MONTHS[date.month - 1]} ${date.day}, ${date.year === null ? 'every year' : date.year}`
}
export { MONTHS }
