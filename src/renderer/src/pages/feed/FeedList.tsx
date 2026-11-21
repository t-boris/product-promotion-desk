import { useEffect, useRef, type ReactNode } from 'react'
import { Badge } from '../../ui'
import { relativeTime } from '../inbox/inbox-groups'
import { PROPOSAL_LABEL, SOURCE_LABEL, type FeedDay } from './feed-filter'
import { FIRST_LOOK, isFindingRow, type FindingRow, type ListedRow } from './finding-rows'
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
 * rows and group titles, so the two lists read as one. The same list shows the findings of the Noted tab and of the AI's skipped posts
 * (`FindingRow`s, under the day the post was written): a list holds one kind of row, and the selection and the keys work on either.
 */
export function FeedList({
  days,
  rows,
  selectedId,
  onSelect,
  label = 'Items in the feed',
  now = new Date(),
  footer
}: {
  days: FeedDay[]
  rows: ReadonlyMap<string, ListedRow>
  selectedId: string | null
  onSelect: (id: string) => void
  /** What a screen reader calls the list. */
  label?: string
  /** The moment "how long ago" is counted from. */
  now?: Date
  /** Under the last row: the button that shows more of a long list. */
  footer?: ReactNode
}) {
  const list = useRef<HTMLDivElement>(null)
  // The selection moves with the arrow keys: the focus follows it when it was in the list, and the row is brought into view.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row) return
    if (list.current?.contains(document.activeElement)) row.focus()
    row.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  return (
    <div className="inbox-list feed-list" role="listbox" aria-label={label} ref={list} data-testid="opportunity-list">
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
            if (isFindingRow(row)) return <FindingRowButton key={id} row={row} selected={selected} onSelect={onSelect} now={now} />
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
      {footer}
    </div>
  )
}

/**
 * One finding: a ring or a filled dot (unread, bold title), the channel and how long ago the post was written, the title, and under
 * it the AI's line on the post, with the First look tag where the look-back found it. The row is neutral like every row; its selection is
 * the quiet fill. The AI's line is page-derived text: it is a text node, never markup.
 */
function FindingRowButton({ row, selected, onSelect, now }: { row: FindingRow; selected: boolean; onSelect: (id: string) => void; now: Date }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={`inbox-row feed-row finding-row${selected ? ' selected' : ''}${row.unseen ? ' unseen' : ''}`}
      onClick={() => onSelect(row.id)}
      data-testid={`finding-row-${row.id}`}
      data-label={row.label ?? ''}
      data-unseen={row.unseen}
    >
      <span className="inbox-row-top">
        <span className="dot" aria-hidden="true" />
        <span className="inbox-row-channel">{row.where}</span>
        <span className="inbox-row-time">{relativeTime(row.at, now)}</span>
      </span>
      <span className="inbox-row-text">
        {row.unseen && <span className="sr-only">Unread. </span>}
        {row.unseen ? <strong>{row.title}</strong> : row.title}
      </span>
      <span className="feed-row-ai">
        {row.firstLook && <Badge>{FIRST_LOOK}</Badge>}
        <span className="feed-row-relation">{row.relation}</span>
      </span>
    </button>
  )
}
