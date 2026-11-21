import { useEffect, useRef, useState, type ReactNode } from 'react'
import { WATCH_REPLY_PREFIX } from '../../../../shared/finding-reply'
import { platformLabel } from '../../../../shared/post-format'
import type { FindingTag, Id } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Hint, formatTime } from '../../ui'
import { OpenChannelBrowser } from '../channels/OpenChannelBrowser'
import { FIRST_LOOK, type FindingRow } from './finding-rows'
import { ThreadTree } from './FindingThread'
import { threadShown, titleShown } from './post-tools'
import { AssistPanel, BodyPanel, PostToolsRow, TranslationLine, useReadingLanguage, type PostPanel } from './PostTools'
import { PostPictures, ThreadInsights } from './PostReading'
import { ReplyComposer } from './ReplyComposer'
import type { Place } from './reply-composer'

const NO_TAGS: readonly string[] = []
const noTag = (): void => undefined

/** What the AI wrote about how the post relates to the goal, without the words that sent it to this list. */
const brief = (relation: string): string => (relation.startsWith(WATCH_REPLY_PREFIX) ? relation.slice(WATCH_REPLY_PREFIX.length) : relation)

/**
 * The tags the AI gave a post (short names of what it is about): each is a button that narrows the stream to the posts that carry it; a tag the owner already
 * picked is pressed, and pressing it again takes it off. They come from the AI's naming and are shown as plain text.
 */
export function TagChips({ tags, picked, onTag }: { tags: readonly FindingTag[]; picked: readonly string[]; onTag: (name: string) => void }) {
  if (tags.length === 0) return null
  return (
    <ul className="tag-chips" aria-label="Tags of the post" data-testid="stream-tags">
      {tags.map((tag) => (
        <li key={tag.id}>
          <button type="button" className={`tag-chip${picked.includes(tag.name) ? ' on' : ''}`} aria-pressed={picked.includes(tag.name)} onClick={() => onTag(tag.name)} data-testid="stream-tag" data-tag={tag.name}>
            {tag.name}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * One post of the stream: the post in brief, the thread under it, and the places to answer. The AI read the post in the account's browser;
 * what it saw is shown as plain text. "Reply here" (on the post or on any comment) opens the reply window under the post. A post the AI has not read yet
 * says so and offers to look at its channel now.
 */
function StreamCard({
  row,
  tags,
  onSeen,
  onStar,
  onTag
}: {
  row: FindingRow
  /** The tags the owner picked to filter the stream by: the chips of this card that are among them are pressed. */
  tags: readonly string[]
  onSeen: (id: Id) => void
  onStar: (id: Id, starred: boolean) => void
  onTag: (name: string) => void
}) {
  const { finding, channelTarget, channelPlatform } = row.card
  const thread = useQuery('findings.thread', { id: finding.id }, ['opportunities'])
  const comments = thread.data ?? []
  const [place, setPlace] = useState<Place | null>(null)
  // A wish the reply window opens with (from "Write a reply from this" in the explanation); empty for the owner's own press on a place.
  const [wish, setWish] = useState('')
  const openReply = (at: Place, withWish = ''): void => {
    setWish(withWish)
    setPlace(at)
  }
  // The tools for reading: the explanation and the text of the post in a panel under the post, and the translation the owner reads in place of the original.
  const [language, setLanguage] = useReadingLanguage()
  const [panel, setPanel] = useState<PostPanel>(null)
  const [translated, setTranslated] = useState(false)
  const translationQuery = useQuery('findings.translation', { id: finding.id, language }, [])
  // The answer for another language may still be in hand for a moment after the language changed: it is not this one.
  const translation = translationQuery.data && translationQuery.data.language === language ? translationQuery.data : null
  const [translate, translating] = useAction(async (refresh: boolean) => {
    const made = await call('findings.translate', { id: finding.id, language, refresh })
    translationQuery.reload()
    setTranslated(true)
    return made
  })
  const showTranslated = translated && translation !== null
  const shownThread = threadShown(comments, translation, showTranslated)
  const read = finding.about.trim() !== ''
  // "Check with AI": the AI opens this one post in the channel's account and reads it in full. It resolves when the AI is done; the card reloads by itself.
  const [readNow, reading] = useAction(() => call('findings.readNow', { id: finding.id }))
  const [readResult, setReadResult] = useState<{ state: 'read' | 'unavailable' | 'failed' | 'stopped'; message: string } | null>(null)
  const checkWithAi = async (): Promise<void> => {
    setReadResult(null)
    const result = await readNow()
    if (result) setReadResult(result)
  }

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
    <article className="stream-card" ref={card} data-testid="stream-card" data-unseen={row.unseen ? 'true' : 'false'} data-read={read ? 'true' : 'false'} data-own={row.own ? 'true' : 'false'}>
      <header className="stream-head">
        <strong data-testid="stream-channel">{channelTarget}</strong>
        <span className="muted small">{platformLabel(channelPlatform)}</span>
        {finding.author && <span className="muted small">by {finding.author}</span>}
        {finding.firstLook && <Badge>{FIRST_LOOK}</Badge>}
        {row.own && <Badge tone="good">Your post</Badge>}
        {row.worthReply && <Badge tone="info">The AI would answer it</Badge>}
        <span className="stream-when muted small">{formatTime(finding.createdAt)}</span>
        <button
          type="button"
          className={`star${row.starred ? ' on' : ''}`}
          aria-pressed={row.starred}
          aria-label={row.starred ? 'Take the star off this post' : 'Star this post'}
          title={row.starred ? 'Starred: click to take the star off' : 'Star this post to find it again'}
          onClick={() => onStar(finding.id, !row.starred)}
          data-testid="stream-star"
        >
          <span aria-hidden="true">{row.starred ? '★' : '☆'}</span>
        </button>
      </header>
      <h3 className="stream-title" data-testid="stream-title">
        {titleShown(finding, translation, showTranslated) || 'Untitled post'}
      </h3>
      <TranslationLine translation={translation} translated={showTranslated} onShowOriginal={() => setTranslated(false)} />
      <TagChips tags={row.card.tags} picked={tags} onTag={onTag} />
      <p className="stream-brief" data-testid="stream-brief">
        {read ? finding.about : brief(finding.relation).trim() || 'The AI gave no reason.'}
      </p>
      <PostPictures findingId={finding.id} />
      {read ? (
        <>
          <ThreadInsights finding={finding} />
          <div className="stream-thread" data-testid="stream-thread">
            {finding.thread.trim() !== '' && comments.length === 0 && <p className="muted small stream-thread-summary">{finding.thread}</p>}
            <ThreadTree comments={shownThread} onReply={(position) => openReply(position)} active={typeof place === 'number' ? place : undefined} />
          </div>
        </>
      ) : (
        <p className="muted small stream-unread" data-testid="stream-unread">
          The AI has not read this post in full yet: its thread, its pictures and what it is about. Press Check with AI to read it now; the AI also reads the recent ones at every check of the channel.
        </p>
      )}
      <PostToolsRow
        panel={panel}
        onPanel={setPanel}
        language={language}
        onLanguage={setLanguage}
        translation={translation}
        translated={showTranslated}
        onTranslate={() => (translation !== null && !translation.stale ? setTranslated(true) : void translate(translation !== null))}
        onShowOriginal={() => setTranslated(false)}
        translating={translating.busy}
      />
      {translating.busy && <AiProgressPanel />}
      <ErrorNote error={translating.error} />
      {panel === 'explain' && <AssistPanel finding={finding} comments={comments} language={language} onWrite={(at, withWish) => openReply(at, withWish)} />}
      {panel === 'read' && <BodyPanel finding={finding} translation={translation} translated={showTranslated} onRead={() => void checkWithAi()} reading={reading.busy} />}
      {reading.busy && <AiProgressPanel />}
      {readResult && (
        <Hint tone={readResult.state === 'read' || readResult.state === 'stopped' ? undefined : 'warn'} data-testid="stream-read-result" data-state={readResult.state}>
          {readResult.message}
        </Hint>
      )}
      <ErrorNote error={reading.error} />
      {place !== null && read && <ReplyComposer key={`${place}|${wish}`} finding={finding} place={place} comments={comments} initialWish={wish} onClose={() => setPlace(null)} />}
      <footer className="stream-foot">
        {read && (
          <Button variant="secondary" onClick={() => openReply('post')} data-testid="reply-to-post">
            Reply to the post
          </Button>
        )}
        <Button variant={read ? 'quiet' : 'secondary'} onClick={() => void checkWithAi()} disabled={reading.busy} data-testid="stream-check-ai">
          {reading.busy ? 'Reading…' : read ? 'Check again with AI' : 'Check with AI'}
        </Button>
        <OpenChannelBrowser channelId={finding.channelId} url={finding.url} label="Open post" testId="stream-open-post" fallbackUrl={finding.url} />
      </footer>
    </article>
  )
}

/**
 * The Noted list as a real feed (owner, 2026-11-21): each post in brief with its thread under it, a star on it, and the owner picks any place, post or
 * comment, to answer. The rows are already filtered, sorted and cut to a page by the screen; `footer` is its "Show more". The posts shown are marked seen,
 * in one batch a moment after they come on screen.
 */
export function FindingStream({
  rows,
  footer,
  markSeen,
  setStarred,
  tags = NO_TAGS,
  onTag = noTag,
  label = 'Noted posts'
}: {
  rows: readonly FindingRow[]
  footer?: ReactNode
  markSeen: (ids: Id[]) => Promise<void>
  setStarred: (id: Id, starred: boolean) => Promise<void>
  /** The tags the stream is narrowed to, and what pressing a tag of a card does (the screen picks it or takes it off). */
  tags?: readonly string[]
  onTag?: (name: string) => void
  /** What a screen reader calls the feed. */
  label?: string
}) {
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
    <div className="stream" data-testid="finding-stream" role="feed" aria-label={label}>
      {rows.map((row) => (
        <StreamCard key={row.id} row={row} tags={tags} onSeen={onSeen} onStar={(id, starred) => void setStarred(id, starred)} onTag={onTag} />
      ))}
      {footer}
    </div>
  )
}
