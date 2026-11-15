// The month view of Posts: which post falls on which local day, and the rhythm the content mix would keep. Pure, tested from
// src/main/posts-logic.test.ts. A day is always the viewer's local day, from the offset in minutes east of UTC.

import { dayRange, localDay } from '../../../../shared/local-day'
import type { Id, IsoTime, MixCard } from '../../../../shared/types'
import { postStateOf, type PostRow, type PostState } from './posts-filter'

export interface CalendarEntry {
  /** The version it is: unique among the entries (a group has one version for each channel but one row). */
  id: Id
  /** The row of the post it belongs to, so a click can open it. */
  rowId: Id
  title: string
  target: string
  state: PostState
  /** `planned`: going out then; `sent`: went out then. */
  kind: 'planned' | 'sent'
  at: IsoTime
}

export interface CalendarDay {
  date: string
  inMonth: boolean
  isToday: boolean
  isPast: boolean
  entries: CalendarEntry[]
  /** The content mix would prepare a draft on this day. */
  rhythm: string[]
}

export interface YearMonth {
  year: number
  /** 0 to 11. */
  month: number
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function monthOf(day: string): YearMonth {
  const [year, month] = day.split('-').map(Number)
  return { year, month: month - 1 }
}

export function shiftMonth(at: YearMonth, by: number): YearMonth {
  const index = at.year * 12 + at.month + by
  return { year: Math.floor(index / 12), month: index % 12 }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthTitle = (at: YearMonth): string => `${MONTH_NAMES[at.month]} ${at.year}`

/**
 * The planned and the sent posts as entries of the calendar: one for every version of a group, each on its own day. A post with a
 * planned time is on the calendar from the draft on (its state says whether it is approved); a sent one is on the day it went out.
 */
export function calendarEntries(rows: PostRow[]): CalendarEntry[] {
  const entries: CalendarEntry[] = []
  for (const row of rows) {
    for (const card of row.cards) {
      const opportunity = card.opportunity
      const base = { id: opportunity.id, rowId: row.id, title: row.title, target: card.channelTarget }
      if (opportunity.state === 'confirmed') {
        entries.push({ ...base, state: 'sent', kind: 'sent', at: card.lastAction?.completedAt ?? opportunity.updatedAt })
      } else if (opportunity.state !== 'cancelled' && opportunity.scheduledAt !== null) {
        entries.push({ ...base, state: postStateOf(opportunity.state, opportunity.scheduledAt), kind: 'planned', at: opportunity.scheduledAt })
      }
    }
  }
  return entries.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1))
}

/**
 * The days a mix kind would prepare a draft on, from its next due time on, every `everyDays` days, inside [first, last].
 * Nothing before the next due time: what already passed is not a plan.
 */
export function rhythmDays(nextAt: IsoTime | null, everyDays: number, first: string, last: string, offsetMinutes: number): string[] {
  if (nextAt === null || !Number.isInteger(everyDays) || everyDays < 1) return []
  const start = localDay(nextAt, offsetMinutes)
  const days: string[] = []
  for (const day of dayRange(start, last)) {
    const gap = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
    if (gap % everyDays === 0 && day >= first) days.push(day)
  }
  return days
}

/**
 * The enabled kinds of the mix of every channel as markers, with a short name of the kind for the day's tooltip. A channel the mix cannot
 * run on now (observe-only, paused: `blocked`) or already holds as many unapproved drafts as the cap allows would prepare nothing, so it has no markers.
 */
export function rhythmMarkers(cards: MixCard[], first: string, last: string, offsetMinutes: number): Map<string, string[]> {
  const names: Record<string, string> = { product_post: 'Product post', own_update: 'My update', showcase: 'Showcase' }
  const markers = new Map<string, string[]>()
  for (const card of cards) {
    if (card.blocked !== null || card.waiting >= card.cap) continue
    for (const kind of card.kinds) {
      if (!kind.enabled) continue
      for (const day of rhythmDays(kind.nextAt, kind.everyDays, first, last, offsetMinutes)) {
        const list = markers.get(day) ?? []
        list.push(names[kind.kind] ?? kind.kind)
        markers.set(day, list)
      }
    }
  }
  return markers
}

/**
 * The weeks of a month, whole weeks from `weekStart` (0 is Sunday): the days of the neighbouring months that fill the first and last
 * week are `inMonth: false`. `today` is the viewer's local today.
 */
export function monthGrid(at: YearMonth, entries: CalendarEntry[], today: string, offsetMinutes: number, weekStart = 0, markers: ReadonlyMap<string, string[]> = new Map()): CalendarDay[][] {
  const firstOfMonth = `${at.year}-${pad(at.month + 1)}-01`
  const lead = (new Date(`${firstOfMonth}T00:00:00Z`).getUTCDay() - weekStart + 7) % 7
  const daysInMonth = new Date(Date.UTC(at.year, at.month + 1, 0)).getUTCDate()
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7
  const begin = new Date(Date.UTC(at.year, at.month, 1 - lead)).toISOString().slice(0, 10)
  const end = new Date(Date.UTC(at.year, at.month, 1 - lead + cells - 1)).toISOString().slice(0, 10)
  const byDay = new Map<string, CalendarEntry[]>()
  for (const entry of entries) {
    const day = localDay(entry.at, offsetMinutes)
    byDay.set(day, [...(byDay.get(day) ?? []), entry])
  }
  const monthPrefix = `${at.year}-${pad(at.month + 1)}-`
  const days: CalendarDay[] = dayRange(begin, end).map((date) => ({
    date,
    inMonth: date.startsWith(monthPrefix),
    isToday: date === today,
    isPast: date < today,
    entries: byDay.get(date) ?? [],
    rhythm: markers.get(date) ?? []
  }))
  return Array.from({ length: cells / 7 }, (_, week) => days.slice(week * 7, week * 7 + 7))
}

/** A day with nothing on it offers "Write one myself" for that date, from today on. */
export function canWriteOn(day: CalendarDay): boolean {
  return day.entries.length === 0 && !day.isPast
}

/**
 * The viewer's offset from UTC on a day, in minutes east: the offset of noon of that day, so a day on the other side of a clock change
 * has its own (a post planned for ten in the morning stays ten in the morning). `date` is "YYYY-MM-DD".
 */
export function offsetOn(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return -new Date(year, month - 1, day, 12).getTimezoneOffset()
}

/** The time a post written from the calendar is planned for on that day: ten in the morning, the viewer's time, as an ISO time. */
export function plannedTimeOn(date: string, offsetMinutes: number, hour = 10): string {
  return new Date(Date.parse(`${date}T${pad(hour)}:00:00.000Z`) - offsetMinutes * 60_000).toISOString()
}
