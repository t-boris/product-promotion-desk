import { describeFunnel, formatNumber, funnelRows, type FunnelInput } from './geometry'
import './charts.css'

/**
 * The four steps from "found" to "sent" as bars from one baseline, the value at the tip of each and the share of the step before
 * beside it. One series, so one colour and no legend. The list itself is the text alternative; the label says it as a sentence.
 */
export function FunnelBars({ funnel, days }: { funnel: FunnelInput; days: number }) {
  const rows = funnelRows(funnel)
  return (
    <ul className="funnel" aria-label={describeFunnel(funnel, days)} data-testid="funnel">
      {rows.map((row) => (
        <li key={row.key} data-testid={`funnel-${row.key}`}>
          <span className="funnel-label">{row.label}</span>
          <span className="funnel-track" aria-hidden="true">
            <span className="funnel-bar" style={{ width: `${row.widthPercent}%` }} />
          </span>
          <span className="funnel-value">
            {formatNumber(row.value)}
            {row.ofPrevious !== null && <span className="funnel-share">{row.ofPrevious}%</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
