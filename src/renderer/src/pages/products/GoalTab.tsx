import { useEffect, useState } from 'react'
import type { Id, Product, PromotionGoal } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Field, Hint, More } from '../../ui'
import { lines } from './model'

interface GoalFields {
  targetAction: string
  metrics: string
  notes: string
}

const fieldsOf = (goal: PromotionGoal | null): GoalFields => ({ targetAction: goal?.targetAction ?? '', metrics: (goal?.successMetrics ?? []).join('\n'), notes: goal?.notes ?? '' })

/** The same text, whatever the spacing: what is saved is trimmed, one metric per non-empty line. */
const normalized = (f: GoalFields): GoalFields => ({ targetAction: f.targetAction.trim(), metrics: lines(f.metrics).join('\n'), notes: f.notes.trim() })

const sameFields = (a: GoalFields, b: GoalFields): boolean => a.targetAction === b.targetAction && a.metrics === b.metrics && a.notes === b.notes

/**
 * The promotion goals (REQ-006, DEC-012): what a person should do after meeting the product, and how the owner judges it. A product
 * can have several. In version 1 they are kept with the product and shown on the Results tab; they do not steer the AI and do not
 * measure conversions.
 */
export function GoalTab({ product, onOpenResults }: { product: Product; onOpenResults: () => void }) {
  // The list is taken from every save and removal at once, so the screen does not wait for the product to reload.
  const [goals, setGoals] = useState<PromotionGoal[]>(product.goals)
  useEffect(() => setGoals(product.goals), [product.goals])
  // A new goal is written in a card of its own and joins the list when it is saved. With no goal at all, that card is already open.
  const [adding, setAdding] = useState(false)
  const showNew = adding || goals.length === 0
  // The goal saved last. Only its card shows the confirmation, so the owner sees one message and not one per card; a new goal's card is
  // replaced by the card of the stored goal, which is why this lives here and not in the card.
  const [savedId, setSavedId] = useState<Id | null>(null)

  return (
    <Card title="Promotion goals">
      <div className="stack">
        <Hint tone="strong">What should a person do after they meet {product.name}? Each goal is a note kept with the product and shown on the Results tab next to the platforms’ numbers.</Hint>
        <More label="What a goal does and does not do">
          <Hint>A goal is the one thing you want people to do, and how you will judge it.</Hint>
          <Hint>In this version goals do not change what the AI writes, and they do not count sign-ups or purchases: the app has no access to your own site’s data.</Hint>
        </More>
      <div className="stack">
        {goals.map((goal, index) => (
          <GoalCard
            key={goal.id}
            productId={product.id}
            goal={goal}
            heading={`Goal ${index + 1}`}
            saved={goal.id === savedId}
            onEdit={() => setSavedId((id) => (id === goal.id ? null : id))}
            onChanged={(next, savedGoalId) => {
              setGoals(next.goals)
              setSavedId(savedGoalId)
            }}
            onOpenResults={onOpenResults}
          />
        ))}
        {showNew && (
          <GoalCard
            key="new"
            productId={product.id}
            goal={null}
            heading={`Goal ${goals.length + 1}`}
            saved={false}
            onEdit={() => undefined}
            onChanged={(next) => {
              setSavedId(next.goals.find((g) => !goals.some((known) => known.id === g.id))?.id ?? null)
              setGoals(next.goals)
              setAdding(false)
            }}
            onCancel={goals.length > 0 ? () => setAdding(false) : undefined}
            onOpenResults={onOpenResults}
          />
        )}
      </div>
      {!showNew && (
        <div className="row">
          <Button onClick={() => setAdding(true)} data-testid="goal-add">
            Add a goal
          </Button>
        </div>
      )}
      </div>
    </Card>
  )
}

/** One goal: either a stored one (edit, remove) or a new one that has not been saved yet. */
function GoalCard({
  productId,
  goal,
  heading,
  saved,
  onEdit,
  onChanged,
  onCancel,
  onOpenResults
}: {
  productId: string
  goal: PromotionGoal | null
  heading: string
  /** True while this is the goal saved last and it has not been edited since. */
  saved: boolean
  onEdit: () => void
  /** The product after a save or a removal, and the id of the goal that was saved (null after a removal). */
  onChanged: (product: Product, savedGoalId: Id | null) => void
  onCancel?: () => void
  onOpenResults: () => void
}) {
  const [fields, setFields] = useState<GoalFields>(() => fieldsOf(goal))
  // What is stored for this goal right now; a new goal has nothing stored.
  const [stored, setStored] = useState<GoalFields | null>(() => (goal ? normalized(fieldsOf(goal)) : null))
  const [confirmRemove, setConfirmRemove] = useState(false)
  // A stored goal is a compact card (what to do, how it is judged) until the owner presses Edit; a new goal is a form from the start.
  const [editing, setEditing] = useState(goal === null)
  const [save, saving] = useAction(async () => {
    const next = normalized(fields)
    const result = await call('products.saveGoal', { id: productId, goal: { ...(goal ? { id: goal.id } : {}), targetAction: next.targetAction, successMetrics: lines(next.metrics), notes: next.notes } })
    setStored(next)
    onChanged(result, goal?.id ?? null)
    setEditing(goal === null)
    return result
  })
  const [remove, removing] = useAction(async () => {
    if (!goal) return
    onChanged(await call('products.removeGoal', { id: productId, goalId: goal.id }), null)
  })

  const change = (patch: Partial<GoalFields>): void => {
    onEdit()
    setFields((current) => ({ ...current, ...patch }))
  }

  const current = normalized(fields)
  const dirty = stored === null ? true : !sameFields(current, stored)
  const needsTarget = current.targetAction === ''
  const canSave = dirty && !needsTarget && !saving.busy
  const id = goal?.id ?? 'new'

  if (goal && !editing) {
    return (
      <div className="goal-card" data-testid={`goal-card-${id}`}>
        <div className="goal-summary-head">
          <strong>{heading}</strong>
          {saved && (
            <Badge tone="good" >Saved</Badge>
          )}
        </div>
        <div className="goal-target" data-testid={`goal-summary-target-${id}`}>
          {goal.targetAction}
        </div>
        {goal.successMetrics.length > 0 && (
          <div className="row" aria-label="Success metrics">
            {goal.successMetrics.map((metric) => (
              <Badge key={metric}>{metric}</Badge>
            ))}
          </div>
        )}
        {goal.notes && <Hint>{goal.notes}</Hint>}
        {saved && (
          <div className="note good" role="status" data-testid={`goal-saved-${id}`}>
            <span>Goal saved. It now appears on the Results tab.</span>{' '}
            <Button onClick={onOpenResults} data-testid={`goal-open-results-${id}`}>
              Show on Results
            </Button>
          </div>
        )}
        <ErrorNote error={removing.error} />
        <div className="row">
          <Button
            onClick={() => {
              onEdit()
              setEditing(true)
            }}
            data-testid={`goal-edit-${id}`}
          >
            Edit
          </Button>
          <span className="sep" />
          {confirmRemove ? (
            <>
              <span className="hint strong">Removes this goal from the product.</span>
              <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`goal-remove-confirm-${id}`}>
                Remove
              </Button>
              <Button variant="quiet" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="quiet" className="danger" onClick={() => setConfirmRemove(true)} data-testid={`goal-remove-${id}`}>
              Remove goal
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="goal-card" data-testid={`goal-card-${id}`}>
      <strong>{heading}</strong>
      <Field label="Target action" hint="The one thing you want people to do, for example: create the first natal chart, join the waitlist.">
        <input className="input" value={fields.targetAction} onChange={(e) => change({ targetAction: e.target.value })} data-testid={`goal-target-${id}`} />
      </Field>
      <Field label="Success metrics" hint="One per line, for example: charts created, sign-ups, return visits.">
        <textarea className="input" value={fields.metrics} onChange={(e) => change({ metrics: e.target.value })} data-testid={`goal-metrics-${id}`} />
      </Field>
      <Field label="Notes (optional)">
        <textarea className="input" value={fields.notes} onChange={(e) => change({ notes: e.target.value })} data-testid={`goal-notes-${id}`} />
      </Field>
      <ErrorNote error={saving.error ?? removing.error} />
      <div className="row">
        <Button variant="primary" onClick={() => void save()} disabled={!canSave} data-testid={`goal-save-${id}`}>
          {saving.busy ? 'Saving…' : goal ? 'Save goal' : 'Add goal'}
        </Button>
        {needsTarget && dirty && (
          <span className="hint warn" data-testid={`goal-needs-target-${id}`}>
            Write the target action to save the goal.
          </span>
        )}
        {goal && !dirty && !saved && (
          <span className="hint" data-testid={`goal-unchanged-${id}`}>
            Nothing to save: this is the stored goal.
          </span>
        )}
        <span className="sep" />
        {!goal && onCancel && <Button onClick={onCancel}>Cancel</Button>}
        {goal && (
          <Button
            variant="quiet"
            onClick={() => {
              setFields(fieldsOf(goal))
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        )}
        {goal &&
          (confirmRemove ? (
            <>
              <span className="muted small">Removes this goal from the product.</span>
              <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`goal-remove-confirm-${id}`}>
                Remove
              </Button>
              <Button onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmRemove(true)} data-testid={`goal-remove-${id}`}>
              Remove goal
            </Button>
          ))}
      </div>
    </div>
  )
}
