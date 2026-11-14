import type { DraftInput } from '../../../../shared/api'
import type { OpportunityCard } from '../../../../shared/types'
import { Button, ConfirmAction, useMainVariant } from '../../ui'
import { approveLabels } from './approve-labels'
import { PREPARABLE_STATES } from './labels'
import { mainActionOf } from './main-action'
import { ResolveUnknown } from './ResolveUnknown'
import type { ReviewActions } from './useReviewActions'

interface Props {
  card: OpportunityCard
  actions: ReviewActions
  dirty: boolean
  /** The form as it stands; approving saves it first so the approval covers exactly what is on screen. */
  input: DraftInput
  /** This card owns the screen's one filled button; on every other card the same main action is a secondary one. */
  primaryAction?: boolean
}

/**
 * The buttons of a review card, chosen by the state of the item so the owner only sees what makes sense. The main action is
 * the rightmost; the rare ones (defer, reject) are quiet and sit at the left, away from the approving buttons. In the markup the
 * main actions come first and the rare ones last, so Tab reaches Reject after everything else and never first (BUG-039); the
 * stylesheet puts them at the left. Reject cannot be undone, so it asks first, in its own place.
 */
export function ReviewButtons({ card, actions, dirty, input, primaryAction = false }: Props) {
  const { opportunity: opp } = card
  const id = opp.id
  const hasText = input.text.trim().length > 0 || Boolean(input.link) || (input.attachments?.length ?? 0) > 0
  const main = mainActionOf(opp.state, dirty)
  // While a form opened on demand is open on the same screen, it owns the filled button (see `OpenFormsScope`).
  const resting = useMainVariant()
  const mainVariant = primaryAction && resting === 'primary' ? 'primary' : 'secondary'
  const { busy } = actions

  if (main === 'reconcile') {
    return (
      <div className="review-unknown">
        <div className="review-actions">
          <span className="muted small review-actions-note">Looks for the reply on the platform. It is never sent a second time before the result is known.</span>
          <div className="review-actions-main">
            <Button variant={mainVariant} onClick={() => void actions.reconcile(id)} disabled={busy} data-testid="reconcile">
              Check the platform
            </Button>
          </div>
        </div>
        <ResolveUnknown id={id} actions={actions} />
      </div>
    )
  }
  if (main === null) return null

  const label = approveLabels(dirty)
  return (
    <div className="review-actions" data-testid="review-buttons">
      <div className="review-actions-main">
        {main === 'approve' && !hasText && (
          <span className="muted small" data-testid="approve-reason">
            Write the text first.
          </span>
        )}
        {dirty && (
          <Button onClick={() => void actions.save(id, input)} disabled={busy || !hasText} data-testid="save-draft">
            Save draft
          </Button>
        )}
        {PREPARABLE_STATES.includes(opp.state) && opp.kind === 'reply' && (
          <Button variant="secondary" icon="sparkles" onClick={() => void actions.prepare(id)} disabled={busy} data-testid="prepare">
            {card.draft ? 'Redo with AI' : 'Draft with AI'}
          </Button>
        )}
        {main === 'send' ? (
          <Button variant={mainVariant} onClick={() => void actions.send(id)} disabled={busy} data-testid="send">
            Send now
          </Button>
        ) : (
          <>
            <Button onClick={() => void actions.approveAndSend(id, dirty ? input : undefined)} disabled={busy || !hasText} data-testid="approve-send">
              {label.approveAndSend}
            </Button>
            <Button variant={mainVariant} onClick={() => void actions.approve(id, dirty ? input : undefined)} disabled={busy || !hasText} data-testid="approve">
              {label.approve}
            </Button>
          </>
        )}
      </div>
      <div className="review-actions-side">
        {opp.state !== 'deferred' && (
          <Button variant="quiet" onClick={() => void actions.defer(id)} disabled={busy} data-testid="defer">
            Defer
          </Button>
        )}
        <ConfirmAction
          label="Reject"
          variant="quiet"
          className="danger"
          question="Rejects this for good. A rejected item cannot be reopened."
          confirmLabel="Reject"
          onConfirm={() => actions.reject(id)}
          disabled={busy}
          testId="reject"
          confirmTestId="reject-confirm"
        />
      </div>
    </div>
  )
}
