import { useEffect, useRef, useState, type ReactNode } from 'react'
import { WATCH_REPLY_PREFIX } from '../../../../shared/finding-reply'
import { platformLabel } from '../../../../shared/post-format'
import type { Id } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, formatTime } from '../../ui'
import { OpenChannelBrowser } from '../channels/OpenChannelBrowser'
import { FIRST_LOOK, type FindingRow } from './finding-rows'
import { ThreadTree } from './FindingThread'
import { ReplyComposer } from './ReplyComposer'
import type { Place } from './reply-composer'

/** What the AI wrote about how the post relates to the goal, without the words that sent it to this list. */
const brief = (relation: string): string => (relation.startsWith(WATCH_REPLY_PREFIX) ? relation.slice(WATCH_REPLY_PREFIX.length) : relation)

/**
 * One post of the "Worth a reply" stream: the post in brief, the thread under it, and the places to answer. The AI read the post in the account's browser;
 * what it saw is shown as plain text. "Reply here" (on the post or on any comment) opens the reply window under the post. A post the AI has not read yet
 * says so and offers to look at its channel now.
 */
function StreamCard({ row, onSeen }: { row: FindingRow; onSeen: (id: Id) => void }) {
  const { finding, channelTarget, channelPlatform } = row.card
  const thread = useQuery('findings.thread', { id: finding.id }, ['opportunities'])
  const comments = thread.data ?? []
  const [place, setPlace] = useState<Place | null>(null)
  const read = finding.about.trim() !== ''
  const [checkNow, checking] = useAction(() => call('channels.checkNow', { channelId: finding.channelId }))

  // A post the owner has had on screen is a post the owner has seen.
  const card = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!row.unseen || !card.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        onSeen(finding.id)
        observer.disconnect()
      },
      { threshold: 0.5 }
    )
    observer.observe(card.current)
    return () => observer.disconnect()
  }, [row.unseen, finding.id, onSeen])

  return (
    <article className="stream-card" ref={card} data-testid="stream-card" data-unseen={row.unseen ? 'true' : 'false'} data-read={read ? 'true' : 'false'}>
      <header className="stream-head">
        <strong data-testid="stream-channel">{channelTarget}</strong>
        <span className="muted small">{platformLabel(channelPlatform)}</span>
        {finding.author && <span className="muted small">by {finding.author}</span>}
        {finding.firstLook && <Badge>{FIRST_LOOK}</Badge>}
        <span className="stream-when muted small">{formatTime(finding.createdAt)}</span>
      </header>
      <h3 className="stream-title" data-testid="stream-title">
        {finding.title.trim() || 'Untitled post'}
      </h3>
      <p className="stream-brief" data-testid="stream-brief">
        {read ? finding.about : brief(finding.relation).trim() || 'The AI gave no reason.'}
      </p>
      {read ? (
        <div className="stream-thread" data-testid="stream-thread">
          {finding.thread.trim() !== '' && <p className="muted small stream-thread-summary">{finding.thread}</p>}
          <ThreadTree comments={comments} onReply={(position) => setPlace(position)} active={typeof place === 'number' ? place : undefined} />
        </div>
      ) : (
        <div className="stream-unread" data-testid="stream-unread">
          <span className="muted small">The AI has not opened this post to read its thread yet. It reads a few posts like this at every check of the channel.</span>
          <Button variant="secondary" onClick={() => void checkNow()} disabled={checking.busy} data-testid="stream-check-channel">
            {checking.busy ? 'Checking…' : 'Check this channel now'}
          </Button>
          <ErrorNote error={checking.error} />
        </div>
      )}
      {place !== null && read && <ReplyComposer key={String(place)} finding={finding} place={place} comments={comments} onClose={() => setPlace(null)} />}
      <footer className="stream-foot">
        {read && (
          <Button variant="secondary" onClick={() => setPlace('post')} data-testid="reply-to-post">
            Reply to the post
          </Button>
        )}
        <OpenChannelBrowser channelId={finding.channelId} url={finding.url} label="Open post" testId="stream-open-post" fallbackUrl={finding.url} />
      </footer>
    </article>
  )
}

/**
 * The "Worth a reply" list as a real feed (owner, 2026-11-21): each post in brief with its thread under it, and the owner picks any place, post or comment,
 * to answer. The rows are already filtered, sorted and cut to a page by the screen; `footer` is its "Show more". The posts shown are marked seen, in one
 * batch a moment after they come on screen.
 */
export function FindingStream({ rows, footer, markSeen }: { rows: readonly FindingRow[]; footer?: ReactNode; markSeen: (ids: Id[]) => Promise<void> }) {
  const waiting = useRef(new Set<Id>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(markSeen)
  latest.current = markSeen
  const onSeen = useRef((id: Id): void => {
    waiting.current.add(id)
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      const ids = [...waiting.current]
      waiting.current.clear()
      if (ids.length > 0) void latest.current(ids)
    }, 600)
  }).current
  useEffect(() => () => (timer.current !== null ? clearTimeout(timer.current) : undefined), [])

  return (
    <div className="stream" data-testid="finding-stream" role="feed" aria-label="Posts worth a reply">
      {rows.map((row) => (
        <StreamCard key={row.id} row={row} onSeen={onSeen} />
      ))}
      {footer}
    </div>
  )
}
