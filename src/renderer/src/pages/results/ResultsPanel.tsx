import { call, useAction, useQuery } from '../../hooks'
import { Button, EmptyState, ErrorNote, Hint, Loading } from '../../ui'
import { productHref } from '../../route'
import { ConversionsNote } from './ConversionsNote'
import { GoalsCard } from './GoalsCard'
import { MetricsCard } from './MetricsCard'

/**
 * Results of one product (DEC-009): its promotion goal and the metrics each of its channels' platforms provide.
 * Nothing about other products is requested or shown. Version 1 does not measure business conversions, and a
 * metric the platform did not provide is "Unavailable", never zero (REQ-006, DEC-002).
 */
export function ResultsPanel({ productId }: { productId: string }) {
  const results = useQuery('results.get', { productId }, ['results', 'products', 'channels'])
  const [refreshAll, all] = useAction(async () => {
    for (const entry of results.data?.channels ?? []) await call('results.refresh', { channelId: entry.channel.id })
  })

  const channels = results.data?.channels ?? []

  return (
    <div className="stack" data-testid="results-panel">
      <div className="row">
        <Button onClick={() => void refreshAll()} disabled={all.busy || channels.length === 0} data-testid="refresh-all">
          {all.busy ? 'Refreshing…' : 'Refresh all'}
        </Button>
        <Hint>{channels.length === 0 ? 'No channels to refresh yet.' : 'Reads the latest metrics from each channel’s platform.'}</Hint>
      </div>
      <ErrorNote error={results.error ?? all.error} />
      {results.loading && !results.data && <Loading what="Loading results" />}
      {results.data && <GoalsCard goals={results.data.goals} />}
      {results.data && channels.length === 0 && (
        <EmptyState
          title="No channels for this product yet"
          action={
            <a className="btn btn-primary" href={productHref(productId, 'channels')} data-testid="results-channels-link">
              Connect a channel
            </a>
          }
        >
          Metrics appear here once a channel is connected: the platform provides them.
        </EmptyState>
      )}
      {channels.map((entry) => (
        <MetricsCard key={entry.channel.id} entry={entry} />
      ))}
      {/* A standing caveat, folded to one line: it used to take more room than the goal above it. */}
      <ConversionsNote />
    </div>
  )
}
