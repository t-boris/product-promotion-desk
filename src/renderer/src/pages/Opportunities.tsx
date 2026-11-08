import { useState } from 'react'
import type { Id, OpportunityState } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Button, Card, EmptyState, ErrorNote, Field, Loading, Page } from '../ui'
import { OlderDiscussions } from './review/OlderDiscussions'
import { ReviewCard } from './review/ReviewCard'

type Filter = 'open' | 'sent' | 'closed' | 'all'

const FILTERS: { id: Filter; label: string; states?: OpportunityState[] }[] = [
  { id: 'open', label: 'In progress', states: ['discovered', 'analyzing', 'draft', 'awaiting_approval', 'ready', 'sending', 'needs_user', 'error', 'deferred', 'unknown_result'] },
  { id: 'sent', label: 'Sent', states: ['confirmed'] },
  { id: 'closed', label: 'No reply or cancelled', states: ['no_reply', 'cancelled'] },
  { id: 'all', label: 'All' }
]

export function OpportunitiesPage() {
  const channels = useQuery('channels.list', undefined, ['channels'])
  const [channelId, setChannelId] = useState<Id | ''>('')
  const [filter, setFilter] = useState<Filter>('open')
  const states = FILTERS.find((f) => f.id === filter)?.states
  const list = useQuery('opportunities.list', { channelId: channelId || undefined, kind: 'reply', states }, ['opportunities'])
  const [checkNow, checking] = useAction(async (id: Id) => call('channels.checkNow', { channelId: id }))
  const [lastRun, setLastRun] = useState<string | null>(null)

  const selected = channels.data?.find((c) => c.id === channelId)

  return (
    <Page title="Opportunities" subtitle="Comments found in your channels, what happened to each, and older discussions you choose to work on">
      <Card>
        <div className="row">
          <Field label="Channel">
            <select className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)} data-testid="channel-filter">
              <option value="">All channels</option>
              {channels.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.target}
                </option>
              ))}
            </select>
          </Field>
          <div className="row" role="group" aria-label="State filter">
            {FILTERS.map((f) => (
              <Button key={f.id} variant={filter === f.id ? 'primary' : 'ghost'} onClick={() => setFilter(f.id)} data-testid={`filter-${f.id}`}>
                {f.label}
              </Button>
            ))}
          </div>
          {selected && (
            <Button
              onClick={() =>
                void checkNow(selected.id).then((run) => {
                  if (run) setLastRun(`${run.status}: ${run.summary}`)
                })
              }
              disabled={checking.busy}
              data-testid="check-now"
            >
              {checking.busy ? 'Checking…' : 'Check now'}
            </Button>
          )}
        </div>
        <ErrorNote error={channels.error ?? checking.error} />
        {lastRun && (
          <div className="muted small" data-testid="check-result">
            Last check: {lastRun}
          </div>
        )}
      </Card>

      {selected && <OlderDiscussions channel={selected} />}

      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading what="Loading" />}
      {list.data?.length === 0 && (
        <EmptyState title="Nothing here">
          {filter === 'open' ? 'New comments in your active channels show up here. A new channel starts with a first look that only records what already exists.' : 'No items match this filter.'}
        </EmptyState>
      )}
      <div className="stack" data-testid="opportunity-list">
        {list.data?.map((card) => (
          <ReviewCard key={card.opportunity.id} card={card} collapsible defaultOpen={false} />
        ))}
      </div>
    </Page>
  )
}
