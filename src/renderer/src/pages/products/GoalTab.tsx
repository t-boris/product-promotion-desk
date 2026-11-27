import { useEffect, useRef, useState } from 'react'
import type { GoalIdea, Id, Product, PromotionGoal } from '../../../../shared/types'
import { AiField } from '../../assist/AiField'
import type { Blocked } from '../../assist/block'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ConfirmAction, ErrorNote, Hint, More, useOpenForm } from '../../ui'
import { GoalIdeas } from './GoalIdeas'
import { GoalTargetRow } from './GoalTargetRow'
import { around, fieldsFromIdea, hasText, type GoalFields } from './goal-ideas'
import { useTabMainVariant } from './LaunchPath'
import { lines } from './model'

/** What "Use this" hands to the new goal's form. Cleared by the form once it has taken it. */
interface Prefill {
  fields: GoalFields
}

const fieldsOf = (goal: PromotionGoal | null): GoalFields => ({ targetAction: goal?.targetAction ?? '', metrics: (goal?.successMetrics ?? []).join('\n'), notes: goal?.notes ?? '' })

/** The same text, whatever the spacing: what is saved is trimmed, one metric per non-empty line. */
const normalized = (f: GoalFields): GoalFields => ({ targetAction: f.targetAction.trim(), metrics: lines(f.metrics).join('\n'), notes: f.notes.trim() })

const sameFields = (a: GoalFields, b: GoalFields): boolean => a.targetAction === b.targetAction && a.metrics === b.metrics && a.notes === b.notes

/**
 * The promotion goals (REQ-006, DEC-012): what a person should do after meeting the product, and how the owner judges it. A product
 * can have several. They are kept with the product and shown on the Overview, and the AI sees them when it plans a channel; they do
 * not change the replies and posts it drafts and do not measure conversions. The AI proposes one goal at a time and can write or
 * improve each field; the owner always saves the goal.
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
  // "Use this" on an idea: opens the new goal's card and hands it the idea's text. Ideas need the approved passport; writing a field does not.
  const ideaHelp = useAssistBlock({ productId: product.id, needsPassport: true })
  const fieldHelp = useAssistBlock({ productId: product.id, needsPassport: false })
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const useIdea = (idea: GoalIdea): void => {
    setAdding(true)
    setPrefill({ fields: fieldsFromIdea(idea) })
  }

  return (
    <Card title="Promotion goals">
      <div className="stack">
        <Hint tone="strong">What should a person do after they meet {product.name}? Each goal is a note kept with the product and shown on the Overview next to the platforms’ numbers.</Hint>
        <More label="What a goal does and does not do">
          <Hint>A goal is the one thing you want people to do, and how you will judge it.</Hint>
          <Hint>The AI sees your goals when it plans a channel; they do not change the replies and posts it drafts, and they do not count sign-ups or purchases: the app has no access to your own site’s data.</Hint>
          <Hint>A saved goal can get a number and a date: the app then counts what it can count itself (posts and replies sent, likes and comments under them, people added) and shows how far it is.</Hint>
        </More>
        <GoalIdeas productId={product.id} blocked={ideaHelp.blocked} engineLabel={ideaHelp.engineLabel} onUse={useIdea} />
      <div className="rows">
        {goals.map((goal, index) => (
          <GoalCard
            key={goal.id}
            productId={product.id}
            goal={goal}
            heading={`Goal ${index + 1}`}
            saved={goal.id === savedId}
            fieldBlock={fieldHelp.blocked}
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
            fieldBlock={fieldHelp.blocked}
            prefill={prefill}
            onPrefillTaken={() => setPrefill(null)}
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
  fieldBlock,
  prefill,
  onPrefillTaken,
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
  /** Why the AI cannot write or improve a field (null when it can). */
  fieldBlock: Blocked | null
  /** An idea the owner chose with "Use this"; only a new goal's card takes it. */
  prefill?: Prefill | null
  onPrefillTaken?: () => void
  onEdit: () => void
  /** The product after a save or a removal, and the id of the goal that was saved (null after a removal). */
  onChanged: (product: Product, savedGoalId: Id | null) => void
  onCancel?: () => void
  onOpenResults: () => void
}) {
  const [fields, setFields] = useState<GoalFields>(() => fieldsOf(goal))
  // An idea that filled this form: what was in it before (to undo), and what the idea wrote (the note shows while the owner has not changed it).
  const [fromIdea, setFromIdea] = useState<{ before: GoalFields; filled: GoalFields } | null>(null)
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields
  const targetRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!prefill || goal !== null) return
    setFromIdea({ before: fieldsRef.current, filled: prefill.fields })
    setFields(prefill.fields)
    onPrefillTaken?.()
    targetRef.current?.focus()
  }, [prefill, goal, onPrefillTaken])
  // What is stored for this goal right now; a new goal has nothing stored.
  const [stored, setStored] = useState<GoalFields | null>(() => (goal ? normalized(fieldsOf(goal)) : null))
  // A stored goal is a compact card (what to do, how it is judged) until the owner presses Edit; a new goal is a form from the start.
  const [editing, setEditing] = useState(goal === null)
  // The form is on demand when the owner opened it: an edit of a stored goal, or a new card that can be cancelled. The lone first-goal
  // form is the screen's resting main action, so it steps back while an on-demand form of the screen is open, and while the goal is not the path's
  // next stage (the path's own next stage owns the filled button then, BUG-065).
  const onDemand = goal !== null ? editing : onCancel !== undefined
  const saveVariant = useOpenForm(onDemand)
  const restingVariant = useTabMainVariant('goal')
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
        <GoalTargetRow productId={productId} goalId={goal.id} />
        {saved && (
          <div className="note good" role="status" data-testid={`goal-saved-${id}`}>
            <span>Goal saved. It now appears on the Overview.</span>{' '}
            <Button onClick={onOpenResults} data-testid={`goal-open-results-${id}`}>
              Show on Overview
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
          <ConfirmAction
            label="Remove goal"
            variant="quiet"
            className="danger"
            question="Removes this goal from the product."
            confirmLabel="Remove"
            onConfirm={() => remove()}
            testId={`goal-remove-${id}`}
            confirmTestId={`goal-remove-confirm-${id}`}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="goal-card" data-testid={`goal-card-${id}`}>
      <strong>{heading}</strong>
      {fromIdea && sameFields(normalized(fields), normalized(fromIdea.filled)) && (
        <div className="ai-undo" role="status" data-testid={`goal-from-idea-${id}`}>
          <span className="hint">Filled from the AI’s idea. Check it, then add the goal.</span>
          {hasText(fromIdea.before) && (
            <Button
              variant="quiet"
              onClick={() => {
                setFields(fromIdea.before)
                setFromIdea(null)
              }}
              data-testid={`goal-from-idea-undo-${id}`}
            >
              Undo
            </Button>
          )}
        </div>
      )}
      <AiField
        label="Target action"
        hint="The one thing you want people to do, for example: create the first natal chart, join the waitlist."
        field="goal.targetAction"
        productId={productId}
        value={fields.targetAction}
        onChange={(text) => change({ targetAction: text })}
        around={around(fields, 'targetAction')}
        blocked={fieldBlock}
        testId={`goal-target-ai-${id}`}
      >
        {(inputId) => <input id={inputId} ref={targetRef} className="input" value={fields.targetAction} onChange={(e) => change({ targetAction: e.target.value })} data-testid={`goal-target-${id}`} />}
      </AiField>
      <AiField
        label="Success metrics"
        hint="One per line, for example: charts created, sign-ups, return visits."
        field="goal.metrics"
        productId={productId}
        value={fields.metrics}
        onChange={(text) => change({ metrics: text })}
        around={around(fields, 'metrics')}
        blocked={fieldBlock}
        testId={`goal-metrics-ai-${id}`}
      >
        {(inputId) => <textarea id={inputId} className="input" value={fields.metrics} onChange={(e) => change({ metrics: e.target.value })} data-testid={`goal-metrics-${id}`} />}
      </AiField>
      <AiField
        label="Notes (optional)"
        field="goal.notes"
        productId={productId}
        value={fields.notes}
        onChange={(text) => change({ notes: text })}
        around={around(fields, 'notes')}
        blocked={fieldBlock}
        testId={`goal-notes-ai-${id}`}
      >
        {(inputId) => <textarea id={inputId} className="input" value={fields.notes} onChange={(e) => change({ notes: e.target.value })} data-testid={`goal-notes-${id}`} />}
      </AiField>
      <ErrorNote error={saving.error ?? removing.error} />
      <div className="row">
        <Button variant={onDemand ? saveVariant : restingVariant} onClick={() => void save()} disabled={!canSave} data-testid={`goal-save-${id}`}>
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
        {goal && (
          <ConfirmAction
            label="Remove goal"
            question="Removes this goal from the product."
            confirmLabel="Remove"
            onConfirm={() => remove()}
            testId={`goal-remove-${id}`}
            confirmTestId={`goal-remove-confirm-${id}`}
          />
        )}
      </div>
    </div>
  )
}
