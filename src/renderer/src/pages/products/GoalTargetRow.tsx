import { useState } from 'react'
import { GOAL_MEASURES, GOAL_MEASURE_LABEL, MAX_GOAL_NUMBER, isDay, progressLine, type GoalMeasure, type GoalProgress } from '../../../../shared/goal-target'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Field, Hint } from '../../ui'

const STATE_TONE = { running: undefined, reached: 'good', missed: 'bad' } as const
const STATE_LABEL = { running: 'Running', reached: 'Reached', missed: 'Not reached' } as const

/**
 * A goal's number and date (DEC-067): a count the application makes itself (what it sent, what the sites show under it, the people added),
 * the number to reach and the day it is due by, with how far it is. It does not count visits, sign-ups or sales.
 */
export function GoalTargetRow({ productId, goalId }: { productId: string; goalId: string }) {
  const all = useQuery('goals.progress', { productId }, ['products', 'results', 'opportunities'])
  const kept = all.data?.find((p) => p.goalId === goalId) ?? null
  const [editing, setEditing] = useState(false)
  if (!all.data) return null
  if (editing) return <TargetForm productId={productId} goalId={goalId} kept={kept} onClose={() => setEditing(false)} />
  if (!kept) {
    return (
      <div className="row">
        <Button onClick={() => setEditing(true)} data-testid={`goal-number-add-${goalId}`}>
          Set a number and a date
        </Button>
      </div>
    )
  }
  return (
    <div className="row" data-testid={`goal-number-${goalId}`}>
      <Badge tone={STATE_TONE[kept.state]}>{STATE_LABEL[kept.state]}</Badge>
      <span>{progressLine(kept)}</span>
      <span className="muted">due {kept.by}</span>
      <Button variant="quiet" onClick={() => setEditing(true)} data-testid={`goal-number-change-${goalId}`}>
        Change the number
      </Button>
    </div>
  )
}

function TargetForm({ productId, goalId, kept, onClose }: { productId: string; goalId: string; kept: GoalProgress | null; onClose: () => void }) {
  const [measure, setMeasure] = useState<GoalMeasure>(kept?.measure ?? 'comments')
  const [number, setNumber] = useState(kept ? String(kept.number) : '')
  const [by, setBy] = useState(kept?.by ?? '')
  const [save, saving] = useAction(async (target: { measure: GoalMeasure; number: number; by: string } | null) => {
    await call('goals.setTarget', { productId, goalId, target })
    onClose()
  })
  const n = Number(number)
  const ready = Number.isInteger(n) && n >= 1 && n <= MAX_GOAL_NUMBER && isDay(by)
  return (
    <div className="stack" data-testid={`goal-number-form-${goalId}`}>
      <div className="goal-number-fields">
        <Field label="What to count">
          <select className="input" value={measure} onChange={(e) => setMeasure(e.target.value as GoalMeasure)} disabled={saving.busy} data-testid={`goal-number-measure-${goalId}`}>
            {GOAL_MEASURES.map((id) => (
              <option key={id} value={id}>
                {GOAL_MEASURE_LABEL[id]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Number to reach">
          <input className="input" type="number" min={1} max={MAX_GOAL_NUMBER} step={1} value={number} onChange={(e) => setNumber(e.target.value)} disabled={saving.busy} data-testid={`goal-number-value-${goalId}`} />
        </Field>
        <Field label="By">
          <input className="input" type="date" value={by} onChange={(e) => setBy(e.target.value)} disabled={saving.busy} data-testid={`goal-number-by-${goalId}`} />
        </Field>
      </div>
      <Hint>The application counts this itself, from the moment you save: what it sent and what the sites show under it. It cannot count visits, sign-ups or sales. Choosing another thing to count starts the count over.</Hint>
      <div className="row">
        <Button variant="primary" onClick={() => void save({ measure, number: n, by })} disabled={saving.busy || !ready} data-testid={`goal-number-save-${goalId}`}>
          {saving.busy ? 'Saving…' : 'Save the number'}
        </Button>
        <Button variant="quiet" onClick={onClose} disabled={saving.busy}>
          Cancel
        </Button>
        {kept && (
          <Button onClick={() => void save(null)} disabled={saving.busy} data-testid={`goal-number-remove-${goalId}`}>
            Remove the number
          </Button>
        )}
      </div>
      <ErrorNote error={saving.error} />
    </div>
  )
}

/** The same line for a read-only place (the Overview): how far the goal's number is, or nothing when it has none. */
export function GoalProgressNote({ productId, goalId }: { productId: string; goalId: string }) {
  const all = useQuery('goals.progress', { productId }, ['products', 'results', 'opportunities'])
  const kept = all.data?.find((p) => p.goalId === goalId)
  if (!kept) return null
  return (
    <div className="row" data-testid={`goal-progress-${goalId}`}>
      <Badge tone={STATE_TONE[kept.state]}>{STATE_LABEL[kept.state]}</Badge>
      <span>{progressLine(kept)}</span>
      <span className="muted">due {kept.by}</span>
    </div>
  )
}
