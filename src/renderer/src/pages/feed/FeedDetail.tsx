import { useLayoutEffect } from 'react'
import type { Id, OpportunityCard } from '../../../../shared/types'
import { Badge, formatTime } from '../../ui'
import { mainActionOf } from '../review/main-action'
import { ReviewActionRow, ReviewBody, ReviewIdentity } from '../review/ReviewParts'
import { useReviewItem } from '../review/useReviewItem'
import { NEW_POST_NOTE, SOURCE_LABEL, barNote } from './feed-filter'
import '../inbox/inbox.css'
import './feed.css'

/**
 * The right pane: the selected item in full, with the parts of the review card (the post or the comment with its thread, the draft in its
 * editor, what was approved or sent) and the action bar pinned to the bottom, as in the Inbox. The item is the same object the Inbox lists
 * while it needs a decision, so the same hook holds its state and its buttons. The screen's one filled button is the bar's main action
 * while the item offers one; a sent, rejected or sending item offers none and says so. A reply to a new post shows the post in place of a
 * comment (the card has none) and says where the reply will go. Keyed by the item by its parent, so the editor never carries one item's
 * text to the next.
 */
export function FeedDetail({ card, primaryAction, onMainAction }: { card: OpportunityCard; primaryAction: boolean; onMainAction: (id: Id, offering: boolean) => void }) {
  const opp = card.opportunity
  const item = useReviewItem(card)
  const offers = mainActionOf(opp.state, item.dirty) !== null
  // The screen gives the filled button to the selected item only while it shows a main action.
  useLayoutEffect(() => {
    onMainAction(opp.id, offers)
    return () => onMainAction(opp.id, false)
  }, [opp.id, offers, onMainAction])
  const note = barNote(opp.state)
  const answersPost = opp.source === 'new_post'

  return (
    <div className="inbox-detail feed-detail" data-testid="feed-detail" data-state={opp.state} data-source={opp.source} data-review-item="">
      <div className="inbox-detail-scroll">
        <div className="review-head inbox-detail-head">
          <ReviewIdentity card={card} tags={<Badge>{SOURCE_LABEL[opp.source]}</Badge>} />
          <div className="review-when">
            <span>Found {formatTime(opp.createdAt)}</span>
          </div>
        </div>
        <div className="review-body">
          <ReviewBody
            item={item}
            notes={
              answersPost && !note ? (
                <div className="muted small" data-testid="new-post-note">
                  {NEW_POST_NOTE}
                </div>
              ) : undefined
            }
          />
        </div>
      </div>
      <div className="inbox-bar" data-testid="feed-bar">
        {note ? (
          <div className="inbox-bar-settled">
            <span className="review-foot-note">{note}</span>
            <ReviewActionRow item={item} />
          </div>
        ) : (
          <ReviewActionRow item={item} primaryAction={primaryAction} />
        )}
      </div>
    </div>
  )
}
