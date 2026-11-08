import { useState } from 'react'
import type { Id } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Loading, Page } from '../ui'
import { PublicationForm } from './review/PublicationForm'
import { ReviewCard } from './review/ReviewCard'

const CLOSED = ['confirmed', 'cancelled']

export function PublicationsPage() {
  const channels = useQuery('channels.list', undefined, ['channels'])
  const [chosen, setChosen] = useState<Id | ''>('')
  const channelId = chosen || channels.data?.[0]?.id || ''
  const channel = channels.data?.find((c) => c.id === channelId)
  const list = useQuery('opportunities.list', { channelId: channelId || undefined, kind: 'standalone' }, ['opportunities'])
  const [writing, setWriting] = useState(false)
  const [suggest, suggesting] = useAction(async () => {
    if (channelId) await call('publications.suggest', { channelId })
  })

  const postAbility = channel?.capabilities.find((c) => c.key === 'publish_post')
  const cannotPost = postAbility && (postAbility.status === 'unavailable' || postAbility.status === 'restricted')
  const cards = channelId ? (list.data ?? []) : []
  const pending = cards.filter((c) => !CLOSED.includes(c.opportunity.state))
  const sent = cards.filter((c) => c.opportunity.state === 'confirmed')
  const cancelled = cards.filter((c) => c.opportunity.state === 'cancelled')

  return (
    <Page title="Publications" subtitle="Drafts, scheduled and sent material">
      <Card>
        <div className="row">
          <Field label="Channel">
            <select className="input" value={channelId} onChange={(e) => setChosen(e.target.value)} data-testid="publication-channel">
              {channels.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.target}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="primary" onClick={() => void suggest()} disabled={!channelId || suggesting.busy} data-testid="suggest-publication">
            {suggesting.busy ? 'Asking the AI…' : 'Suggest with AI'}
          </Button>
          <Button onClick={() => setWriting(true)} disabled={!channelId || writing} data-testid="write-publication">
            Write one myself
          </Button>
        </div>
        <ErrorNote error={channels.error ?? suggesting.error} />
        {cannotPost && (
          <div className="row" data-testid="post-warning">
            <Badge tone="warn">Posting not available</Badge>
            <span className="muted small">
              Publishing posts is {postAbility.status} in this channel{postAbility.detail ? `: ${postAbility.detail}` : ''}. You can still prepare drafts.
            </span>
          </div>
        )}
        <p className="muted small">
          The AI proposes a topic and a draft from your approved product knowledge and the channel's rules. Every publication needs your own approval; the automatic rules never publish posts.
        </p>
      </Card>

      {channels.data?.length === 0 && <EmptyState title="No channels yet">Connect a channel first; publications are written for a specific channel.</EmptyState>}

      {writing && channelId && <PublicationForm channelId={channelId} onCreated={() => setWriting(false)} onCancel={() => setWriting(false)} />}

      <ErrorNote error={list.error} />
      {list.loading && !list.data && <Loading what="Loading" />}

      {channelId && list.data && (
        <>
          <section className="stack" data-testid="pending-publications">
            <h2>Drafts, approved and scheduled</h2>
            {pending.length === 0 && <EmptyState title="No drafts">Ask the AI for a suggestion or write one yourself.</EmptyState>}
            {pending.map((card) => (
              <ReviewCard key={card.opportunity.id} card={card} collapsible defaultOpen={pending.length === 1} />
            ))}
          </section>
          {sent.length > 0 && (
            <section className="stack" data-testid="sent-publications">
              <h2>Sent</h2>
              {sent.map((card) => (
                <ReviewCard key={card.opportunity.id} card={card} collapsible defaultOpen={false} />
              ))}
            </section>
          )}
          {cancelled.length > 0 && (
            <section className="stack">
              <h2>Rejected</h2>
              {cancelled.map((card) => (
                <ReviewCard key={card.opportunity.id} card={card} collapsible defaultOpen={false} />
              ))}
            </section>
          )}
        </>
      )}
    </Page>
  )
}
