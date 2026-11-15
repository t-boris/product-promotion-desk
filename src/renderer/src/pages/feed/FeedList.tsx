import { useEffect, useRef } from 'react'
import { PROPOSAL_LABEL, SOURCE_LABEL, type FeedDay, type FeedRow } from './feed-filter'
import '../inbox/inbox.css'
import './feed.css'

/** The time of day a row is listed at, in the viewer's own way of writing it; the day is the heading above. */
function timeOfDay(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '—' : at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * The left pane: the items under the local day they were found (a sent reply, the day it went out). A row is the channel, the time, who and
 * the first words, and under them where it came from and what the AI proposes, with a dot for the state. The list is a listbox: the owner
 * moves through it with the arrow keys (the page handles them), and the selected row is the one the detail shows. It wears the Inbox's
 * rows and group titles, so the two lists read as one.
 */
export function FeedList({ days, rows, selectedId, onSelect }: { days: FeedDay[]; rows: ReadonlyMap<string, FeedRow>; selectedId: string | null; onSelect: (id: string) => void }) {
  const list = useRef<HTMLDivElement>(null)
  // The selection moves with the arrow keys: the focus follows it when it was in the list, and the row is brought into view.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row) return
    if (list.current?.contains(document.activeElement)) row.focus()
    row.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  return (
    <div className="inbox-list feed-list" role="listbox" aria-label="Items in the feed" ref={list} data-testid="opportunity-list">
      {days.map((day) => (
        <div key={day.day || 'earlier'} className="inbox-group" role="group" aria-label={day.label} data-testid={`feed-day-${day.day || 'earlier'}`}>
          {/* The group is named by its label; a listbox may hold only options and groups, so the visible title is not a heading for a screen reader. */}
          <h2 className="inbox-group-title" aria-hidden="true">
            {day.label} <span className="inbox-group-count">{day.ids.length}</span>
          </h2>
          {day.ids.map((id) => {
            const row = rows.get(id)
            if (!row) return null
            const selected = id === selectedId
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`inbox-row feed-row${selected ? ' selected' : ''}`}
                onClick={() => onSelect(id)}
                data-testid={`feed-row-${id}`}
                data-source={row.source}
                data-proposal={row.proposal}
              >
                <span className="inbox-row-top">
                  <span className={`dot ${row.tone}`} aria-hidden="true" />
                  <span className="inbox-row-channel">{row.where}</span>
                  <span className="inbox-row-time">{timeOfDay(row.at)}</span>
                </span>
                <span className="inbox-row-text">
                  <strong>{row.who}</strong> {row.line}
                </span>
                <span className="feed-row-ai">
                  {SOURCE_LABEL[row.source]} · {PROPOSAL_LABEL[row.proposal]}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
