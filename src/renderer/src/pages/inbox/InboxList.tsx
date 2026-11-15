import { useEffect, useRef } from 'react'
import type { OpportunityCard } from '../../../../shared/types'
import { relativeTime, rowSummary, type InboxSection } from './inbox-groups'

/**
 * The left pane of the Decide segment: compact rows under the groups. A row is the channel, who or what it is about, the first words
 * and how long ago, with a dot for the state. A row that no longer needs a decision stays, quieter, until it is dismissed. The list is a
 * listbox: the owner moves through it with the arrow keys (the page handles them), and the selected row is the one the detail shows.
 */
export function InboxList({
  sections,
  cards,
  waiting,
  selectedId,
  onSelect
}: {
  sections: InboxSection[]
  cards: ReadonlyMap<string, OpportunityCard>
  waiting: ReadonlySet<string>
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const now = new Date()
  const list = useRef<HTMLDivElement>(null)
  // The selection moves with the arrow keys: the focus follows it when it was in the list, and the row is brought into view.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row) return
    if (list.current?.contains(document.activeElement)) row.focus()
    row.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  return (
    <div className="inbox-list" role="listbox" aria-label="Items that need a decision" ref={list} data-testid="inbox-list">
      {sections.map((section) => (
        <div key={section.id} className="inbox-group" role="group" aria-label={section.label} data-testid={`inbox-group-${section.id}`}>
          {/* The group is named by its label; a listbox may hold only options and groups, so the visible title is not a heading for a screen reader. */}
          <h2 className="inbox-group-title" aria-hidden="true">
            {section.label} <span className="inbox-group-count">{section.ids.length}</span>
          </h2>
          {section.ids.map((id) => {
            const card = cards.get(id)
            if (!card) return null
            const row = rowSummary(card)
            const selected = id === selectedId
            const done = !waiting.has(id)
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`inbox-row${selected ? ' selected' : ''}${done ? ' done' : ''}`}
                onClick={() => onSelect(id)}
                data-testid={`inbox-row-${id}`}
              >
                <span className="inbox-row-top">
                  <span className={`dot ${done ? '' : row.tone}`} aria-hidden="true" />
                  <span className="inbox-row-channel">{row.channel}</span>
                  <span className="inbox-row-time">{done ? 'done' : relativeTime(row.at, now)}</span>
                </span>
                <span className="inbox-row-text">
                  <strong>{row.who}</strong> {row.excerpt}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
