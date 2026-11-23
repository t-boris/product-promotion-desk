import { useState } from 'react'
import { noticeAuthor, noticeExcerpt, noticeText, watchWords } from '../../../../shared/standing'
import type { SendAction } from '../../../../shared/types'
import { Button } from '../../ui'

/**
 * What the owner reads under a post the site took down after it was published (0.49.0): the site's words, what the community itself wrote
 * under the post (its bot's or a moderator's message, the start of it with "Show all"), and until when the application keeps looking.
 * One block for the closed card and for "On the site" of the open one.
 */
export function StandingNote({ action, nowMs = Date.now() }: { action: SendAction; nowMs?: number }) {
  const [all, setAll] = useState(false)
  const notice = action.standingNotice
  const text = notice ? noticeText(notice) : ''
  const excerpt = noticeExcerpt(text)
  const watch = watchWords(action, nowMs)
  return (
    <div className="standing-note" data-testid="standing-note">
      {action.standingNote && <div data-testid="standing-why">{action.standingNote}</div>}
      {notice && text !== '' && (
        <div className="standing-notice" data-testid="standing-notice">
          <div className="muted small">{noticeAuthor(notice)} wrote under the post:</div>
          <blockquote className={all ? 'whole' : undefined}>{all ? text : excerpt.text}</blockquote>
          {excerpt.cut && (
            <Button variant="quiet" className="accent" onClick={() => setAll(!all)} data-testid="standing-notice-toggle">
              {all ? 'Show less' : 'Show all'}
            </Button>
          )}
        </div>
      )}
      {watch && (
        <div className="muted small" data-testid="standing-watch">
          {watch}
        </div>
      )}
    </div>
  )
}
