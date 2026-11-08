import type { ResultsView } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, formatTime } from '../../ui'
import { metricDisplay } from './format'

type ChannelResults = ResultsView['channels'][number]

/** One channel's latest platform metrics. "Unavailable" is a state of its own and is never rendered as 0. */
export function MetricsCard({ entry }: { entry: ChannelResults }) {
  const { channel, metrics } = entry
  const [refresh, state] = useAction(() => call('results.refresh', { channelId: channel.id }))
  const capability = channel.capabilities.find((c) => c.key === 'metrics')
  const capturedAt = metrics[0]?.capturedAt ?? null

  return (
    <Card
      title={`${channel.target} (${channel.platform})`}
      actions={
        <Button onClick={() => void refresh()} disabled={state.busy} data-testid={`refresh-${channel.id}`}>
          {state.busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    >
      <ErrorNote error={state.error} />
      {capability && capability.status !== 'verified' && (
        <p className="muted small">
          Metrics for this channel: {capability.status.replace('_', ' ')}
          {capability.detail ? `. ${capability.detail}` : ''}
        </p>
      )}
      {metrics.length === 0 ? (
        <p className="muted" data-testid={`no-metrics-${channel.id}`}>No metrics captured yet. Press Refresh to read them from the platform.</p>
      ) : (
        <>
          <table className="table" data-testid={`metrics-${channel.id}`}>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => {
                const shown = metricDisplay(metric)
                return (
                  <tr key={metric.id}>
                    <td>{metric.label}</td>
                    <td data-testid={`metric-${channel.id}-${metric.key}`}>
                      {shown !== null ? (
                        shown
                      ) : (
                        <span title="The platform does not provide this metric. This is not a zero.">
                          <Badge tone="neutral">Unavailable</Badge>
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small">As of {formatTime(capturedAt)}</p>
        </>
      )}
    </Card>
  )
}
