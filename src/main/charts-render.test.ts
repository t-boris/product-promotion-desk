// The chart components are rendered to markup here (the renderer has no test runner of its own): they must not fall over on
// empty or incomplete data, must leave a missing reading out of the picture, and must say in words what they show.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ColumnChart } from '../renderer/src/charts/ColumnChart'
import { FunnelBars } from '../renderer/src/charts/FunnelBars'
import { LineChart } from '../renderer/src/charts/LineChart'
import { ChartLegend, ChartTip } from '../renderer/src/charts/parts'
import { Sparkline } from '../renderer/src/charts/Sparkline'

const days = ['2026-11-06', '2026-11-07', '2026-11-08']
const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

describe('Sparkline', () => {
  it('draws a line and the latest reading as a dot, and says the latest value', () => {
    const out = html(createElement(Sparkline, { values: [1, 3, 2], label: 'Upvotes' }))
    expect(out).toContain('<path')
    expect(out).toContain('spark-dot')
    expect(out).toContain('aria-label="Upvotes: 3 readings, latest 2"')
  })
  it('puts the dot on the latest reading', () => {
    // Three readings across 96px with 6px of margin: the last sits at x = 90, and 2 is halfway between 1 and 3.
    const out = html(createElement(Sparkline, { values: [1, 3, 2], label: 'Upvotes' }))
    expect(out).toMatch(/<circle class="spark-dot" cx="90" cy="14" r="4"/)
  })
  it('draws a dash and no line when there is no reading at all, never a flat line at zero', () => {
    const out = html(createElement(Sparkline, { values: [null, null], label: 'Upvotes' }))
    expect(out).not.toContain('<svg')
    expect(out).toContain('no readings')
  })
  it('breaks the line at a missing reading', () => {
    const out = html(createElement(Sparkline, { values: [1, 2, null, 4, 5], label: 'Score' }))
    expect(out.match(/<path/g)).toHaveLength(2)
  })
  it('puts the dot on the last known reading, not on a trailing gap', () => {
    const solo = html(createElement(Sparkline, { values: [5, null], label: 'Score', width: 96, height: 28 }))
    expect(solo).toContain('spark-dot')
    expect(solo).not.toContain('<path')
  })
})

describe('FunnelBars', () => {
  it('lists the four steps with their values and shares, and says the funnel in a sentence', () => {
    const out = html(createElement(FunnelBars, { funnel: { found: 20, drafted: 10, approved: 5, sent: 4 }, days: 7 }))
    for (const key of ['found', 'drafted', 'approved', 'sent']) expect(out).toContain(`data-testid="funnel-${key}"`)
    expect(out).toContain('width:50%')
    expect(out).toContain('80%')
    expect(out).toContain('aria-label="Over the last 7 days: found 20')
  })
  it('renders an empty funnel without a share and without a bar wider than nothing', () => {
    const out = html(createElement(FunnelBars, { funnel: { found: 0, drafted: 0, approved: 0, sent: 0 }, days: 1 }))
    expect(out).toContain('width:0%')
    expect(out).not.toContain('funnel-share')
  })
})

describe('ColumnChart', () => {
  it('draws a column for every day that has something and a legend for the two series', () => {
    const out = html(createElement(ColumnChart, { days: days.map((day, i) => ({ day, replies: i, posts: i === 2 ? 3 : 0 })) }))
    expect(out).toContain('data-testid="activity-chart"')
    expect(out).toContain('chart-legend')
    expect(out).toContain('Own posts')
    expect(out.match(/class="chart-seg"/g)?.length).toBe(3)
    expect(out).toContain('Arrow keys move through the days')
  })
  it('rounds only the top segment of a column and scales a column to its value', () => {
    const out = html(createElement(ColumnChart, { days: [{ day: '2026-11-06', replies: 2, posts: 1 }, { day: '2026-11-07', replies: 2, posts: 0 }] }))
    // Column one has two segments: the lower is a plain rect, the upper a path with a rounded end. Column two has one, rounded.
    expect(out.match(/<rect class="chart-seg"/g)).toHaveLength(1)
    expect(out.match(/<path class="chart-seg"/g)).toHaveLength(2)
    // The axis runs 0 to 4 over 148px, 37px a unit: two replies are 74px high.
    expect(out).toContain('height="74"')
  })
  it('says nothing was sent instead of drawing an empty plot as if it were data, and still offers the table', () => {
    const out = html(createElement(ColumnChart, { days: days.map((day) => ({ day, replies: 0, posts: 0 })) }))
    expect(out).toContain('Nothing was sent in this period.')
    expect(out).toContain('Table view')
    expect(out).not.toContain('chart-seg')
  })
  it('survives no days at all', () => {
    expect(() => html(createElement(ColumnChart, { days: [] }))).not.toThrow()
  })
})

describe('ChartTip and ChartLegend', () => {
  it('keeps the readout out of the accessibility tree: the chart has its own text and table', () => {
    const out = html(createElement(ChartTip, { x: 40, width: 400, head: 'Nov 8', rows: [{ key: 'a', label: 'Replies', value: '3', slot: 1, shape: 'rect' }] }))
    expect(out).toContain('<div class="chart-tip" aria-hidden="true"')
    expect(out).toContain('Replies')
    expect(out).toContain('<strong>3</strong>')
  })
  it('flips the readout to the left of the cursor near the right edge', () => {
    const left = html(createElement(ChartTip, { x: 40, width: 400, head: 'x', rows: [] }))
    const right = html(createElement(ChartTip, { x: 390, width: 400, head: 'x', rows: [] }))
    expect(left).toContain('left:52px')
    expect(right).toContain('right:22px')
  })
  it('names two series and leaves one to the title', () => {
    const item = (key: string) => ({ key, label: key, slot: 1 as const, shape: 'rect' as const })
    expect(html(createElement(ChartLegend, { items: [item('a')] }))).toBe('')
    expect(html(createElement(ChartLegend, { items: [item('a'), item('b')] }))).toContain('chart-legend')
  })
})

describe('LineChart', () => {
  const series = [
    { key: 'a', label: 'r/alpha', values: [1, null, 3] as (number | null)[] },
    { key: 'b', label: 'r/beta', values: [null, null, null] as (number | null)[] }
  ]
  it('draws a line for a series with readings and none for a series without, and breaks at the gap', () => {
    const out = html(createElement(LineChart, { days, series, unit: 'Score' }))
    expect(out).toContain('data-testid="metric-chart"')
    expect(out).not.toContain('NaN')
    // alpha has two single readings (a gap between them): two dots, no path; beta has nothing.
    expect(out.match(/class="chart-dot"/g)).toHaveLength(2)
    expect(out).not.toContain('class="chart-line"')
    expect(out).toContain('r/alpha: from 1 on Nov 6 to 3 on Nov 8')
    expect(out).toContain('r/beta: no readings.')
  })
  it('shows a missing reading as "no reading" in the table, never as zero', () => {
    const out = html(createElement(LineChart, { days, series, unit: 'Score' }))
    expect(out).toContain('no reading')
    expect(out).not.toMatch(/<td>0<\/td>/)
  })
  it('draws consecutive readings as one path', () => {
    const out = html(createElement(LineChart, { days, series: [{ key: 'a', label: 'r/alpha', values: [1, 2, 3] }], unit: 'Score' }))
    expect(out.match(/class="chart-line"/g)).toHaveLength(1)
    expect(out).not.toContain('chart-legend')
  })
  it('keeps to four lines and says so', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ key: `s${i}`, label: `r/s${i}`, values: [1, 2, 3] as (number | null)[] }))
    const out = html(createElement(LineChart, { days, series: many, unit: 'Score' }))
    expect(out.match(/class="chart-line"/g)).toHaveLength(4)
    expect(out).toContain('Showing 4 of 6 channels')
  })
  it('survives no series and no days', () => {
    expect(() => html(createElement(LineChart, { days: [], series: [], unit: 'Score' }))).not.toThrow()
    expect(html(createElement(LineChart, { days, series: [], unit: 'Score' }))).not.toContain('NaN')
  })
})
