import { useEffect, useRef } from 'react'
import { filterRows, platformChips, rowLine, type ChannelRow } from './channels-list'

/**
 * The left pane of Channels: a search box, the platforms as chips with how many channels each has, and one row for each channel (a dot for how it
 * stands, its address, the platform and a note, and how many posts wait there). A list, never tiles: a channel is found in a second however many
 * there are. The list is a listbox the owner walks with the arrow keys (the screen handles them); the shown row is the channel open beside it.
 */
export function ChannelsList({
  rows,
  shownId,
  platform,
  search,
  onSelect,
  onPlatform,
  onSearch
}: {
  /** Every channel of the product, in the list's order. */
  rows: ChannelRow[]
  /** The channel whose page is open beside the list, or null (the add flow is open, or none is). */
  shownId: string | null
  platform: string | null
  search: string
  onSelect: (id: string) => void
  onPlatform: (platform: string | null) => void
  onSearch: (text: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  const visible = filterRows(rows, platform, search)
  const chips = platformChips(rows)
  // The shown row stays in view, and keeps the focus when the arrow keys moved it.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row) return
    if (list.current?.contains(document.activeElement)) row.focus()
    row.scrollIntoView({ block: 'nearest' })
  }, [shownId])
  // One row is in the Tab order (the shown one, or the first when none is shown).
  const tabbable = visible.some((r) => r.id === shownId) ? shownId : (visible[0]?.id ?? null)
  return (
    <div className="channels-list-col" data-testid="channels-list-col">
      <input className="input" type="search" value={search} placeholder="Search channels" aria-label="Search channels" onChange={(e) => onSearch(e.target.value)} data-testid="channels-search" />
      {chips.length > 2 && (
        <div className="segmented channels-chips" role="group" aria-label="Platform" data-testid="channels-chips">
          {chips.map((chip) => (
            <button
              key={chip.key ?? 'all'}
              type="button"
              className={`segmented-option${chip.key === platform ? ' on' : ''}`}
              aria-pressed={chip.key === platform}
              onClick={() => onPlatform(chip.key === platform ? null : chip.key)}
              data-testid={`channels-chip-${chip.key ?? 'all'}`}
            >
              {chip.label} {chip.count}
            </button>
          ))}
        </div>
      )}
      <div className="channels-list" role="listbox" aria-label="Channels" ref={list} data-testid="channel-list">
        {visible.map((row) => (
          <button
            key={row.id}
            type="button"
            role="option"
            aria-selected={row.id === shownId}
            tabIndex={row.id === tabbable ? 0 : -1}
            className={`channels-row${row.id === shownId ? ' selected' : ''}`}
            onClick={() => onSelect(row.id)}
            data-testid={`channel-row-${row.id}`}
          >
            <span className={`dot ${row.tone === 'neutral' ? '' : row.tone}`} role="img" aria-label={row.statusLabel} />
            <span className="channels-row-text">
              <span className="channels-row-title">{row.target}</span>
              <span className="channels-row-line">{rowLine(row)}</span>
            </span>
            {row.waiting > 0 && (
              <span className="channels-row-count" aria-label={`${row.waiting} waiting for you`}>
                {row.waiting}
              </span>
            )}
          </button>
        ))}
        {visible.length === 0 && (
          <p className="muted channels-none" data-testid="channels-none">
            {rows.length === 0 ? 'No channels yet.' : 'No channel fits this search.'}
          </p>
        )}
      </div>
      {rows.some((r) => r.waiting > 0) && <p className="muted small">The number is how many posts are waiting for you there.</p>}
    </div>
  )
}
