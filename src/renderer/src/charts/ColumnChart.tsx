import { axisFormatter, columnLayout, dayLabel, formatNumber, linearScale, niceTicks, roundedEndPath, stackSegments } from './geometry'
import { ChartLegend, ChartTable, ChartTip, useChartCursor, type LegendItem } from './parts'
import { useChartWidth } from './use-chart-width'
import './charts.css'

export interface ColumnDay {
  day: string
  replies: number
  posts: number
}

const PAD = { left: 40, right: 8, top: 8, bottom: 24 }
const LEGEND: LegendItem[] = [
  { key: 'replies', label: 'Replies', slot: 1, shape: 'rect' },
  { key: 'posts', label: 'Own posts', slot: 2, shape: 'rect' }
]

/**
 * What was sent each day: replies and own posts stacked, both counts of the same unit on one axis. Columns are at most 24px thick, a
 * 2px gap of surface sits between the two segments and only the top of a column is rounded. Hover or arrow keys give the readout of a day.
 */
export function ColumnChart({ days, height = 180 }: { days: ColumnDay[]; height?: number }) {
  const [ref, width] = useChartWidth()
  const cursor = useChartCursor(days.length)
  const plotW = width - PAD.left - PAD.right
  const plotH = height - PAD.top - PAD.bottom
  const top = Math.max(0, ...days.map((d) => d.replies + d.posts))
  const ticks = niceTicks(0, top, 4, { includeZero: true, whole: true })
  const yMax = ticks[ticks.length - 1]
  const y = linearScale(0, yMax, PAD.top + plotH, PAD.top)
  const scale = plotH / yMax
  const layout = columnLayout(days.length, plotW)
  const slot = days.length > 0 ? plotW / days.length : plotW
  const every = Math.max(1, Math.ceil(64 / Math.max(slot, 1)))
  const format = axisFormatter(ticks)
  const active = cursor.index === null ? null : days[cursor.index]
  const activeX = cursor.index === null ? 0 : PAD.left + layout[cursor.index].x + layout[cursor.index].width / 2
  const total = days.reduce((sum, d) => sum + d.replies + d.posts, 0)

  return (
    <div className="chart" data-testid="activity-chart">
      <div className="chart-surface" ref={ref}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          tabIndex={0}
          role="img"
          aria-label={`Sent each day: ${formatNumber(days.reduce((s, d) => s + d.replies, 0))} replies and ${formatNumber(days.reduce((s, d) => s + d.posts, 0))} own posts in ${days.length} days. Arrow keys move through the days.`}
          onKeyDown={cursor.onKeyDown}
          onBlur={() => cursor.set(null)}
          onPointerLeave={() => cursor.set(null)}
          onPointerMove={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const at = Math.floor((event.clientX - box.left - PAD.left) / slot)
            cursor.set(at >= 0 && at < days.length ? at : null)
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
            {days.map((d, i) =>
              i % every === 0 ? (
                <text key={d.day} x={PAD.left + layout[i].x + layout[i].width / 2} y={height - 6} textAnchor="middle">
                  {dayLabel(d.day)}
                </text>
              ) : null
            )}
          </g>
          {cursor.index !== null && <rect className="chart-band" x={PAD.left + cursor.index * slot} y={PAD.top} width={slot} height={plotH} />}
          {days.map((d, i) =>
            stackSegments([d.replies, d.posts], PAD.top + plotH, scale).map((rect) => {
              const x = PAD.left + layout[i].x
              const fill = `var(--series-${rect.series + 1})`
              return rect.top ? (
                <path key={`${d.day}-${rect.series}`} className="chart-seg" fill={fill} d={roundedEndPath(x, rect.y, layout[i].width, rect.height, 4, 'top')} />
              ) : (
                <rect key={`${d.day}-${rect.series}`} className="chart-seg" fill={fill} x={x} y={rect.y} width={layout[i].width} height={rect.height} />
              )
            })
          )}
        </svg>
        {active && (
          <ChartTip
            x={activeX}
            width={width}
            head={dayLabel(active.day)}
            rows={[
              { key: 'replies', label: 'Replies', value: formatNumber(active.replies), slot: 1, shape: 'rect' },
              { key: 'posts', label: 'Own posts', value: formatNumber(active.posts), slot: 2, shape: 'rect' }
            ]}
          />
        )}
      </div>
      <ChartLegend items={LEGEND} />
      {total === 0 && <p className="chart-empty">Nothing was sent in this period.</p>}
      <ChartTable head={['Day', 'Replies', 'Own posts']} rows={days.map((d) => [dayLabel(d.day), formatNumber(d.replies), formatNumber(d.posts)])} />
    </div>
  )
}
