import { useMemo, useState } from 'react'
import { overviewSuggestions } from '../../../shared/overview-suggestions'
import type { Product } from '../../../shared/types'
import { ColumnChart } from '../charts/ColumnChart'
import { FunnelBars } from '../charts/FunnelBars'
import { LineChart } from '../charts/LineChart'
import { call, useAction, useQuery } from '../hooks'
import { Button, Card, Disclosure, EmptyState, ErrorNote, Loading, SegmentedControl } from '../ui'
import { productHref } from '../route'
import { FixList } from './inbox/FixList'
import { fixItemsFor } from './inbox/inbox-groups'
import { ChannelTiles } from './overview/ChannelTiles'
import { unusedNoteCount } from './overview/overview-data'
import { useOverviewData } from './overview/useOverviewData'
import { Suggestions } from './overview/Suggestions'
import { ProductScreen } from './ProductScreen'
import { ConversionsNote } from './results/ConversionsNote'
import { GoalsCard } from './results/GoalsCard'
import { MetricsCard } from './results/MetricsCard'
import './overview/overview.css'
import './results/results.css'

type Period = '7' | '30'

/**
 * How the current product is doing (DEC-037, phase C): the path from found to sent for a period, the channels at a glance, the problems,
 * what the AI suggests, and what went out each day beside one metric over time. Every number is a count of rows the application keeps;
 * a reading the platform did not give is a gap in a chart, never a zero. Everything the old Results tab showed is still here, under "All metrics".
 */
export function OverviewPage() {
  const [period, setPeriod] = useState<Period>('30')
  return (
    <ProductScreen
      title="Overview"
      subtitle="How the product is doing"
      tab="results"
      withWebsite
      actions={
        <SegmentedControl<Period>
          label="Period"
          name="overview-period"
          testIdPrefix="overview-period-"
          value={period}
          onChange={setPeriod}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' }
          ]}
        />
      }
    >
      {(product) => <OverviewBody product={product} days={Number(period)} />}
    </ProductScreen>
  )
}

function OverviewBody({ product, days }: { product: Product; days: number }) {
  const { view, channels, days: dayList, metric, lines, error: overviewError } = useOverviewData(product.id, days)
  const results = useQuery('results.get', { productId: product.id }, ['results', 'products', 'channels'])
  const notes = useQuery('updates.list', { productId: product.id }, ['products', 'opportunities'])
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const [refreshAll, refreshing] = useAction(async () => {
    // A channel the app does not read has nothing to refresh, and one that cannot be refreshed must not stop the others (DEC-034).
    for (const entry of results.data?.channels ?? []) if (entry.channel.reads) await call('results.refresh', { channelId: entry.channel.id })
  })

  const suggestions = useMemo(() => (view ? overviewSuggestions({ overview: view, channels, unusedNotes: unusedNoteCount(notes.data ?? []), now: new Date() }) : []), [view, channels, notes.data])
  const problems = view ? fixItemsFor(view.attention, product.id, { channels, accounts: accounts.data ?? [] }) : []

  const error = overviewError ?? results.error
  if (!view) return error ? <ErrorNote error={error} /> : <Loading what="Loading overview" />
  const noChannels = view.channels.length === 0

  return (
    <div className="overview" data-testid="overview">
      <ErrorNote error={error} />
      {noChannels ? (
        <EmptyState
          art="channel"
          title="No channels for this product yet"
          action={
            <a className="btn" href={productHref(product.id, 'channels')} data-testid="results-channels-link">
              Connect a channel
            </a>
          }
        >
          The path from found to sent, the metrics of each channel and the AI's suggestions appear here once a channel is connected.
        </EmptyState>
      ) : (
        <>
          <div className="ov-grid">
            <Card title={`The last ${view.days} days`}>
              <FunnelBars funnel={view.funnel} days={view.days} />
              <p className="muted ov-note">Counted over the opportunities found in this period, so a step never holds more than the one before it. Only confirmed sends count.</p>
            </Card>
            <Card title="The AI suggests">
              <Suggestions suggestions={suggestions} />
            </Card>
          </div>

          <Card title="Channels">
            <ChannelTiles channels={view.channels} lines={lines} days={view.days} details={channels} />
          </Card>

          <div className="ov-grid">
            <Card title="What went out each day">
              {view.activity.some((day) => day.posts + day.replies > 0) ? <ColumnChart days={view.activity} /> : <p className="muted">Nothing was sent in this period.</p>}
            </Card>
            <Card title={metric ? `${metric.label} over time` : 'A metric over time'}>
              {metric ? <LineChart days={dayList} series={metric.lines} unit={metric.label} /> : <p className="muted" data-testid="overview-no-history">No metric has two days of readings in this period yet. The platforms give metrics when they are read; “All metrics” below reads them now.</p>}
            </Card>
          </div>

          {problems.length > 0 && <FixList items={problems} channels={channels} products={[product]} />}

          <Disclosure title="All metrics" testId="overview-all-metrics">
            <ErrorNote error={refreshing.error} />
            <div className="ov-metrics">
              <div>
                <Button onClick={() => void refreshAll()} disabled={refreshing.busy || (results.data?.channels.length ?? 0) === 0} data-testid="refresh-all">
                  {refreshing.busy ? 'Refreshing…' : 'Refresh all'}
                </Button>
              </div>
              {(results.data?.channels ?? []).map((entry) => (
                <MetricsCard key={entry.channel.id} entry={entry} />
              ))}
            </div>
          </Disclosure>
        </>
      )}
      <GoalsCard goals={results.data?.goals ?? []} />
      <ConversionsNote productId={product.id} />
    </div>
  )
}
