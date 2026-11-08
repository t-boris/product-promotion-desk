import { useState } from 'react'
import { call, useAction, useQuery } from '../hooks'
import { Button, EmptyState, ErrorNote, Loading, Page } from '../ui'
import { ConversionsNote } from './results/ConversionsNote'
import { GoalsCard } from './results/GoalsCard'
import { MetricsCard } from './results/MetricsCard'

export function ResultsPage() {
  const [productId, setProductId] = useState('')
  const products = useQuery('products.list', undefined, ['products'])
  const results = useQuery('results.get', productId ? { productId } : {}, ['results', 'products', 'channels'])
  const [refreshAll, all] = useAction(async () => {
    for (const entry of results.data?.channels ?? []) await call('results.refresh', { channelId: entry.channel.id })
  })

  const channels = results.data?.channels ?? []

  return (
    <Page
      title="Results"
      subtitle="Promotion goals and the metrics each platform provides"
      actions={
        <>
          <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Product" data-testid="results-product">
            <option value="">All products</option>
            {products.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button onClick={() => void refreshAll()} disabled={all.busy || channels.length === 0} data-testid="refresh-all">
            {all.busy ? 'Refreshing…' : 'Refresh all'}
          </Button>
        </>
      }
    >
      <ConversionsNote />
      <ErrorNote error={results.error ?? all.error} />
      {results.loading && !results.data && <Loading what="Loading results" />}
      {results.data && <GoalsCard goals={results.data.goals} />}
      {results.data && channels.length === 0 && (
        <EmptyState title="No channels yet">Connect a channel on the Channels page to see the metrics its platform provides.</EmptyState>
      )}
      {channels.map((entry) => (
        <MetricsCard key={entry.channel.id} entry={entry} />
      ))}
    </Page>
  )
}
