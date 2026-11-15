// What the Overview screen draws from the two queries it makes (DEC-037, phase C): the metric the lines show, the small line of each
// channel's tile, the notes no post has used, and the places a suggestion leads to. Pure, so it is tested from src/main/overview-logic.test.ts.
// A reading the platform did not give is never a zero: it stays a gap all the way to the chart.

import { localDay } from '../../../../shared/local-day'
import type { Id, MetricSeries, ProductUpdate, ResultsHistory } from '../../../../shared/types'
import type { SuggestionAction } from '../../../../shared/overview-suggestions'
import { dailyValues, type LineSeries } from '../../charts/geometry'
import { channelHref } from '../../route'

/** A note the AI could not make a post from this many times is set aside until the owner rewrites it (it is not "waiting" any more). */
export const NOTE_GIVE_UP = 3

/** Notes that wait to become a post: not used, and not given up on. */
export function unusedNoteCount(updates: readonly ProductUpdate[]): number {
  return updates.filter((update) => update.usedInOpportunityId === null && update.failedTries < NOTE_GIVE_UP).length
}

/** The days on which a series has a reading (the last reading of a local day counts), as the days of the period it has one for. */
function knownDays(series: MetricSeries, days: readonly string[], offsetMinutes: number): string[] {
  const inPeriod = new Set(days)
  const known = new Set<string>()
  for (const point of series.points) {
    if (!Number.isFinite(point.value)) continue
    const day = localDay(point.capturedAt, offsetMinutes)
    if (inPeriod.has(day)) known.add(day)
  }
  return [...known]
}

/** One reading per day of the period for a series: the last one of the local day, null where there is none. */
export function valuesOver(series: MetricSeries, days: readonly string[], offsetMinutes: number): (number | null)[] {
  return dailyValues(
    series.points.map((point) => ({ day: localDay(point.capturedAt, offsetMinutes), value: point.value })),
    [...days]
  )
}

export interface MainMetric {
  key: string
  label: string
  /** One line for each channel that has readings of it, in the order the channels were given. */
  lines: LineSeries[]
}

/**
 * The metric the Activity lines show: the one the most channels have at least two days of readings for (a line needs two points), then the one
 * with the most days of readings, then the first by key. Null when no channel has a metric with two days of readings: there is no line to draw.
 * `channelLabel` names a channel for the legend; `channelOrder` is the order lines take (their colour follows it).
 */
export function mainMetric(history: ResultsHistory, days: readonly string[], offsetMinutes: number, channelOrder: readonly Id[], channelLabel: (channelId: Id) => string): MainMetric | null {
  const byKey = new Map<string, { label: string; series: MetricSeries[]; days: number }>()
  for (const series of history.series) {
    const count = knownDays(series, days, offsetMinutes).length
    if (count < 2) continue
    const entry = byKey.get(series.key) ?? { label: series.label, series: [], days: 0 }
    entry.series.push(series)
    entry.days += count
    byKey.set(series.key, entry)
  }
  const ranked = [...byKey.entries()].sort(([keyA, a], [keyB, b]) => b.series.length - a.series.length || b.days - a.days || keyA.localeCompare(keyB))
  const best = ranked[0]
  if (!best) return null
  const [key, entry] = best
  const place = (channelId: Id): number => {
    const at = channelOrder.indexOf(channelId)
    return at < 0 ? channelOrder.length : at
  }
  const lines = [...entry.series]
    .sort((a, b) => place(a.channelId) - place(b.channelId))
    .map((series): LineSeries => ({ key: series.channelId, label: channelLabel(series.channelId), values: valuesOver(series, days, offsetMinutes) }))
  return { key, label: entry.label, lines }
}

export interface TileLine {
  label: string
  values: (number | null)[]
  /** The newest reading of the period. */
  latest: number | null
}

/**
 * The small line of a channel's tile: the main metric where the channel has two days of it (so tiles can be compared), else the metric of
 * the channel with the most days of readings. Null when the channel has no metric with two days: its tile shows no line, not a flat one.
 */
export function tileLine(history: ResultsHistory, channelId: Id, days: readonly string[], offsetMinutes: number, mainKey: string | null): TileLine | null {
  const own = history.series.filter((series) => series.channelId === channelId).map((series) => ({ series, count: knownDays(series, days, offsetMinutes).length }))
  const usable = own.filter((entry) => entry.count >= 2)
  const chosen = usable.find((entry) => entry.series.key === mainKey) ?? [...usable].sort((a, b) => b.count - a.count || a.series.key.localeCompare(b.series.key))[0]
  if (!chosen) return null
  const values = valuesOver(chosen.series, days, offsetMinutes)
  const known = values.filter((value): value is number => value !== null)
  return { label: chosen.series.label, values, latest: known.length > 0 ? known[known.length - 1] : null }
}

/** Where a suggestion's one action leads. */
export function suggestionHref(action: SuggestionAction): string {
  switch (action.kind) {
    case 'inbox':
      return '#/inbox'
    case 'posts':
      return '#/posts'
    case 'channel':
      return channelHref(action.channelId, action.tab)
  }
}
