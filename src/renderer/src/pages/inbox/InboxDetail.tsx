import type { OpportunityCard } from '../../../../shared/types'
import { Button, formatTime } from '../../ui'
import { needsDecision } from './inbox-groups'
import { ReviewActionRow, ReviewBody, ReviewIdentity } from '../review/ReviewParts'
import { useReviewItem } from '../review/useReviewItem'

/**
 * The right pane of the Decide segment: the selected item in full, with the parts of the review card (the thread, the draft in its
 * editor, what was approved or sent) but without its collapsible head, and the action bar pinned to the bottom. The bar's right side
 * holds the screen's one filled button (the main action of the item's state: approve, send or check the platform), its left side the
 * quiet ones (defer, reject or delete). An item that no longer needs a decision says so and offers "Dismiss" in place of the buttons.
 * Keyed by the item by its parent, so the editor never carries one item's text to the next.
 */
export function InboxDetail({ card, onDone, onDismiss }: { card: OpportunityCard; onDone: (card: OpportunityCard) => void; onDismiss: () => void }) {
  const opp = card.opportunity
  const item = useReviewItem(card, { alsoPostTo: true, onDone })
  const open = needsDecision(opp.state)

  return (
    <div className="inbox-detail" data-testid="inbox-detail" data-state={opp.state} data-review-item="">
      <div className="inbox-detail-scroll">
        <div className="review-head inbox-detail-head">
          <ReviewIdentity card={card} />
          <div className="review-when">
            <span>{formatTime(opp.updatedAt)}</span>
          </div>
        </div>
        <div className="review-body">
          <ReviewBody item={item} />
        </div>
      </div>
      <div className="inbox-bar" data-testid="inbox-bar">
        {open ? (
          <ReviewActionRow item={item} primaryAction primaryTestId="inbox-primary" />
        ) : (
          <div className="inbox-bar-settled">
            <span className="review-foot-note">This item no longer needs a decision.</span>
            <ReviewActionRow item={item} />
            <Button onClick={onDismiss} data-testid="dismiss-card">
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
