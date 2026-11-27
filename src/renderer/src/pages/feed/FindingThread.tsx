import type { FindingComment } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { Button } from '../../ui'

/**
 * The comments the AI read under a post it called worth a reply, as a thread: each under the one it answers by how deep it sits. All of it is the strangers'
 * words as the AI saw them, shown as plain text (text nodes, never markup). With `onReply` every comment carries "Reply here"; `active` is the place whose
 * reply is open now. With `onRemember` a comment with a known author carries "Remember": it opens the People screen's new-person form filled with who
 * wrote it and what they said; nothing is kept until the owner presses Add there.
 */
export function ThreadTree({ comments, onReply, onRemember, active }: { comments: FindingComment[]; onReply?: (position: number) => void; onRemember?: (comment: FindingComment) => void; active?: number | null }) {
  if (comments.length === 0) return null
  return (
    <ul className="finding-thread" data-testid="finding-thread-list" aria-label="The comments under the post">
      {comments.map((comment) => (
        <li key={comment.position} className={`finding-thread-item${active === comment.position ? ' active' : ''}`} data-depth={comment.depth} style={{ marginLeft: `calc(var(--space-4) * ${comment.depth})` }}>
          <span className="finding-thread-author muted small">{comment.author.trim() || 'Someone'}</span>
          <span className="finding-thread-text">{comment.text}</span>
          {(onReply || onRemember) && (
            <span className="finding-thread-actions">
              {onReply && (
                <Button variant="quiet" onClick={() => onReply(comment.position)} data-testid={`reply-here-${comment.position}`}>
                  Reply here
                </Button>
              )}
              {onRemember && comment.author.trim() !== '' && (
                <Button variant="quiet" onClick={() => onRemember(comment)} data-testid={`remember-${comment.position}`}>
                  Remember
                </Button>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Loads the comments of one finding (they change only when a later look reads the post) and shows them. */
export function FindingThread({ findingId }: { findingId: string }) {
  const thread = useQuery('findings.thread', { id: findingId }, ['opportunities'])
  return <ThreadTree comments={thread.data ?? []} />
}
