import { linePaths, linearScale } from './geometry'
import './charts.css'

const PAD_X = 6
const PAD_Y = 6

/**
 * A small line of one metric for a channel tile: the line in the muted ink, the latest reading as the accent dot. A reading that is
 * missing breaks the line; a series with no reading at all shows a dash, never a flat line at zero. Text alternative: label and latest value.
 */
export function Sparkline({ values, label, width = 96, height = 28 }: { values: (number | null)[]; label: string; width?: number; height?: number }) {
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v))
  if (known.length === 0) {
    return (
      <span className="chart-empty" role="img" aria-label={`${label}: no readings`}>
        –
      </span>
    )
  }
  const x = linearScale(0, Math.max(values.length - 1, 1), PAD_X, width - PAD_X)
  const y = linearScale(Math.min(...known), Math.max(...known), height - PAD_Y, PAD_Y)
  const runs = linePaths(values.map((v, i) => ({ x: x(i), y: v === null || !Number.isFinite(v) ? null : y(v) })))
  const lastRun = runs[runs.length - 1]
  const last = lastRun.points[lastRun.points.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${known.length} readings, latest ${known[known.length - 1]}`} data-testid="sparkline">
      {runs.map((run, i) => run.d && <path key={i} className="spark-line" d={run.d} />)}
      <circle className="spark-dot" cx={last.x} cy={last.y} r={4} />
    </svg>
  )
}
