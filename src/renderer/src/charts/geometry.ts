// The arithmetic of the Overview charts: scales, round axis ticks, line paths that break where a reading is missing, column
// layout, rounded bar ends and the sentences that stand in for a chart. Pure functions with no React in them, so they are
// tested from src/main/charts-geometry.test.ts (the renderer is not under vitest). No chart library: DEC-037, V-22.

/** A point of a line. `y === null` is a reading that is missing: the line breaks there and never dips to zero. */
export interface LinePoint {
  x: number
  y: number | null
}

/** One line of a line chart: a series with one reading for each day of the chart (null where a day has none). */
export interface LineSeries {
  key: string
  label: string
  /** One reading per day of the chart's days; null where the day has none. */
  values: (number | null)[]
}

/** One unbroken run of a line. A run of one point has no length: it is drawn as a dot only. */
export interface LineRun {
  d: string
  points: { x: number; y: number }[]
}

const round = (n: number): number => Math.round(n * 100) / 100

/** Maps a value of the domain onto the range (the range may run backwards, as an SVG y-axis does). A flat domain maps to the middle. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (value: number) => number {
  if (d1 === d0) return () => (r0 + r1) / 2
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)
}

/** The "nice" number at or above `range` (1, 2, 5 times a power of ten), or the nearest one when `roundIt`. */
function niceNumber(range: number, roundIt: boolean): number {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / 10 ** exponent
  let nice: number
  if (roundIt) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * 10 ** exponent
}

/**
 * Round axis ticks that cover [min, max], about `count` of them. Counts are whole numbers, so a step is never below 1 when
 * `whole` is set. `includeZero` anchors the axis at zero (columns always do; a line may not).
 */
export function niceTicks(min: number, max: number, count = 4, options: { includeZero?: boolean; whole?: boolean } = {}): number[] {
  let lo = options.includeZero ? Math.min(0, min) : min
  let hi = options.includeZero ? Math.max(0, max) : max
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (hi === lo) {
    // A flat series still needs an axis: one step either side (or 0..1 for zero).
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1
    lo -= options.includeZero && lo >= 0 ? 0 : pad
    hi += pad
  }
  let step = niceNumber(niceNumber(hi - lo, false) / Math.max(count - 1, 1), true)
  if (options.whole && step < 1) step = 1
  const first = Math.floor(lo / step) * step
  const last = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let value = first; value <= last + step / 2; value += step) ticks.push(round(value) + 0) // + 0 turns a negative zero into a zero
  return ticks
}

/** A number in full, with thousands separators ("1,284"). */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: Number.isInteger(n) ? 0 : 1 }).format(n)
}

/** A number compactly ("12.9K", "4.2M"), for an axis that reaches ten thousand. */
export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${round(n / 1_000_000)}M`
  if (abs >= 10_000) return `${round(n / 1_000)}K`
  return formatNumber(n)
}

/** One style for a whole axis: in full under ten thousand, compact once any tick reaches it. */
export function axisFormatter(ticks: number[]): (n: number) => string {
  const reaches = ticks.some((tick) => Math.abs(tick) >= 10_000)
  return reaches ? formatCompact : formatNumber
}

/**
 * One value for each of `days`: the last reading known on that day (readings arrive oldest first), or null where the day has none.
 * A later reading that is missing does not erase an earlier one of the same day, and a day without any is a gap, never a zero.
 */
export function dailyValues(points: { day: string; value: number | null }[], days: string[]): (number | null)[] {
  const byDay = new Map<string, number>()
  for (const point of points) {
    if (point.value !== null && Number.isFinite(point.value)) byDay.set(point.day, point.value)
  }
  return days.map((day) => byDay.get(day) ?? null)
}

/** Splits a line into unbroken runs; every missing reading ends one. Each run is an SVG path `d` (empty for a single point). */
export function linePaths(points: LinePoint[]): LineRun[] {
  const runs: LineRun[] = []
  let current: { x: number; y: number }[] = []
  const close = (): void => {
    if (current.length === 0) return
    const d = current.length < 2 ? '' : current.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ')
    runs.push({ d, points: current })
    current = []
  }
  for (const point of points) {
    if (point.y === null || !Number.isFinite(point.y)) close()
    else current.push({ x: point.x, y: point.y })
  }
  close()
  return runs
}

export interface ColumnSlot {
  x: number
  width: number
}

/** Columns across `width`: each at most `maxThickness` wide, centred in an equal slot, never touching the next. */
export function columnLayout(count: number, width: number, maxThickness = 24, gap = 2): ColumnSlot[] {
  if (count <= 0 || width <= 0) return []
  const slot = width / count
  const thickness = Math.max(1, Math.min(maxThickness, slot - gap))
  return Array.from({ length: count }, (_, i) => ({ x: round(i * slot + (slot - thickness) / 2), width: round(thickness) }))
}

export interface StackRect {
  /** The index of the series this segment belongs to. */
  series: number
  y: number
  height: number
  /** True for the topmost drawn segment: only that one has the rounded end. */
  top: boolean
}

/**
 * The segments of one stacked column, bottom up. A segment sits on the one below it with `gap` of surface between them; a value
 * of zero draws nothing. `baseline` is the y of zero and `scale` the pixels per unit.
 */
export function stackSegments(values: number[], baseline: number, scale: number, gap = 2): StackRect[] {
  const rects: StackRect[] = []
  let cumulative = 0
  values.forEach((value, series) => {
    if (!(value > 0)) return
    const bottom = baseline - cumulative * scale
    const top = baseline - (cumulative + value) * scale
    const lift = rects.length > 0 ? gap : 0
    const height = Math.max(0, bottom - top - lift)
    cumulative += value
    if (height <= 0) return
    rects.push({ series, y: round(top), height: round(height), top: false })
  })
  if (rects.length > 0) rects[rects.length - 1].top = true
  return rects
}

/** A bar whose far end is rounded and whose baseline end is square. `rounded` picks the end: the top of a column, the right of a row. */
export function roundedEndPath(x: number, y: number, width: number, height: number, radius: number, end: 'top' | 'right'): string {
  const r = Math.max(0, Math.min(radius, end === 'top' ? Math.min(height, width / 2) : Math.min(width, height / 2)))
  const [x0, y0, x1, y1] = [round(x), round(y), round(x + width), round(y + height)]
  if (end === 'top') {
    return `M${x0} ${y1} L${x0} ${round(y0 + r)} Q${x0} ${y0} ${round(x0 + r)} ${y0} L${round(x1 - r)} ${y0} Q${x1} ${y0} ${x1} ${round(y0 + r)} L${x1} ${y1} Z`
  }
  return `M${x0} ${y0} L${round(x1 - r)} ${y0} Q${x1} ${y0} ${x1} ${round(y0 + r)} L${x1} ${round(y1 - r)} Q${x1} ${y1} ${round(x1 - r)} ${y1} L${x0} ${y1} Z`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-08" (or a full ISO time, read by its date part) as "Nov 8". Anything else comes back as it is. */
export function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  if (!match) return day
  const month = MONTHS[Number(match[2]) - 1]
  return month ? `${month} ${Number(match[3])}` : day
}

export interface FunnelInput {
  found: number
  drafted: number
  approved: number
  sent: number
}

export interface FunnelRow {
  key: keyof FunnelInput
  label: string
  value: number
  /** The bar's length as a share of the longest bar, 0 to 100. */
  widthPercent: number
  /** Which share of the step before this one got here, in whole percent; null for the first step or after a step with nothing in it. */
  ofPrevious: number | null
}

const FUNNEL_LABELS: [keyof FunnelInput, string][] = [
  ['found', 'Found'],
  ['drafted', 'Drafted'],
  ['approved', 'Approved'],
  ['sent', 'Sent']
]

/** The four funnel steps with their bar lengths and the share of the previous step; a step never draws longer than the longest. */
export function funnelRows(funnel: FunnelInput): FunnelRow[] {
  const longest = Math.max(1, ...FUNNEL_LABELS.map(([key]) => funnel[key]))
  return FUNNEL_LABELS.map(([key, label], i) => {
    const value = funnel[key]
    const before = i === 0 ? null : funnel[FUNNEL_LABELS[i - 1][0]]
    return {
      key,
      label,
      value,
      widthPercent: round((value / longest) * 100),
      ofPrevious: before === null || before === 0 ? null : Math.round((value / before) * 100)
    }
  })
}

/** The funnel as a sentence, for the chart's text alternative. */
export function describeFunnel(funnel: FunnelInput, days: number): string {
  const rows = funnelRows(funnel)
  const parts = rows.map((row) => `${row.label.toLowerCase()} ${formatNumber(row.value)}${row.ofPrevious === null ? '' : ` (${row.ofPrevious}% of the step before)`}`)
  return `Over the last ${days === 1 ? 'day' : `${days} days`}: ${parts.join(', ')}.`
}

/** A line's readings as a sentence, for the chart's text alternative. `points` carry the day of each reading. */
export function describeSeries(label: string, points: { day: string; value: number | null }[]): string {
  const known = points.filter((p): p is { day: string; value: number } => p.value !== null)
  if (known.length === 0) return `${label}: no readings.`
  const missing = points.length - known.length
  const first = known[0]
  const last = known[known.length - 1]
  const values = known.map((p) => p.value)
  const high = Math.max(...values)
  const low = Math.min(...values)
  const range = known.length === 1 ? `one reading, ${formatNumber(first.value)} on ${dayLabel(first.day)}` : `from ${formatNumber(first.value)} on ${dayLabel(first.day)} to ${formatNumber(last.value)} on ${dayLabel(last.day)}`
  const tail = known.length > 1 ? `, highest ${formatNumber(high)}, lowest ${formatNumber(low)}` : ''
  return `${label}: ${range}${tail}${missing > 0 ? `; ${missing} ${missing === 1 ? 'reading' : 'readings'} missing` : ''}.`
}
