import { axisFormatter, dayLabel, describeSeries, formatNumber, linePaths, linearScale, niceTicks, type LineSeries } from './geometry'
import { ChartLegend, ChartTable, ChartTip, useChartCursor, type LegendItem } from './parts'
import { useChartWidth } from './use-chart-width'
import './charts.css'

export type { LineSeries }

const PAD = { left: 44, right: 12, top: 8, bottom: 24 }
/** At most this many lines: the fifth would be a colour nobody can tell from the others. */
export const MAX_LINES = 4

/**
 * One metric over the days, a line for each series (a channel). Colour follows the series' place in the list given, so the caller keeps
 * the order stable. A missing reading breaks the line and is "no reading" in the readout, never zero. Hover or arrow keys give a day.
 */
export function LineChart({ days, series, unit, height = 200 }: { days: string[]; series: LineSeries[]; unit: string; height?: number }) {
  const shown = series.slice(0, MAX_LINES)
  const [ref, width] = useChartWidth()
  const cursor = useChartCursor(days.length)
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const known = shown.flatMap((s) => s.values).filter((v): v is number => v !== null)
  const ticks = niceTicks(known.length ? Math.min(...known) : 0, known.length ? Math.max(...known) : 1, 4)
  const y = linearScale(ticks[0], ticks[ticks.length - 1], PAD.top + plotH, PAD.top)
  const x = linearScale(0, Math.max(days.length - 1, 1), PAD.left, PAD.left + plotW)
  const step = days.length > 1 ? plotW / (days.length - 1) : plotW
  const every = Math.max(1, Math.ceil(72 / Math.max(step, 1)))
  const format = axisFormatter(ticks)
  const legend: LegendItem[] = shown.map((s, i) => ({ key: s.key, label: s.label, slot: (i + 1) as 1 | 2 | 3 | 4, shape: 'line' }))

  return (
    <div className="chart" data-testid="metric-chart">
      <div className="chart-surface" ref={ref}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          tabIndex={0}
          role="img"
          aria-label={`${unit} over ${days.length} days. ${shown.map((s) => describeSeries(s.label, s.values.map((value, i) => ({ day: days[i], value })))).join(' ')} Arrow keys move through the days.`}
          onKeyDown={cursor.onKeyDown}
          onBlur={() => cursor.set(null)}
          onPointerLeave={() => cursor.set(null)}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const at = Math.round((event.clientX - box.left - PAD.left) / Math.max(step, 1))
            cursor.set(days.length > 0 ? Math.max(0, Math.min(days.length - 1, at)) : null)
          }}
        >
          <g className="chart-grid">
            {ticks.map((tick) => (
              <line key={tick} x1={PAD.left} x2={PAD.left + plotW} y1={y(tick)} y2={y(tick)} />
            ))}
          </g>
          <g className="chart-axis">
            {ticks.map((tick) => (
              <text key={tick} x={PAD.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">
                {format(tick)}
              </text>
            ))}
            {days.map((day, i) =>
              i % every === 0 ? (
                <text key={day} x={x(i)} y={height - 6} textAnchor="middle">
                  {dayLabel(day)}
                </text>
              ) : null
            )}
          </g>
          {cursor.index !== null && <line className="chart-cursor" x1={x(cursor.index)} x2={x(cursor.index)} y1={PAD.top} y2={PAD.top + plotH} />}
          {shown.map((s, si) => {
            const runs = linePaths(s.values.map((value, i) => ({ x: x(i), y: value === null ? null : y(value) })))
            const color = `var(--series-${si + 1})`
            return (
              <g key={s.key}>
                {runs.map((run, i) => run.d && <path key={i} className="chart-line" stroke={color} d={run.d} />)}
                {runs.filter((run) => run.points.length === 1).map((run) => <circle key={run.points[0].x} className="chart-dot" fill={color} cx={run.points[0].x} cy={run.points[0].y} r={4} />)}
                {cursor.index !== null && s.values[cursor.index] !== null && <circle className="chart-dot" fill={color} cx={x(cursor.index)} cy={y(s.values[cursor.index] as number)} r={4} />}
              </g>
            )
          })}
        </svg>
        {cursor.index !== null && (
          <ChartTip
            x={x(cursor.index)}
            width={width}
            head={dayLabel(days[cursor.index])}
            rows={shown.map((s, i) => ({
              key: s.key,
              label: s.label,
              value: s.values[cursor.index as number] === null ? 'no reading' : formatNumber(s.values[cursor.index as number] as number),
              slot: (i + 1) as 1 | 2 | 3 | 4,
              shape: 'line'
            }))}
          />
        )}
      </div>
      <ChartLegend items={legend} />
      {series.length > MAX_LINES && <p className="chart-empty">Showing {MAX_LINES} of {series.length} channels; the others are in each channel's own tile.</p>}
      <ChartTable head={['Day', ...shown.map((s) => s.label)]} rows={days.map((day, i) => [dayLabel(day), ...shown.map((s) => (s.values[i] === null ? 'no reading' : formatNumber(s.values[i] as number)))])} />
    </div>
  )
}
