import { useState } from 'react'
import type { Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field } from '../../ui'
import { lines } from './model'

/** The promotion goal: what a person should do after meeting the product, and how success is judged. */
export function GoalTab({ product }: { product: Product }) {
  const goal = product.goal
  const [targetAction, setTargetAction] = useState(goal?.targetAction ?? '')
  const [metrics, setMetrics] = useState((goal?.successMetrics ?? []).join('\n'))
  const [notes, setNotes] = useState(goal?.notes ?? '')
  const [saved, setSaved] = useState(false)
  const [save, state] = useAction(async () => {
    const result = await call('products.setGoal', { id: product.id, goal: { targetAction: targetAction.trim(), successMetrics: lines(metrics), notes: notes.trim() } })
    setSaved(true)
    return result
  })

  const touch = <T,>(set: (value: T) => void) => (value: T): void => {
    setSaved(false)
    set(value)
  }

  return (
    <Card title="Promotion goal">
      <p className="muted">The goal tells the drafting and review steps what a good result looks like. It also appears next to the results.</p>
      <Field label="Target action" hint="For example: create the first natal chart, install the app, join the waitlist.">
        <input className="input" value={targetAction} onChange={(e) => touch(setTargetAction)(e.target.value)} data-testid="goal-target" />
      </Field>
      <Field label="Success metrics" hint="One per line, for example: charts created, sign-ups, return visits.">
        <textarea className="input" value={metrics} onChange={(e) => touch(setMetrics)(e.target.value)} data-testid="goal-metrics" />
      </Field>
      <Field label="Notes">
        <textarea className="input" value={notes} onChange={(e) => touch(setNotes)(e.target.value)} data-testid="goal-notes" />
      </Field>
      <ErrorNote error={state.error} />
      <div className="row">
        <Button variant="primary" onClick={() => void save()} disabled={state.busy} data-testid="goal-save">
          {state.busy ? 'Saving…' : 'Save goal'}
        </Button>
        {saved && (
          <span className="muted small" role="status" data-testid="goal-saved">
            Saved
          </span>
        )}
      </div>
    </Card>
  )
}
