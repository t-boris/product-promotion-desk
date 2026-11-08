import { useState } from 'react'
import type { Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field } from '../../ui'
import { lines } from './model'

interface GoalFields {
  targetAction: string
  metrics: string
  notes: string
}

const fieldsOf = (goal: Product['goal']): GoalFields => ({ targetAction: goal?.targetAction ?? '', metrics: (goal?.successMetrics ?? []).join('\n'), notes: goal?.notes ?? '' })

/** The same text, whatever the spacing: what is saved is trimmed, one metric per non-empty line. */
const normalized = (f: GoalFields): GoalFields => ({ targetAction: f.targetAction.trim(), metrics: lines(f.metrics).join('\n'), notes: f.notes.trim() })

const sameFields = (a: GoalFields, b: GoalFields): boolean => a.targetAction === b.targetAction && a.metrics === b.metrics && a.notes === b.notes

/**
 * The promotion goal (REQ-006): what a person should do after meeting the product, and how the owner judges it. In version 1 the
 * goal is kept with the product and shown on the Results tab; it does not steer the AI and does not measure conversions.
 */
export function GoalTab({ product, onOpenResults }: { product: Product; onOpenResults: () => void }) {
  const [fields, setFields] = useState<GoalFields>(() => fieldsOf(product.goal))
  // What is stored right now; updated the moment a save succeeds so the screen does not wait for the product to reload.
  const [stored, setStored] = useState<GoalFields>(() => normalized(fieldsOf(product.goal)))
  const [justSaved, setJustSaved] = useState(false)
  const [save, state] = useAction(async () => {
    const next = normalized(fields)
    const result = await call('products.setGoal', { id: product.id, goal: { targetAction: next.targetAction, successMetrics: lines(next.metrics), notes: next.notes } })
    setStored(next)
    setJustSaved(true)
    return result
  })

  const change = (patch: Partial<GoalFields>): void => {
    setJustSaved(false)
    setFields((current) => ({ ...current, ...patch }))
  }

  const current = normalized(fields)
  const dirty = !sameFields(current, stored)
  const clearing = current.targetAction === '' && current.metrics === '' && current.notes === ''
  const needsTarget = current.targetAction === '' && !clearing
  const canSave = dirty && !needsTarget && !state.busy

  return (
    <Card title="Promotion goal">
      <p>What should a person do after they meet {product.name}? Write it down once, and the Results tab shows it next to the numbers the platforms provide.</p>
      <p className="muted small">
        In this version the goal is a note kept with the product. It does not change what the AI writes, and it does not count sign-ups or purchases: the app has no access to your own site’s data.
      </p>
      <Field label="Target action" hint="The one thing you want people to do, for example: create the first natal chart, install the app, join the waitlist.">
        <input className="input" value={fields.targetAction} onChange={(e) => change({ targetAction: e.target.value })} data-testid="goal-target" />
      </Field>
      <Field label="Success metrics" hint="How you will judge it, one per line, for example: charts created, sign-ups, return visits. These are your own yardsticks; the app does not collect them.">
        <textarea className="input" value={fields.metrics} onChange={(e) => change({ metrics: e.target.value })} data-testid="goal-metrics" />
      </Field>
      <Field label="Notes (optional)" hint="Anything worth remembering, for example the period or the audience.">
        <textarea className="input" value={fields.notes} onChange={(e) => change({ notes: e.target.value })} data-testid="goal-notes" />
      </Field>
      <ErrorNote error={state.error} />
      <div className="row">
        <Button variant="primary" onClick={() => void save()} disabled={!canSave} data-testid="goal-save">
          {state.busy ? 'Saving…' : 'Save goal'}
        </Button>
        {needsTarget && (
          <span className="muted small" data-testid="goal-needs-target">
            Write the target action to save the goal.
          </span>
        )}
        {!dirty && !justSaved && !clearing && (
          <span className="muted small" data-testid="goal-unchanged">
            Nothing to save: this is the stored goal.
          </span>
        )}
      </div>
      {justSaved && !dirty && (
        <div className="note good" role="status" data-testid="goal-saved">
          <span>{clearing ? 'The goal was cleared.' : 'Goal saved. It now appears on the Results tab.'}</span>{' '}
          <Button onClick={onOpenResults} data-testid="goal-open-results">
            Show on Results
          </Button>
        </div>
      )}
    </Card>
  )
}
