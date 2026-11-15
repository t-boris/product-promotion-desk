// The pieces the charts share: legend, tooltip, the table view and the keyboard cursor. Labels come from data, so they are only
// ever rendered as text (React escapes them); nothing here sets HTML.

import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Disclosure } from '../ui'

export interface LegendItem {
  key: string
  label: string
  /** Which `--series-N` colour. */
  slot: 1 | 2 | 3 | 4
  /** A rectangle for bars, a short line for lines. */
  shape: 'rect' | 'line'
}

/** Names the series. Always shown for two series or more; a single series is named by the chart's title. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null
  return (
    <ul className="chart-legend" data-testid="chart-legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className={`chart-key chart-key-${item.shape}`} style={{ background: `var(--series-${item.slot})` }} aria-hidden="true" />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

export interface TipRow {
  key: string
  label: string
  value: string
  slot: 1 | 2 | 3 | 4
  shape: 'rect' | 'line'
}

/** One readout for every series at the chosen day, the value first and strong. `x` is the pixel the readout is centred on. */
export function ChartTip({ x, width, head, rows }: { x: number; width: number; head: string; rows: TipRow[] }) {
  // Keep the box inside the chart: it is about 168px wide, so it flips to the left of the cursor near the right edge.
  const flip = x > width - 180
  return (
    <div className="chart-tip" aria-hidden="true" style={flip ? { right: Math.max(0, width - x + 12) } : { left: x + 12 }} data-testid="chart-tip">
      <div className="chart-tip-head">{head}</div>
      {rows.map((row) => (
        <div className="chart-tip-row" key={row.key}>
          <span className={`chart-key chart-key-${row.shape}`} style={{ background: `var(--series-${row.slot})` }} aria-hidden="true" />
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  )
}

/** Every value of the chart, as a table: what the hover shows is also here, without a pointer. */
export function ChartTable({ title = 'Table view', head, rows }: { title?: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <Disclosure title={title}>
      <table className="chart-table">
        <thead>
          <tr>
            {head.map((cell, at) => (
              <th key={`${at}:${cell}`} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </Disclosure>
  )
}

/**
 * The position of the cursor on the chart's days, moved by the pointer or by the arrow keys (one tab stop for the whole chart).
 * `null` is no cursor. Home and End jump to the ends, Escape lets go.
 */
export function useChartCursor(count: number): { index: number | null; set: (index: number | null) => void; onKeyDown: (event: KeyboardEvent) => void } {
  const [index, setIndex] = useState<number | null>(null)
  const clamp = (value: number): number => Math.max(0, Math.min(count - 1, value))
  const onKeyDown = (event: KeyboardEvent): void => {
    if (count === 0) return
    const next = (value: number | null): number | null => {
      switch (event.key) {
        case 'ArrowLeft':
          return value === null ? count - 1 : clamp(value - 1)
        case 'ArrowRight':
          return value === null ? 0 : clamp(value + 1)
        case 'Home':
          return 0
        case 'End':
          return count - 1
        case 'Escape':
          return null
        default:
          return value
      }
    }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) {
      event.preventDefault()
      setIndex((value) => next(value))
    }
  }
  return { index: index === null ? null : clamp(index), set: setIndex, onKeyDown }
}
