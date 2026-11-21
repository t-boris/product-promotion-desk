import { useEffect, useRef, type ReactNode } from 'react'
import type { Attachment } from '../../../../shared/types'
import { Badge, type Tone } from '../../ui'
import { useThumb } from '../review/useMedia'
import { shortTime } from './short-time'
import type { PostRow, PostState } from './posts-filter'

export const STATE_LABEL: Record<PostState, string> = { draft: 'Draft', approved: 'Approved', scheduled: 'Scheduled', sent: 'Sent', deleted: 'Deleted' }
const STATE_TONE: Record<PostState, Tone> = { draft: 'neutral', approved: 'info', scheduled: 'info', sent: 'good', deleted: 'neutral' }

/** The small picture of a row, or an empty frame of the same size so the rows keep one rhythm. */
function Thumb({ attachment }: { attachment: Attachment | null }) {
  const url = useThumb(attachment?.mediaId, 80)
  return url ? <img className="posts-thumb" src={url} alt="" /> : <span className="posts-thumb posts-thumb-empty" aria-hidden="true" />
}

/** What the row says about time: when it went out, when it is planned to, or when it was last touched. */
function whenOf(row: PostRow): string {
  if (row.state === 'sent' && row.sentAt) return `Sent ${shortTime(row.sentAt)}`
  if (row.scheduledAt && (row.state === 'scheduled' || row.state === 'draft' || row.state === 'approved')) return `Planned ${shortTime(row.scheduledAt)}`
  return `Updated ${shortTime(row.updatedAt)}`
}

/**
 * The left pane of the list view: one compact row for each post and each group (a post for several channels), the first picture as a
 * small thumbnail, the title, where it goes, its state and its time. A selected group opens into its versions, one line each. The list is
 * a listbox: the owner moves through it with the arrow keys (the page handles them) and the selected row is the one shown beside it.
 */
export function PostsList({ rows, selectedId, onSelect, footer }: { rows: PostRow[]; selectedId: string | null; onSelect: (id: string) => void; footer?: ReactNode }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row) return
    if (list.current?.contains(document.activeElement)) row.focus()
    row.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  return (
    <div className="posts-list" role="listbox" aria-label="Posts" ref={list} data-testid="posts-list">
      {rows.map((row) => {
        const selected = row.id === selectedId
        const tone: Tone = row.attention ? (row.attention === 'Failed' ? 'bad' : 'warn') : STATE_TONE[row.state]
        return (
          <div key={row.id} className="posts-row-wrap">
            <button
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`posts-row${selected ? ' selected' : ''}`}
              onClick={() => onSelect(row.id)}
              data-testid={`post-row-${row.id}`}
              data-state={row.state}
            >
              <Thumb attachment={row.thumbnail} />
              <span className="posts-row-main">
                <span className="posts-row-top">
                  <span className="posts-row-title">{row.title}</span>
                  <Badge tone={tone}>{row.attention ?? STATE_LABEL[row.state]}</Badge>
                </span>
                <span className="posts-row-line">{row.targets.join(' · ')}</span>
                <span className="posts-row-line posts-row-when">{whenOf(row)}</span>
              </span>
            </button>
            {selected && row.kind === 'group' && (
              <div className="posts-versions" role="group" aria-label="Versions of this post" data-testid="post-versions">
                {row.cards.map((card, at) => (
                  <div key={card.opportunity.id} className="posts-version">
                    <span className="posts-version-target">{card.channelTarget}</span>
                    <span className="posts-version-state">{STATE_LABEL[row.states[at] ?? row.state]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {footer}
    </div>
  )
}
