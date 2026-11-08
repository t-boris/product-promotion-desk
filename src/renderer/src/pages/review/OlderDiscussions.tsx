import { useState } from 'react'
import type { Channel, Id } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Loading, formatTime } from '../../ui'
import { isHttpUrl } from './labels'

const MAX_SHOWN = 100

/**
 * Discussions that already existed when the channel was first observed. They are only recorded, never answered
 * on their own; the owner can pick the ones worth working on, which turns their existing comments into items to
 * review (SRC-001 section 3). Nothing is posted without the usual approval.
 */
export function OlderDiscussions({ channel }: { channel: Channel }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const list = useQuery('channels.discussions', { channelId: channel.id }, ['opportunities', 'channels'])
  const [select, selecting] = useAction((id: Id, selected: boolean) => call('channels.selectOlder', { channelId: channel.id, discussionIds: [id], selected }))

  const needle = search.trim().toLowerCase()
  const matching = (list.data ?? []).filter((d) => !needle || d.title.toLowerCase().includes(needle) || d.author.toLowerCase().includes(needle))
  const chosen = (list.data ?? []).filter((d) => d.selectedForProcessing).length

  return (
    <Card
      title="Older discussions"
      actions={
        <Button onClick={() => setOpen(!open)} data-testid="toggle-older">
          {open ? 'Hide' : `Show${list.data ? ` (${list.data.length})` : ''}`}
        </Button>
      }
    >
      <p className="muted small">
        {channel.baselineDoneAt
          ? `Discussions that existed before this channel was activated are only recorded, never answered automatically. Choose the ones you want to work on and their existing comments become items to review.${chosen ? ` ${chosen} chosen.` : ''}`
          : 'The first look at this channel has not finished yet. Older discussions appear here once it has.'}
      </p>
      {open && (
        <div className="stack">
          <Field label="Find">
            <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or author" data-testid="older-search" />
          </Field>
          <ErrorNote error={list.error ?? selecting.error} />
          {list.loading && !list.data && <Loading what="Loading discussions" />}
          {list.data?.length === 0 && <EmptyState title="No discussions recorded yet" />}
          {matching.slice(0, MAX_SHOWN).map((d) => (
            <label key={d.id} className="list-row" data-testid={`older-${d.id}`}>
              <span className="row" style={{ flex: 1 }}>
                <input type="checkbox" checked={d.selectedForProcessing} disabled={selecting.busy || !channel.baselineDoneAt} onChange={(e) => void select(d.id, e.target.checked)} data-testid={`older-check-${d.id}`} />
                <span>
                  <strong>{d.title || 'Untitled post'}</strong>
                  <span className="muted small"> by {d.author} · last seen {formatTime(d.lastSeenAt)}</span>
                </span>
              </span>
              <span className="row">
                {d.selectedForProcessing && <Badge tone="info">Chosen</Badge>}
                {isHttpUrl(d.url) && (
                  <a href={d.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                )}
              </span>
            </label>
          ))}
          {matching.length > MAX_SHOWN && <div className="muted small">Showing the first {MAX_SHOWN} of {matching.length}. Narrow the search to see others.</div>}
        </div>
      )}
    </Card>
  )
}
