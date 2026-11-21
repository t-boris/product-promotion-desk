import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { Id } from '../../../../shared/types'
import type { FindingRow } from './finding-rows'
import { StreamCard } from './StreamCard'
import { heldUnread } from './useReadMarks'

export { TagChips } from './TagChips'

const NO_TAGS: readonly string[] = []
const noTag = (): void => undefined
const noMark = async (): Promise<void> => undefined

/**
 * The Noted list as a real feed (owner, 2026-11-21): each post a card, with its thread folded under it, a star on it, and the owner picks any place, post or
 * comment, to answer. The rows are already filtered, sorted and cut to a page by the screen; `footer` is its "Show more". A card is marked read by its own
 * clock after three seconds on show (`useReadAfterShow`); the cards that came to it in the same moment are marked in one batch. A press of the owner's own
 * (Mark as read, Mark as unread on the card's menu) is asked at once, and a post marked unread by hand is not counted by the clock again.
 */
export function FindingStream({
  rows,
  footer,
  markSeen,
  markUnseen = noMark,
  setStarred,
  tags = NO_TAGS,
  onTag = noTag,
  label = 'Noted posts'
}: {
  rows: readonly FindingRow[]
  footer?: ReactNode
  markSeen: (ids: Id[]) => Promise<void>
  markUnseen?: (ids: Id[]) => Promise<void>
  setStarred: (id: Id, starred: boolean) => Promise<void>
  /** The tags the stream is narrowed to, and what pressing a tag of a card does (the screen picks it or takes it off). */
  tags?: readonly string[]
  onTag?: (name: string) => void
  /** What a screen reader calls the feed. */
  label?: string
}) {
  const waiting = useRef(new Set<Id>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ markSeen, markUnseen })
  latest.current = { markSeen, markUnseen }
  const onSeen = useRef((id: Id): void => {
    waiting.current.add(id)
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      const ids = [...waiting.current]
      waiting.current.clear()
      if (ids.length > 0) void latest.current.markSeen(ids)
    }, 600)
  }).current
  useEffect(() => () => (timer.current !== null ? clearTimeout(timer.current) : undefined), [])

  const onMarkRead = useCallback((id: Id, read: boolean): void => {
    if (read) {
      heldUnread.release([id])
      void latest.current.markSeen([id])
    } else {
      heldUnread.hold(id)
      void latest.current.markUnseen([id])
    }
  }, [])

  return (
    <div className="stream" data-testid="finding-stream" role="feed" aria-label={label}>
      {rows.map((row) => (
        <StreamCard key={row.id} row={row} tags={tags} onSeen={onSeen} onMarkRead={onMarkRead} onStar={(id, starred) => void setStarred(id, starred)} onTag={onTag} />
      ))}
      {footer}
    </div>
  )
}
