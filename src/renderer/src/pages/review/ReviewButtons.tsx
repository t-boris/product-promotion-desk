import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { OpportunityCard } from '../../../../shared/types'
import { Button, ConfirmAction, useMainVariant } from '../../ui'
import { ApproveCheck } from './ApproveCheck'
import { fingerprint, hasContent, heldFor, needsCheck, type Approving, type Held } from './approve-check'
import { approveLabels } from './approve-labels'
import { PREPARABLE_STATES } from './labels'
import { mainActionOf } from './main-action'
import { removalWords } from './removal-words'
import { ResolveUnknown } from './ResolveUnknown'
import type { ReviewActions } from './useReviewActions'

interface Props {
  card: OpportunityCard
  actions: ReviewActions
  dirty: boolean
  /** The form as it stands; approving saves it first so the approval covers exactly what is on screen. */
  input: DraftInput
  /** Why the form cannot be saved or approved as it stands (a quick post without a headline or a picture); the buttons are off and this says so. */
  blocked?: string | null
  /** Why the post cannot be approved yet (the community requires a flair and the post has none): the approving buttons are off and this says so; saving stays. */
  approveBlocked?: string | null
  /** This card owns the screen's one filled button; on every other card the same main action is a secondary one. */
  primaryAction?: boolean
  /** A secondary action that belongs to the item but not to its decision ("Also post to…"): first in the row of main actions, never filled. */
  extra?: ReactNode
  /** The test id of the main button when the screen names it itself (the Inbox's `inbox-primary`); the usual one ("approve", "send", "reconcile") then goes to `data-action`. */
  primaryTestId?: string
}

/**
 * The buttons of a review card, chosen by the state of the item so the owner only sees what makes sense. The main action is
 * the rightmost; the rare ones (defer, reject) are quiet and sit at the left, away from the approving buttons. In the markup the
 * main actions come first and the rare ones last, so Tab reaches Reject after everything else and never first (BUG-039); the
 * stylesheet puts them at the left. Reject cannot be undone, so it asks first, in its own place.
 */
export function ReviewButtons({ card, actions, dirty, input, blocked = null, approveBlocked = null, primaryAction = false, extra, primaryTestId }: Props) {
  const { opportunity: opp } = card
  const id = opp.id
  const hasText = hasContent(input, blocked)
  const main = mainActionOf(opp.state, dirty)
  const removal = removalWords(opp.kind)
  // While a form opened on demand is open on the same screen, it owns the filled button (see `OpenFormsScope`).
  const resting = useMainVariant()
  const mainVariant = primaryAction && resting === 'primary' ? 'primary' : 'secondary'
  const { busy } = actions
  // The main button's identity: its usual test id, or the one the screen gave it (then the usual one stays readable as `data-action`).
  const mainIds = (action: string): { 'data-testid': string; 'data-action'?: string } => (primaryTestId ? { 'data-testid': primaryTestId, 'data-action': action } : { 'data-testid': action })
  // A text the owner wrote is read against the rules of an AI draft before it is approved; with findings the panel stands in for the buttons.
  const [held, setHeld] = useState<Held | null>(null)
  const panel = heldFor(held, input)
  const here = useRef<HTMLDivElement>(null)
  const now = fingerprint(input)
  // The text on the screen as of the latest render: a check that comes back after the card changed under it is about another text.
  const latest = useRef(now)
  useEffect(() => {
    latest.current = now
    setHeld((current) => (current !== null && current.fingerprint !== now ? null : current))
  }, [now])

  if (main === 'reconcile') {
    return (
      <div className="review-unknown">
        <div className="review-actions">
          <span className="muted small review-actions-note">Looks for the reply on the platform. It is never sent a second time before the result is known.</span>
          <div className="review-actions-main">
            <Button variant={mainVariant} onClick={() => void actions.reconcile(id)} disabled={busy} {...mainIds('reconcile')}>
              Check the platform
            </Button>
          </div>
        </div>
        <ResolveUnknown id={id} actions={actions} />
      </div>
    )
  }
  if (main === null) {
    // An item that is out has no decision left; what can still be done with it ("Also post to…") stays.
    return extra ? (
      <div className="review-actions" data-testid="review-buttons">
        <div className="review-actions-main">{extra}</div>
      </div>
    ) : null
  }

  const label = approveLabels(dirty)
  const goOn = (which: Approving): void => {
    // What the panel said was about this press; it must not come back if the item returns to review with the same text.
    setHeld(null)
    const draft = dirty ? input : undefined
    void (which === 'approve' ? actions.approve(id, draft) : actions.approveAndSend(id, draft))
  }
  const approveWith = async (which: Approving): Promise<void> => {
    if (!needsCheck(card.draft, dirty)) return goOn(which)
    const asked = now
    const outcome = await actions.check(id, dirty ? input : undefined)
    // The card changed while the text was read (a new draft arrived): neither approve the old text nor show findings about it. The owner presses again.
    if (latest.current !== asked) return
    if (outcome.error === null && outcome.findings.length === 0) {
      setHeld(null)
      return goOn(which)
    }
    setHeld({ which, findings: outcome.findings, error: outcome.error, fingerprint: fingerprint(input) })
  }
  const editText = (): void => {
    const container = here.current?.closest('[data-review-item]')
    setHeld(null)
    container?.querySelector<HTMLElement>('textarea.draft-text')?.focus()
  }
  const side = (
    <>
      {opp.state !== 'deferred' && (
        <Button variant="quiet" onClick={() => void actions.defer(id)} disabled={busy} data-testid="defer">
          Defer
        </Button>
      )}
      {/* A post of the owner's is deleted, not rejected: it is theirs, and nothing of it was sent. Under the hood it is the same cancel. */}
      <ConfirmAction
        label={removal.label}
        variant="quiet"
        className="danger"
        question={removal.question}
        confirmLabel={removal.label}
        onConfirm={() => actions.reject(id)}
        disabled={busy}
        testId="reject"
        confirmTestId="reject-confirm"
      />
    </>
  )
  if (panel !== null && main === 'approve') {
    return (
      <div ref={here}>
        <ApproveCheck held={panel} onEdit={editText} onApprove={() => goOn(panel.which)} busy={busy} editVariant={mainVariant} side={side} />
      </div>
    )
  }
  return (
    <div className="review-actions" data-testid="review-buttons" ref={here}>
      <div className="review-actions-main">
        {extra}
        {main === 'approve' && (!hasText || approveBlocked !== null) && (
          <span className="muted small" data-testid="approve-reason">
            {!hasText ? (blocked ?? 'Write the text first.') : approveBlocked}
          </span>
        )}
        {dirty && (
          <Button onClick={() => void actions.save(id, input)} disabled={busy || !hasText} data-testid="save-draft">
            Save draft
          </Button>
        )}
        {PREPARABLE_STATES.includes(opp.state) && opp.kind === 'reply' &&
          (dirty ? (
            // A new draft replaces the form: what the owner typed and has not saved is never dropped without asking (lesson 84).
            <ConfirmAction
              label={card.draft ? 'Redo with AI' : 'Draft with AI'}
              icon="sparkles"
              variant="secondary"
              question="The new draft replaces what you changed and did not save."
              confirmLabel="Replace my changes"
              onConfirm={() => actions.prepare(id)}
              disabled={busy}
              testId="prepare"
              confirmTestId="prepare-confirm"
            />
          ) : (
            <Button variant="secondary" icon="sparkles" onClick={() => void actions.prepare(id)} disabled={busy} data-testid="prepare">
              {card.draft ? 'Redo with AI' : 'Draft with AI'}
            </Button>
          ))}
        {main === 'send' ? (
          <Button variant={mainVariant} onClick={() => void actions.send(id)} disabled={busy} {...mainIds('send')}>
            Send now
          </Button>
        ) : (
          <>
            <Button onClick={() => void approveWith('approve_send')} disabled={busy || !hasText || approveBlocked !== null} data-testid="approve-send">
              {label.approveAndSend}
            </Button>
            <Button variant={mainVariant} onClick={() => void approveWith('approve')} disabled={busy || !hasText || approveBlocked !== null} {...mainIds('approve')}>
              {label.approve}
            </Button>
          </>
        )}
      </div>
      <div className="review-actions-side">{side}</div>
    </div>
  )
}
