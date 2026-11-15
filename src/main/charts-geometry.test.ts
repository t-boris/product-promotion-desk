// The Overview charts' arithmetic lives in src/renderer/src/charts/geometry.ts; the renderer has no test runner of its own
// (vitest excludes src/renderer), and this module imports nothing but itself, so it is tested from here.

import { describe, expect, it } from 'vitest'
import {
  axisFormatter,
  columnLayout,
  dailyValues,
  dayLabel,
  describeFunnel,
  describeSeries,
  formatCompact,
  formatNumber,
  funnelRows,
  linePaths,
  linearScale,
  niceTicks,
  roundedEndPath,
  stackSegments
} from '../renderer/src/charts/geometry'

describe('linearScale', () => {
  it('maps the domain onto the range, also backwards', () => {
    const y = linearScale(0, 10, 100, 0)
    expect(y(0)).toBe(100)
    expect(y(10)).toBe(0)
    expect(y(2.5)).toBe(75)
  })
  it('puts a flat domain in the middle of the range', () => {
    expect(linearScale(5, 5, 0, 100)(5)).toBe(50)
  })
})

describe('niceTicks', () => {
  it('gives round numbers that cover the data', () => {
    expect(niceTicks(0, 87, 4)).toEqual([0, 50, 100])
    expect(niceTicks(3, 9, 4)).toEqual([0, 5, 10])
    expect(niceTicks(0, 9, 5)).toEqual([0, 2, 4, 6, 8, 10])
    expect(niceTicks(1200, 1800, 4)).toEqual([1000, 1500, 2000])
  })
  it('rounds the step to the nearest nice number, and the range up to the next one', () => {
    // 50 over 7 gaps is 7.14 per tick: nearer to 10 than to 5.
    expect(niceTicks(0, 50, 8)).toEqual([0, 10, 20, 30, 40, 50])
    // 4.5 rises to the nice range 5, not 10.
    expect(niceTicks(0, 4.5, 2)).toEqual([0, 5])
  })
  it('reaches zero from below too when asked to include it', () => {
    const ticks = niceTicks(-9, -6, 4, { includeZero: true })
    expect(ticks[0]).toBeLessThanOrEqual(-9)
    expect(ticks[ticks.length - 1]).toBe(0)
    expect(Object.is(ticks[ticks.length - 1], 0)).toBe(true)
  })
  it('anchors a column axis at zero', () => {
    const ticks = niceTicks(40, 90, 4, { includeZero: true })
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(90)
  })
  it('never steps below one for counts', () => {
    expect(niceTicks(0, 1, 5, { includeZero: true, whole: true })).toEqual([0, 1])
    expect(niceTicks(0, 0, 4, { includeZero: true, whole: true })).toEqual([0, 1])
  })
  it('gives a flat series an axis around it', () => {
    const ticks = niceTicks(7, 7, 4)
    expect(ticks[0]).toBeLessThan(7)
    expect(ticks[ticks.length - 1]).toBeGreaterThan(7)
  })
  it('survives data that is not a number', () => {
    expect(niceTicks(Number.NaN, 3)).toEqual([0, 1])
  })
  it('handles negative readings', () => {
    const ticks = niceTicks(-30, 20, 4)
    expect(ticks[0]).toBeLessThanOrEqual(-30)
    expect(ticks).toContain(0)
  })
})

describe('number formats', () => {
  it('writes a number in full, with separators', () => {
    expect(formatNumber(1284)).toBe('1,284')
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(12.34)).toBe('12.3')
  })
  it('writes a large number compactly', () => {
    expect(formatCompact(9_999)).toBe('9,999')
    expect(formatCompact(12_900)).toBe('12.9K')
    expect(formatCompact(4_200_000)).toBe('4.2M')
    expect(formatCompact(1_500_000)).toBe('1.5M')
    expect(formatCompact(-12_900)).toBe('-12.9K')
  })
  it('keeps one style on an axis: compact as soon as a tick reaches ten thousand', () => {
    expect(axisFormatter([0, 5000, 9000])(5000)).toBe('5,000')
    expect(axisFormatter([0, 5000, 10000])(5000)).toBe('5,000')
    expect(axisFormatter([0, 5000, 10000])(10000)).toBe('10K')
    expect(axisFormatter([0, 20000])(0)).toBe('0')
  })
})

describe('linePaths', () => {
  it('draws one run for readings that follow each other', () => {
    const runs = linePaths([{ x: 0, y: 10 }, { x: 10, y: 20 }, { x: 20, y: 5 }])
    expect(runs).toHaveLength(1)
    expect(runs[0].d).toBe('M0 10 L10 20 L20 5')
  })
  it('breaks the line at a missing reading and never draws it as zero', () => {
    const runs = linePaths([{ x: 0, y: 10 }, { x: 10, y: null }, { x: 20, y: 5 }, { x: 30, y: 6 }])
    expect(runs.map((r) => r.points.length)).toEqual([1, 2])
    expect(runs[0].d).toBe('')
    expect(runs[1].d).toBe('M20 5 L30 6')
    expect(runs.flatMap((r) => r.points).every((p) => p.x !== 10)).toBe(true)
  })
  it('rounds the coordinates it writes', () => {
    expect(linePaths([{ x: 0.123456, y: 1.987654 }, { x: 10.005, y: 20 }])[0].d).toBe('M0.12 1.99 L10.01 20')
  })
  it('keeps a lone reading as a point with no path', () => {
    expect(linePaths([{ x: 3, y: 4 }])).toEqual([{ d: '', points: [{ x: 3, y: 4 }] }])
  })
  it('draws nothing for no readings, or only missing ones, and treats a non-finite one as missing', () => {
    expect(linePaths([])).toEqual([])
    expect(linePaths([{ x: 0, y: null }, { x: 1, y: null }])).toEqual([])
    expect(linePaths([{ x: 0, y: 1 }, { x: 1, y: Number.NaN }, { x: 2, y: 3 }]).map((r) => r.points.length)).toEqual([1, 1])
  })
})

describe('dailyValues', () => {
  const days = ['2026-11-06', '2026-11-07', '2026-11-08']
  it('gives the last reading known on each day', () => {
    expect(dailyValues([{ day: '2026-11-06', value: 1 }, { day: '2026-11-06', value: 4 }, { day: '2026-11-08', value: 2 }], days)).toEqual([4, null, 2])
  })
  it('does not let a later missing reading erase an earlier one of the same day', () => {
    expect(dailyValues([{ day: '2026-11-07', value: 5 }, { day: '2026-11-07', value: null }], days)).toEqual([null, 5, null])
  })
  it('leaves a day with nothing, or only missing readings, empty and a zero stays a zero', () => {
    expect(dailyValues([{ day: '2026-11-06', value: null }, { day: '2026-11-07', value: 0 }], days)).toEqual([null, 0, null])
    expect(dailyValues([], days)).toEqual([null, null, null])
    expect(dailyValues([{ day: '2026-11-07', value: 1 }], [])).toEqual([])
  })
  it('ignores a reading of a day outside the list and one that is not a finite number', () => {
    expect(dailyValues([{ day: '2026-01-01', value: 9 }, { day: '2026-11-06', value: Number.NaN }, { day: '2026-11-08', value: Number.POSITIVE_INFINITY }], days)).toEqual([null, null, null])
  })
})

describe('columnLayout', () => {
  it('caps a column at 24 px and centres it in its slot', () => {
    const layout = columnLayout(3, 300)
    expect(layout).toHaveLength(3)
    expect(layout.every((c) => c.width === 24)).toBe(true)
    expect(layout[0].x).toBe(38)
    expect(layout[1].x).toBe(138)
  })
  it('narrows the columns so that two never touch', () => {
    const layout = columnLayout(30, 300)
    expect(layout[0].width).toBe(8)
    expect(layout[1].x - (layout[0].x + layout[0].width)).toBeGreaterThanOrEqual(2)
  })
  it('keeps at least a pixel and returns nothing for an empty chart', () => {
    expect(columnLayout(500, 100)[0].width).toBe(1)
    expect(columnLayout(0, 100)).toEqual([])
    expect(columnLayout(5, 0)).toEqual([])
  })
})

describe('stackSegments', () => {
  it('stacks bottom up with a surface gap and marks only the topmost one', () => {
    const rects = stackSegments([2, 3], 100, 10, 2)
    expect(rects).toEqual([
      { series: 0, y: 80, height: 20, top: false },
      { series: 1, y: 50, height: 28, top: true }
    ])
  })
  it('skips a value that is not a number instead of drawing a broken segment', () => {
    expect(stackSegments([Number.NaN, 2], 100, 10)).toEqual([{ series: 1, y: 80, height: 20, top: true }])
    expect(stackSegments([-3, 2], 100, 10)).toEqual([{ series: 1, y: 80, height: 20, top: true }])
  })
  it('draws nothing for zero, and the top mark moves to the last segment that is drawn', () => {
    expect(stackSegments([0, 0], 100, 10)).toEqual([])
    expect(stackSegments([0, 4], 100, 10)).toEqual([{ series: 1, y: 60, height: 40, top: true }])
    expect(stackSegments([4, 0], 100, 10)).toEqual([{ series: 0, y: 60, height: 40, top: true }])
  })
  it('drops a segment too small to show beside its gap, without moving the ones above it off their place', () => {
    const rects = stackSegments([5, 0.1, 5], 100, 10, 2)
    expect(rects.map((r) => r.series)).toEqual([0, 2])
    expect(rects[1].y).toBe(-1)
  })
})

describe('roundedEndPath', () => {
  it('rounds the top of a column and keeps the baseline square', () => {
    expect(roundedEndPath(0, 0, 10, 20, 4, 'top')).toBe('M0 20 L0 4 Q0 0 4 0 L6 0 Q10 0 10 4 L10 20 Z')
  })
  it('rounds the right end of a row and keeps the left square', () => {
    expect(roundedEndPath(0, 0, 40, 10, 4, 'right')).toBe('M0 0 L36 0 Q40 0 40 4 L40 6 Q40 10 36 10 L0 10 Z')
  })
  it('rounds by half the width of a narrow column and by half the height of a thin row', () => {
    expect(roundedEndPath(0, 0, 6, 20, 4, 'top')).toBe('M0 20 L0 3 Q0 0 3 0 L3 0 Q6 0 6 3 L6 20 Z')
    expect(roundedEndPath(0, 0, 40, 6, 4, 'right')).toBe('M0 0 L37 0 Q40 0 40 3 L40 3 Q40 6 37 6 L0 6 Z')
  })
  it('never rounds more than the bar can bear', () => {
    expect(roundedEndPath(0, 0, 10, 2, 4, 'top')).toContain('Q0 0 2 0')
    expect(roundedEndPath(0, 0, 3, 10, 4, 'right')).toBe('M0 0 L0 0 Q3 0 3 3 L3 7 Q3 10 0 10 L0 10 Z')
  })
})

describe('dayLabel', () => {
  it('writes a day short', () => {
    expect(dayLabel('2026-11-08')).toBe('Nov 8')
    expect(dayLabel('2026-01-31T10:00:00.000Z')).toBe('Jan 31')
  })
  it('leaves anything else alone', () => {
    expect(dayLabel('yesterday')).toBe('yesterday')
    expect(dayLabel('2026-13-01')).toBe('2026-13-01')
  })
})

describe('funnelRows', () => {
  it('measures each bar against the longest and each step against the one before', () => {
    const rows = funnelRows({ found: 20, drafted: 10, approved: 5, sent: 4 })
    expect(rows.map((r) => r.widthPercent)).toEqual([100, 50, 25, 20])
    expect(rows.map((r) => r.ofPrevious)).toEqual([null, 50, 50, 80])
    expect(rows.map((r) => r.label)).toEqual(['Found', 'Drafted', 'Approved', 'Sent'])
  })
  it('rounds the share of the previous step to the nearest whole percent', () => {
    expect(funnelRows({ found: 3, drafted: 2, approved: 1, sent: 1 }).map((r) => r.ofPrevious)).toEqual([null, 67, 50, 100])
  })
  it('has no share after a step with nothing in it, and no division by zero when nothing was found', () => {
    expect(funnelRows({ found: 0, drafted: 0, approved: 0, sent: 0 }).map((r) => [r.widthPercent, r.ofPrevious])).toEqual([[0, null], [0, null], [0, null], [0, null]])
    expect(funnelRows({ found: 3, drafted: 0, approved: 0, sent: 0 }).map((r) => r.ofPrevious)).toEqual([null, 0, null, null])
  })
  it('never draws a step longer than the longest bar', () => {
    const rows = funnelRows({ found: 2, drafted: 4, approved: 1, sent: 0 })
    expect(Math.max(...rows.map((r) => r.widthPercent))).toBe(100)
  })
})

describe('text alternatives', () => {
  it('says the funnel in words', () => {
    expect(describeFunnel({ found: 20, drafted: 10, approved: 5, sent: 4 }, 7)).toBe(
      'Over the last 7 days: found 20, drafted 10 (50% of the step before), approved 5 (50% of the step before), sent 4 (80% of the step before).'
    )
    expect(describeFunnel({ found: 0, drafted: 0, approved: 0, sent: 0 }, 1)).toMatch(/^Over the last day: found 0, drafted 0/)
  })
  it('says a line in words, with its gaps', () => {
    const text = describeSeries('Upvotes', [
      { day: '2026-11-03', value: 3 },
      { day: '2026-11-05', value: null },
      { day: '2026-11-08', value: 9 }
    ])
    expect(text).toBe('Upvotes: from 3 on Nov 3 to 9 on Nov 8, highest 9, lowest 3; 1 reading missing.')
  })
  it('says a line with one reading, and no readings', () => {
    expect(describeSeries('Upvotes', [{ day: '2026-11-03', value: 3 }])).toBe('Upvotes: one reading, 3 on Nov 3.')
    expect(describeSeries('Upvotes', [{ day: '2026-11-03', value: null }])).toBe('Upvotes: no readings.')
    expect(describeSeries('Upvotes', [])).toBe('Upvotes: no readings.')
    expect(describeSeries('A', [{ day: '2026-11-03', value: 1 }, { day: '2026-11-04', value: null }, { day: '2026-11-05', value: null }])).toBe('A: one reading, 1 on Nov 3; 2 readings missing.')
  })
})
