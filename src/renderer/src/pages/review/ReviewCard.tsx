import { useLayoutEffect, useState, type ReactNode } from 'react'
import type { Id, OpportunityCard } from '../../../../shared/types'
import { Badge, Button, Card, ErrorNote, formatTime } from '../../ui'
import { ActionSummary } from './ActionSummary'
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
}

/**
 * One item that needs a decision, as one group box: a head row (state and kind tags, product, channel and the account it speaks
 * as, the time), the body (the thread, the draft as a compact form, what was approved or sent) and the actions at the bottom,
 * right-aligned. It holds everything needed to decide: the original comment and its thread, the draft with its basis, the
 * account and destination an approval is bound to, and the reason for the current state, including why a send was blocked
 * (REQ-003, REQ-004).
 */
export function ReviewCard({ card, collapsible = false, defaultOpen = true, productName, primaryAction = false, onMainAction, footer }: Props) {
  const [open, setOpen] = useState(defaultOpen || !collapsible)
  const opp = card.opportunity
  const standalone = opp.kind === 'standalone'
  const { form, setForm, dirty, input } = useDraftForm(card.draft, standalone)
  const actions = useReviewActions()
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

  return (
    <div data-testid={`review-card-${opp.id}`} data-state={opp.state}>
      <Card className={`review-card${open ? ' open' : ''}`}>
        <div className="review-head">
          <div className="review-id">
            <Badge tone={STATE_TONE[opp.state]}>{STATE_LABEL[opp.state]}</Badge>
            <Badge>{KIND_LABEL[opp.kind]}</Badge>
            {opp.category && <Badge>{CATEGORY_LABEL[opp.category]}</Badge>}
            {opp.decision && opp.decision !== 'reply' && <Badge tone="warn">{DECISION_LABEL[opp.decision]}</Badge>}
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

            <DraftEditor form={form} onChange={setForm} withTitle={standalone} disabled={locked || actions.busy} draft={card.draft} ai={locked ? undefined : { opportunityId: opp.id }} />
            {standalone && !locked && <ScheduleControl opportunity={opp} busy={actions.busy} onSchedule={(at) => void actions.schedule(opp.id, at)} />}

            <ActionSummary card={card} />
            <ErrorNote error={actions.error} />
            <ReviewButtons card={card} actions={actions} dirty={dirty} input={input} primaryAction={primaryAction} />
          </div>
        )}
        {footer && <div className="review-foot">{footer}</div>}
      </Card>
    </div>
  )
}
