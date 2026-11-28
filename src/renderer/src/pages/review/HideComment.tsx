import type { OpportunityCard } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote } from '../../ui'
import { hideCommentWords } from './hide-comment'

/**
 * Under the comment an item answers, where the channel's platform lets the account hide a comment (DEC-089): one press hides it from other
 * readers on the platform, the next shows it again. What the press does is said beside the button before it is pressed.
 */
export function HideComment({ card }: { card: OpportunityCard }) {
  const { comment, commentHiding } = card
  const [set, setting] = useAction(async (hidden: boolean) => {
    await call('opportunities.hideComment', { id: card.opportunity.id, hidden })
  })
  if (!comment || !commentHiding) return null
  const words = hideCommentWords(card.channelPlatform, commentHiding, comment.hidden)
  return (
    <div className="thread-hide" data-testid="hide-comment" data-hidden={comment.hidden ? 'yes' : 'no'}>
      <Button variant="secondary" onClick={() => void set(!comment.hidden)} disabled={setting.busy} data-testid="hide-comment-button">
        {setting.busy ? 'Asking the site…' : words.button}
      </Button>
      <span className="muted small" data-testid="hide-comment-note">
        {words.note}
      </span>
      <ErrorNote error={setting.error} />
    </div>
  )
}
