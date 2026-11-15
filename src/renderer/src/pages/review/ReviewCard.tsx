import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { Id, OpportunityCard } from '../../../../shared/types'
import { Badge, Button, Card, ErrorNote, formatTime } from '../../ui'
import { ActionSummary } from './ActionSummary'
import { AlsoPostPanel } from './AlsoPostPanel'
import { DraftEditor, useDraftForm } from './DraftEditor'
import { ReviewButtons } from './ReviewButtons'
import { ScheduleControl } from './ScheduleControl'
import { ThreadView } from './ThreadView'
import {
  CATEGORY_LABEL,
  DECISION_LABEL,
  DISCLOSURE_HINT,
  KIND_LABEL,
  LOCKED_STATES,
  LOGIN_CONFLICT_HINT,
  STATE_HINT,
  STATE_LABEL,
  STATE_TONE,
  isLoginConflict,
  isUndisclosed
} from './labels'
import { mainActionOf } from './main-action'
import { alsoPostAllowed } from './post-group'
import { removalWords } from './removal-words'
import { useReviewActions } from './useReviewActions'
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
  /** The product the channel belongs to; shown with the channel because these lists mix products (DEC-009). */
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
 * (REQ-003, REQ-004).
 */
export function ReviewCard({ card, collapsible = false, defaultOpen = true, productName, primaryAction = false, onMainAction, footer, tags, notes, onDirty, frozen = false, alsoPostTo = false }: Props) {
  const [open, setOpen] = useState(defaultOpen || !collapsible)
  const opp = card.opportunity
  const standalone = opp.kind === 'standalone'
  const { form, setForm, dirty, input } = useDraftForm(card.draft, standalone)
  const actions = useReviewActions()
  // While the group works on this item nothing here is offered; the card shows the work as busy.
  const working = frozen || actions.busy
  const buttons = working === actions.busy ? actions : { ...actions, busy: true }
  const [alsoOpen, setAlsoOpen] = useState(false)
  const alsoPost = alsoPostTo && alsoPostAllowed(card)
  const locked = LOCKED_STATES.includes(opp.state) || opp.state === 'analyzing' || opp.state === 'cancelled'
  const conflict = isLoginConflict(opp.reason)
  // A held item must not be told to "prepare a draft" when that is exactly what is refused.
  const hint = conflict ? LOGIN_CONFLICT_HINT : STATE_HINT[opp.state]
  const summary = standalone ? card.draft?.title || card.draft?.text || 'New publication' : (card.comment?.body ?? 'Comment')

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
    <div data-testid={`review-card-${opp.id}`} data-state={opp.state}>
      <Card className={`review-card${open ? ' open' : ''}`}>
        <div className="review-head">
          <div className="review-id">
            <Badge tone={STATE_TONE[opp.state]}>{opp.state === 'cancelled' && standalone ? removalWords('standalone').list : STATE_LABEL[opp.state]}</Badge>
            <Badge>{KIND_LABEL[opp.kind]}</Badge>
            {opp.category && <Badge>{CATEGORY_LABEL[opp.category]}</Badge>}
            {opp.decision && opp.decision !== 'reply' && <Badge tone="warn">{DECISION_LABEL[opp.decision]}</Badge>}
            {tags}
            {productName && (
              <span className="review-product" data-testid="card-product">
                {productName}
              </span>
            )}
            <strong data-testid="card-channel">{card.channelTarget}</strong>
            <span className="review-account">as {card.accountLabel}</span>
          </div>
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
        {!open && conflict && (
          <div className="review-conflict" data-testid="card-conflict">
            {opp.reason}
          </div>
        )}

        {open && (
          <div className="review-body">
            {(opp.reason || hint || isUndisclosed(opp.reason)) && (
              <div className="review-state">
                {opp.reason && (
                  <div data-testid="state-reason">
                    <strong>{opp.reason}</strong>
                  </div>
                )}
                {hint && (
                  <div className="muted small" data-testid={conflict ? 'login-conflict-hint' : 'state-hint'}>
                    {hint}
                  </div>
                )}
                {isUndisclosed(opp.reason) && (
                  <div className="muted small" data-testid="disclosure-hint">
                    {DISCLOSURE_HINT}
                  </div>
                )}
              </div>
            )}
            {!standalone && <ThreadView card={card} />}
            {standalone && opp.destination && (
              <div className="muted small">
                Will be posted to <code>{opp.destination}</code>
              </div>
            )}

            <DraftEditor form={form} onChange={setForm} withTitle={standalone} disabled={locked || working} draft={card.draft} ai={locked ? undefined : { opportunityId: opp.id }} post={standalone ? { productId: opp.productId, platform: card.channelPlatform, reads: card.channelReads, author: { name: card.accountLabel, target: card.channelTarget } } : undefined} />
            {standalone && !locked && card.channelReads !== false && <ScheduleControl opportunity={opp} busy={working} onSchedule={(at) => void actions.schedule(opp.id, at)} />}

            {notes}
            <ActionSummary card={card} />
            <ErrorNote error={actions.error} />
            {alsoPost && alsoOpen && <AlsoPostPanel card={card} onClose={() => setAlsoOpen(false)} />}
            <ReviewButtons
              card={card}
              actions={buttons}
              dirty={dirty}
              input={input}
              primaryAction={primaryAction}
              extra={
                alsoPost ? (
                  <>
                    {dirty && (
                      <span className="muted small" data-testid="also-post-reason">
                        Save your changes first.
                      </span>
                    )}
                    <Button onClick={() => setAlsoOpen(true)} disabled={working || dirty || alsoOpen} data-testid="also-post-to">
                      Also post to…
                    </Button>
                  </>
                ) : undefined
              }
            />
          </div>
        )}
        {footer && <div className="review-foot">{footer}</div>}
      </Card>
    </div>
  )
}
