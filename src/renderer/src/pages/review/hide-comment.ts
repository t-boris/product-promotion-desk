import { platformLabel } from '../../../../shared/post-format'
import type { CommentHiding } from '../../../../shared/types'

/**
 * The words of the control that hides the comment an item answers (DEC-089): what the button says, and what pressing it does on the platform,
 * said before the press. Hiding is the owner's own decision about somebody else's words; the application never proposes it.
 */
export function hideCommentWords(platform: string, hiding: CommentHiding, hidden: boolean): { button: string; note: string } {
  const label = platformLabel(platform)
  if (hidden) {
    return { button: 'Show again', note: `Hidden on ${label}: other readers do not see it${hiding === 'with_replies' ? ', nor the replies under it' : ''}. Nothing was deleted.` }
  }
  return {
    button: `Hide on ${label}`,
    note: `Other readers stop seeing it on ${label}${hiding === 'with_replies' ? ', with every reply under it' : ''}. Nothing is deleted, and you can show it again.`
  }
}
