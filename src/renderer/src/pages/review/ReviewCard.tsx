import { useState } from 'react'
import type { OpportunityCard } from '../../../../shared/types'
import { Badge, Button, Card, ErrorNote, formatTime } from '../../ui'
import { ActionSummary } from './ActionSummary'
import { DraftEditor, useDraftForm } from './DraftEditor'
import { ReviewButtons } from './ReviewButtons'
import { ScheduleControl } from './ScheduleControl'
import { ThreadView } from './ThreadView'
import { CATEGORY_LABEL, DECISION_LABEL, KIND_LABEL, LOCKED_STATES, STATE_HINT, STATE_LABEL, STATE_TONE } from './labels'
import { useReviewActions } from './useReviewActions'

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
}

/**
 * One item that needs a decision, with everything needed to make it: the original comment and its thread, the
 * draft with its basis, the account and destination an approval is bound to, and the reason for the current
 * state, including why a send was blocked (REQ-003, REQ-004).
 */
export function ReviewCard({ card, collapsible = false, defaultOpen = true, productName }: Props) {
  const [open, setOpen] = useState(defaultOpen || !collapsible)
  const opp = card.opportunity
  const standalone = opp.kind === 'standalone'
  const { form, setForm, dirty, input } = useDraftForm(card.draft, standalone)
  const actions = useReviewActions()
  const locked = LOCKED_STATES.includes(opp.state) || opp.state === 'analyzing' || opp.state === 'cancelled'
  const hint = STATE_HINT[opp.state]
  const summary = standalone ? card.draft?.title || card.draft?.text || 'New publication' : (card.comment?.body ?? 'Comment')

  return (
    <div data-testid={`review-card-${opp.id}`} data-state={opp.state}>
      <Card>
        <div className="card-head">
          <div className="row">
            <Badge tone={STATE_TONE[opp.state]}>{STATE_LABEL[opp.state]}</Badge>
            <Badge>{KIND_LABEL[opp.kind]}</Badge>
            {opp.category && <Badge>{CATEGORY_LABEL[opp.category]}</Badge>}
            {opp.decision && opp.decision !== 'reply' && <Badge tone="warn">{DECISION_LABEL[opp.decision]}</Badge>}
            {productName && (
              <Badge tone="info">
                <span data-testid="card-product">{productName}</span>
              </Badge>
            )}
            <strong data-testid="card-channel">{card.channelTarget}</strong>
            <span className="muted small">as {card.accountLabel}</span>
          </div>
          <div className="row">
            <span className="muted small">{formatTime(opp.updatedAt)}</span>
            {collapsible && (
              <Button onClick={() => setOpen(!open)} data-testid="toggle-card">
                {open ? 'Close' : 'Open'}
              </Button>
            )}
          </div>
        </div>

        {!open && <div className="muted" data-testid="card-summary">{excerpt(summary)}</div>}

        {open && (
          <div className="stack">
            {opp.reason && (
              <div data-testid="state-reason">
                <strong>{opp.reason}</strong>
              </div>
            )}
            {hint && <div className="muted small">{hint}</div>}
            {!standalone && <ThreadView card={card} />}
            {standalone && opp.destination && (
              <div className="muted small">
                Will be posted to <code>{opp.destination}</code>
              </div>
            )}

            <DraftEditor form={form} onChange={setForm} withTitle={standalone} disabled={locked || actions.busy} draft={card.draft} />
            {standalone && !locked && <ScheduleControl opportunity={opp} busy={actions.busy} onSchedule={(at) => void actions.schedule(opp.id, at)} />}

            <ActionSummary card={card} />
            <ErrorNote error={actions.error} />
            <ReviewButtons card={card} actions={actions} dirty={dirty} input={input} />
          </div>
        )}
      </Card>
    </div>
  )
}
