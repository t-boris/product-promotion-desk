import { useEffect, useState } from 'react'
import { POSITIONING_KEYS, POSITIONING_QUESTION, MAX_POSITIONING_ANSWER, answersComplete, emptyAnswers, type PositioningAnswers } from '../../../../shared/positioning'
import type { Product } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Field, Hint, formatTime } from '../../ui'
import { differs, formStart } from './positioning-view'

/**
 * The positioning step of Setup (DEC-059): five answers about where the product stands. The AI proposes them from the approved passport; the
 * owner edits and approves. Approved, they are the angle of the AI's proposed posts. They are the owner's judgement, not facts of the passport.
 */
export function PositioningTab({ product }: { product: Product }) {
  const positioning = useQuery('positioning.get', { productId: product.id }, ['products'])
  const view = positioning.data
  const [form, setForm] = useState<PositioningAnswers | null>(null)
  // The form follows the stored state until the owner types: a new proposal or an approval shows at once.
  const stamp = view ? `${view.proposedAt ?? ''}|${view.approvedAt ?? ''}` : null
  useEffect(() => {
    if (view) setForm(formStart(view))
  }, [stamp])
  const [propose, proposing] = useAction(() => call('positioning.propose', { productId: product.id }))
  const [approve, approving] = useAction(() => call('positioning.approve', { productId: product.id, answers: form ?? emptyAnswers() }))
  const [dismiss, dismissing] = useAction(() => call('positioning.dismiss', { productId: product.id }))
  if (!view || !form) return positioning.error ? <ErrorNote error={positioning.error} /> : null
  const busy = proposing.busy || approving.busy || dismissing.busy
  return (
    <Card
      title="Positioning"
      actions={
        <Button onClick={() => void propose()} disabled={busy || !view.passportApproved} data-testid="positioning-propose">
          {proposing.busy ? 'Proposing…' : view.approved || view.proposed ? 'Let the AI propose again' : 'Let the AI propose'}
        </Button>
      }
    >
      <Hint>
        Five short answers about where the product stands. The AI takes the angle of the posts it proposes from them. They are your judgement, not facts: about the product the AI still states only what the passport approves.
        {!view.passportApproved && ' The AI proposes them from the approved passport: approve the passport first, or write them yourself.'}
      </Hint>
      <p className="positioning-state" data-testid="positioning-state">
        {view.proposed ? <Badge tone="warn">A proposal of the AI waits for you</Badge> : view.approved ? <Badge tone="good">Approved {formatTime(view.approvedAt)}</Badge> : <Badge>Not written yet</Badge>}
      </p>
      {POSITIONING_KEYS.map((key) => (
        <Field key={key} label={POSITIONING_QUESTION[key].title} hint={POSITIONING_QUESTION[key].ask}>
          <textarea className="input short" value={form[key]} maxLength={MAX_POSITIONING_ANSWER} onChange={(e) => setForm({ ...form, [key]: e.target.value })} disabled={busy} data-testid={`positioning-${key}`} />
        </Field>
      ))}
      <div className="positioning-actions">
        <Button variant="primary" onClick={() => void approve()} disabled={busy || !answersComplete(form) || (!differs(form, view.approved) && !view.proposed)} data-testid="positioning-approve">
          {approving.busy ? 'Saving…' : 'Approve these answers'}
        </Button>
        {view.proposed && (
          <Button onClick={() => void dismiss()} disabled={busy} data-testid="positioning-dismiss">
            {view.approved ? 'Keep what I approved' : 'Drop the proposal'}
          </Button>
        )}
      </div>
      <Hint>An answer that starts with “Assumption:” is the AI’s guess where the passport does not say: check it before you approve.</Hint>
      <ErrorNote error={proposing.error ?? approving.error ?? dismissing.error} />
    </Card>
  )
}
