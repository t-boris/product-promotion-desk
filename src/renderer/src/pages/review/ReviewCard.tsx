import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { Id, OpportunityCard } from '../../../../shared/types'
import { Button, Card, formatTime } from '../../ui'
import { mainActionOf } from './main-action'
import { ReviewActionRow, ReviewBody, ReviewIdentity } from './ReviewParts'
import { useReviewItem } from './useReviewItem'
import './review.css'

const EXCERPT = 160

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat
}

interface Props {
  card: OpportunityCard
  /** A compact card shows one line and opens on demand; used in long lists. */
  collapsible?: boolean
  defaultOpen?: boolean
  /** The product the channel belongs to; shown with the channel where a list mixes products (DEC-009). */
  productName?: string
  /** This card owns the screen's one filled button (the first card of its list that offers a main action). */
  primaryAction?: boolean
  /** Tells the list whether this card shows a main action now, so the list can hand the filled button to the first one that does. */
  onMainAction?: (id: Id, offering: boolean) => void
  /** Something that belongs to the card but not to the item: for example "Dismiss" once the item no longer needs a decision. */
  footer?: ReactNode
  /** Tags after the kind of the item in the head (a version of a group says "Edited by you"). */
  tags?: ReactNode
  /** What the owner should read with the draft before deciding, under it and above the buttons (how a version goes out, what the platform will refuse). */
  notes?: ReactNode
  /** Tells the list whether the owner has changes in the editor that are not saved, so a group can refuse to approve what is not on the screen. */
  onDirty?: (id: Id, dirty: boolean) => void
  /** Something else is working on this item (its group): the editor and the buttons are off until it is done, so nothing typed is lost to a new draft. */
  frozen?: boolean
  /** Offer "Also post to…" on a post of the owner's that is not in a group yet. */
  alsoPostTo?: boolean
}

/**
 * One item that needs a decision, as one group box: a head row (state and kind tags, product, channel and the account it speaks
 * as, the time), the body (the thread, the draft as a compact form, what was approved or sent) and the actions at the bottom,
 * right-aligned. It holds everything needed to decide: the original comment and its thread, the draft with its basis, the
 * account and destination an approval is bound to, and the reason for the current state, including why a send was blocked
 * (REQ-003, REQ-004). The Inbox shows the same parts in its detail pane without the box (`ReviewParts`).
 */
export function ReviewCard({ card, collapsible = false, defaultOpen = true, productName, primaryAction = false, onMainAction, footer, tags, notes, onDirty, frozen = false, alsoPostTo = false }: Props) {
  const [open, setOpen] = useState(defaultOpen || !collapsible)
  const opp = card.opportunity
  const item = useReviewItem(card, { frozen, alsoPostTo })
  const { dirty } = item
  const summary = item.standalone ? card.draft?.title || card.draft?.text || 'New publication' : (card.comment?.body ?? 'Comment')

  // The list gives the one filled button to the first card that shows a main action; a closed card shows none.
  const offersMain = open && mainActionOf(opp.state, dirty) !== null
  useLayoutEffect(() => {
    if (!onMainAction) return
    onMainAction(opp.id, offersMain)
    return () => onMainAction(opp.id, false)
  }, [opp.id, offersMain, onMainAction])
  // A group needs to know which versions have changes that are not saved.
  useLayoutEffect(() => {
    if (!onDirty) return
    onDirty(opp.id, dirty)
    return () => onDirty(opp.id, false)
  }, [opp.id, dirty, onDirty])

  return (
    <div data-testid={`review-card-${opp.id}`} data-state={opp.state} data-review-item="">
      <Card className={`review-card${open ? ' open' : ''}`}>
        <div className="review-head">
          <ReviewIdentity card={card} productName={productName} tags={tags} />
          <div className="review-when">
            <span>{formatTime(opp.updatedAt)}</span>
            {collapsible && (
              <Button variant="quiet" className="accent" onClick={() => setOpen(!open)} data-testid="toggle-card">
                {open ? 'Close' : 'Open'}
              </Button>
            )}
          </div>
        </div>

        {!open && (
          <div className="review-summary-line" data-testid="card-summary">
            {excerpt(summary)}
          </div>
        )}
        {!open && item.conflict && (
          <div className="review-conflict" data-testid="card-conflict">
            {opp.reason}
          </div>
        )}

        {open && (
          <div className="review-body">
            <ReviewBody item={item} notes={notes} />
            <ReviewActionRow item={item} primaryAction={primaryAction} />
          </div>
        )}
        {footer && <div className="review-foot">{footer}</div>}
      </Card>
    </div>
  )
}
