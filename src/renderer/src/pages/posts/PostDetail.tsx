import { useLayoutEffect } from 'react'
import type { Id, OpportunityCard, PostGroupCard } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { ConfirmAction, ErrorNote, formatTime } from '../../ui'
import { mainActionOf } from '../review/main-action'
import { PostGroupBox } from '../review/PostGroupSection'
import { ReviewActionRow, ReviewBody, ReviewIdentity } from '../review/ReviewParts'
import { useReviewItem } from '../review/useReviewItem'

/**
 * The right pane of the list view: the selected post in full, with the parts of the review card (the draft in its editor and preview,
 * what was approved or sent) and its action bar pinned to the bottom. A post for several channels is its group's box, with the steps of
 * the group and its versions. The screen's one filled button is the bar's (or the group's) main action while no form is open.
 */
export function PostDetail({
  card,
  group,
  primaryAction,
  onMainAction
}: {
  card: OpportunityCard | null
  group: PostGroupCard | null
  primaryAction: boolean
  onMainAction: (id: Id, offering: boolean) => void
}) {
  if (group) {
    return (
      <div className="posts-detail" data-testid="post-detail" data-kind="group">
        <div className="posts-detail-scroll">
          <PostGroupBox card={group} primaryAction={primaryAction} onMainAction={onMainAction} />
        </div>
      </div>
    )
  }
  if (!card) return null
  return <SinglePost card={card} primaryAction={primaryAction} onMainAction={onMainAction} />
}

function SinglePost({ card, primaryAction, onMainAction }: { card: OpportunityCard; primaryAction: boolean; onMainAction: (id: Id, offering: boolean) => void }) {
  const opp = card.opportunity
  const item = useReviewItem(card, { alsoPostTo: true })
  const offers = mainActionOf(opp.state, item.dirty) !== null
  useLayoutEffect(() => {
    onMainAction(opp.id, offers)
    return () => onMainAction(opp.id, false)
  }, [opp.id, offers, onMainAction])
  const settled = opp.state === 'confirmed' || opp.state === 'cancelled'

  return (
    <div className="posts-detail" data-testid="post-detail" data-kind="post" data-state={opp.state} data-review-item="">
      <div className="posts-detail-scroll">
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
      <div className="inbox-bar" data-testid="post-bar">
        {settled ? (
          <div className="inbox-bar-settled">
            <span className="review-foot-note">{opp.state === 'confirmed' ? 'This post was sent.' : 'This post was deleted.'}</span>
            {opp.state === 'cancelled' && opp.kind === 'standalone' && <PurgeButton id={opp.id} />}
            <ReviewActionRow item={item} />
          </div>
        ) : (
          <ReviewActionRow item={item} primaryAction={primaryAction} />
        )}
      </div>
    </div>
  )
}

/** A deleted post is taken out of the app for good: it leaves the list. Nothing of it was sent, so nothing changes on any site. */
function PurgeButton({ id }: { id: Id }) {
  const [purge, state] = useAction(() => call('opportunities.purge', { id }))
  return (
    <>
      <ConfirmAction
        label="Delete for good"
        variant="quiet"
        className="danger"
        question="Removes this post, with its drafts and approvals, from the app for good. Nothing was sent, so nothing changes on any site. It cannot be brought back."
        confirmLabel="Delete for good"
        onConfirm={() => purge()}
        disabled={state.busy}
        testId="purge"
        confirmTestId="purge-confirm"
      />
      <ErrorNote error={state.error} />
    </>
  )
}

