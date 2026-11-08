import type { Comment, OpportunityCard } from '../../../../shared/types'
import { Badge, formatTime } from '../../ui'
import { isHttpUrl } from './labels'

const BODY_PREVIEW = 700

function preview(text: string): string {
  return text.length > BODY_PREVIEW ? `${text.slice(0, BODY_PREVIEW)}…` : text
}

function ExternalLink({ url, children }: { url: string | null | undefined; children: string }) {
  if (!isHttpUrl(url)) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" data-testid="open-in-browser">
      {children}
    </a>
  )
}

function CommentBox({ comment, highlight, depth }: { comment: Comment; highlight?: boolean; depth: number }) {
  return (
    <div
      className="list-row"
      style={{ marginLeft: Math.min(depth, 4) * 16, display: 'block', borderColor: highlight ? 'var(--accent)' : undefined }}
      data-testid={highlight ? 'original-comment' : 'thread-comment'}
    >
      <div className="row small muted">
        <strong>{comment.author}</strong>
        {comment.isOwn && <Badge tone="info">Your account</Badge>}
        {comment.postedAt && <span>{formatTime(comment.postedAt)}</span>}
        {highlight && <ExternalLink url={comment.url}>Open comment in browser</ExternalLink>}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: 4 }}>{preview(comment.body)}</div>
    </div>
  )
}

/**
 * The conversation around the comment being answered: the post, the chain of parent comments, the comment
 * itself and the replies already under it (REQ-003 criterion 2: the owner sees the same context the AI used).
 */
export function ThreadView({ card }: { card: OpportunityCard }) {
  const { discussion, comment, thread } = card
  const byExternalId = new Map(thread.map((c) => [c.externalId, c]))

  const ancestors: Comment[] = []
  const seen = new Set<string>()
  let parent = comment?.parentExternalId ?? null
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const found = byExternalId.get(parent)
    if (!found) break
    ancestors.unshift(found)
    parent = found.parentExternalId
  }
  const ancestorIds = new Set(ancestors.map((c) => c.id))
  const others = thread.filter((c) => !ancestorIds.has(c.id) && c.id !== comment?.id)

  return (
    <div className="stack" data-testid="thread-view">
      {discussion && (
        <div>
          <div className="row">
            <strong data-testid="discussion-title">{discussion.title || 'Untitled post'}</strong>
            <span className="muted small">by {discussion.author}</span>
            <ExternalLink url={discussion.url}>Open post in browser</ExternalLink>
          </div>
          {discussion.body && <div className="muted small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview(discussion.body)}</div>}
        </div>
      )}
      {ancestors.map((c, i) => (
        <CommentBox key={c.id} comment={c} depth={i} />
      ))}
      {comment && <CommentBox comment={comment} highlight depth={ancestors.length} />}
      {others.length > 0 && <div className="muted small">Replies under it</div>}
      {others.map((c) => (
        <CommentBox key={c.id} comment={c} depth={ancestors.length + 1} />
      ))}
    </div>
  )
}
