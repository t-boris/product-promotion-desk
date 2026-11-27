import { useRef, useState } from 'react'
import { WATCH_REPLY_PREFIX } from '../../../../shared/finding-reply'
import { MAX_NOTE } from '../../../../shared/people'
import { platformLabel } from '../../../../shared/post-format'
import type { Id } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import { Icon } from '../../icons'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Hint, formatTime } from '../../ui'
import { peopleNewHref } from '../../route'
import { OpenChannelBrowser } from '../channels/OpenChannelBrowser'
import { CardMenu } from './CardMenu'
import { FIRST_LOOK, type FindingRow } from './finding-rows'
import { ThreadTree } from './FindingThread'
import { bodyShown, bodyState, threadShown, titleShown } from './post-tools'
import { AssistPanel, BodyPanel, PostToolsRow, TranslationLine, useReadingLanguage, type PostPanel } from './PostTools'
import { PostPictures, ThreadInsights } from './PostReading'
import { ReplyComposer } from './ReplyComposer'
import type { Place } from './reply-composer'
import { channelMark, needsReadMore, peopleSay, siteNumbers } from './stream-card'
import { TagChips } from './TagChips'
import { heldUnread, useReadAfterShow } from './useReadMarks'

/** What the AI wrote about how the post relates to the goal, without the words that sent it to this list. */
const brief = (relation: string): string => (relation.startsWith(WATCH_REPLY_PREFIX) ? relation.slice(WATCH_REPLY_PREFIX.length) : relation)

/**
 * One post of the stream, as a card (owner, 2026-11-21: "like Facebook or Reddit"): who and where it is from, its title, the text of the post itself (cut to five
 * lines), its pictures across the card, a bar of what the site showed and of what the owner can do (Explain, Translate, Reply, Open post), and under it one folded
 * line for what the AI read of the thread. The AI read the post in the account's browser; what it saw is shown as plain text. "Reply here" (on the post or on any
 * comment) opens the reply window under the bar. A post the AI has not read yet says so and offers to look at it now.
 *
 * The card is marked read after three seconds on show (`useReadAfterShow`); the owner can mark it read or unread by hand from its menu, and a card marked unread
 * by hand is not counted again by the clock.
 */
export function StreamCard({
  row,
  tags,
  onSeen,
  onMarkRead,
  onStar,
  onTag
}: {
  row: FindingRow
  /** The tags the owner picked to filter the stream by: the chips of this card that are among them are pressed. */
  tags: readonly string[]
  /** The clock counted the card as read. */
  onSeen: (id: Id) => void
  /** The owner pressed Mark as read (`true`) or Mark as unread (`false`) on the card. */
  onMarkRead: (id: Id, read: boolean) => void
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
  // The tools for reading: the explanation and the text of the post in a panel under the bar, and the translation the owner reads in place of the original.
  const [language, setLanguage] = useReadingLanguage()
  const [panel, setPanel] = useState<PostPanel>(null)
  const [translated, setTranslated] = useState(false)
  const [more, setMore] = useState(false)
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

  // A post the owner has had on show for three seconds is a post the owner has read; one the owner marked unread by hand is left as the owner said.
  const card = useRef<HTMLElement>(null)
  useReadAfterShow(card, row.unseen && !heldUnread.has(finding.id), () => onSeen(finding.id))

  const bodyText = bodyState(finding) === 'text' ? bodyShown(finding, translation, showTranslated) : ''
  const cut = bodyText !== '' && needsReadMore(bodyText) && !more
  const numbers = siteNumbers(finding)
  const say = peopleSay(finding)

  return (
    <article
      className="stream-card"
      ref={card}
      data-testid="stream-card"
      data-unseen={row.unseen ? 'true' : 'false'}
      data-read={read ? 'true' : 'false'}
      data-own={row.own ? 'true' : 'false'}
    >
      <header className="stream-head">
        <span className="stream-mark" aria-hidden="true" title={platformLabel(channelPlatform)}>
          {channelMark(channelPlatform)}
        </span>
        <div className="stream-who">
          <div className="stream-who-line">
            <strong data-testid="stream-channel">{channelTarget}</strong>
            <span className="muted small">{platformLabel(channelPlatform)}</span>
            {finding.author && <span className="muted small">by {finding.author}</span>}
            <span className="muted small">{formatTime(row.at)}</span>
          </div>
          {(finding.firstLook || row.own || row.worthReply) && (
            <div className="stream-badges">
              {finding.firstLook && <Badge>{FIRST_LOOK}</Badge>}
              {row.own && <Badge tone="good">Your post</Badge>}
              {row.worthReply && <Badge tone="info">The AI would answer it</Badge>}
            </div>
          )}
        </div>
        <div className="stream-head-actions">
          {row.unseen && <span className="stream-dot" role="img" aria-label="Unread" title="Unread" data-testid="stream-unread-dot" />}
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
          <CardMenu
            state={{ unread: row.unseen, aiRead: read, checking: reading.busy, readOpen: panel === 'read' }}
            onToggleRead={() => onMarkRead(finding.id, row.unseen)}
            onCheck={() => void checkWithAi()}
            onReadPost={() => setPanel(panel === 'read' ? null : 'read')}
          />
        </div>
      </header>

      <h3 className="stream-title" data-testid="stream-title">
        {titleShown(finding, translation, showTranslated) || 'Untitled post'}
      </h3>
      <TranslationLine translation={translation} translated={showTranslated} onShowOriginal={() => setTranslated(false)} />
      <TagChips tags={row.card.tags} picked={tags} onTag={onTag} />

      {bodyText !== '' ? (
        <div className="stream-text">
          <p className={`stream-body${cut ? ' cut' : ''}`} data-testid="stream-body">
            {bodyText}
          </p>
          {needsReadMore(bodyText) && (
            <Button variant="quiet" className="stream-more" onClick={() => setMore(!more)} aria-expanded={more} data-testid="stream-body-more">
              {more ? 'Show less' : 'Read more'}
            </Button>
          )}
        </div>
      ) : (
        <p className="stream-brief" data-testid="stream-brief">
          {read ? finding.about : brief(finding.relation).trim() || 'The AI gave no reason.'}
        </p>
      )}

      <PostPictures findingId={finding.id} />

      {!read && (
        <div className="stream-unread" data-testid="stream-unread">
          <p className="muted small">
            The AI has not read this post in full yet: its thread, its pictures and what it is about. Press Check with AI to read it now; the AI also reads the recent ones at every check of the channel.
          </p>
          <Button variant="secondary" onClick={() => void checkWithAi()} disabled={reading.busy} data-testid="stream-check-ai">
            {reading.busy ? 'Reading…' : 'Check with AI'}
          </Button>
        </div>
      )}

      <footer className="stream-actions" data-testid="stream-actions">
        {numbers.score !== null && (
          <span className="stream-stat" title="Score, as the site showed it" data-testid="stream-score">
            <Icon name="arrowUp" small />
            <span className="sr-only">Score </span>
            {numbers.score}
          </span>
        )}
        {numbers.comments !== null && (
          <span className="stream-stat" title="Comments, as the site showed them" data-testid="stream-comments">
            <Icon name="comment" small />
            <span className="sr-only">Comments </span>
            {numbers.comments}
          </span>
        )}
        <PostToolsRow
          compact
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
        {read && (
          <Button variant="quiet" onClick={() => openReply('post')} data-testid="reply-to-post">
            Reply
          </Button>
        )}
        <OpenChannelBrowser channelId={finding.channelId} url={finding.url} label="Open post" testId="stream-open-post" fallbackUrl={finding.url} />
      </footer>

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

      {read && (
        <details className="stream-reading" data-testid="stream-reading">
          <summary>
            <span className="stream-reading-label">What people say{say !== null ? ':' : ''}</span>
            {say !== null && <span className="stream-reading-line muted">{say}</span>}
            <Icon name="chevronDown" small />
          </summary>
          <div className="stream-reading-body">
            <ThreadInsights finding={finding} />
            <div className="stream-thread" data-testid="stream-thread">
              {finding.thread.trim() !== '' && comments.length === 0 && <p className="muted small stream-thread-summary">{finding.thread}</p>}
              <ThreadTree comments={shownThread} onReply={(position) => openReply(position)} onRemember={(comment) => (window.location.hash = peopleNewHref({ handle: comment.author.trim(), platform: channelPlatform, where: channelTarget, note: comment.text.slice(0, MAX_NOTE) }))} active={typeof place === 'number' ? place : undefined} />
            </div>
          </div>
        </details>
      )}
    </article>
  )
}
