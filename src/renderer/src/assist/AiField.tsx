import { useId, useState, type ReactNode } from 'react'
import type { AssistField } from '../../../shared/types'
import { call, useAction } from '../hooks'
import { Button, ErrorNote, Hint } from '../ui'
import type { Blocked } from './block'
import { canUndo, fieldAction, type AppliedText } from './field-logic'
import './assist.css'

/**
 * A text field with the AI beside its label: "Suggest with AI" writes an empty field, "Improve with AI" rewrites a filled one (the
 * owner can say what to change). The text goes into the field, never into storage: the owner reads it and saves the form. "Undo"
 * puts back what was there, for as long as the owner has not typed over the AI's text (the owner's typing is never replaced silently).
 * The AI control is never the filled button (V-10).
 */
export function AiField({
  label,
  hint,
  field,
  productId,
  channelId,
  value,
  onChange,
  around,
  blocked,
  testId,
  children
}: {
  label: string
  hint?: string
  field: AssistField
  productId?: string
  /** For a channel's text: the channel it is written for. */
  channelId?: string
  value: string
  onChange: (text: string) => void
  /** What the owner wrote in the other fields of the same form, so the AI fits the field into it. */
  around?: { label: string; text: string }[]
  blocked: Blocked | null
  testId: string
  /** The input itself; it takes the id that ties it to the label. */
  children: (id: string) => ReactNode
}) {
  const id = useId()
  const [wishOpen, setWishOpen] = useState(false)
  const [wish, setWish] = useState('')
  const [applied, setApplied] = useState<AppliedText | null>(null)
  const action = fieldAction(value)

  const [run, state] = useAction(async () => {
    const before = value
    const result = await call('assist.refine', { field, productId, channelId, current: value, instruction: action.kind === 'improve' ? wish : undefined, around })
    onChange(result.text)
    setApplied({ text: result.text, before })
    setWishOpen(false)
    setWish('')
  })

  const start = (): void => {
    if (action.kind === 'improve') setWishOpen((open) => !open)
    else void run()
  }

  return (
    <div className="field ai-field" data-testid={`${testId}-field`}>
      <div className="field-head">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <Button variant="secondary" onClick={start} disabled={blocked !== null || state.busy} data-testid={`${testId}-ai`} aria-expanded={action.kind === 'improve' ? wishOpen : undefined}>
          {state.busy ? 'Thinking…' : action.label}
        </Button>
      </div>
      {children(id)}
      {hint && <span className="hint">{hint}</span>}
      {wishOpen && !state.busy && (
        <div className="ai-wish" data-testid={`${testId}-wish`}>
          <input
            className="input"
            value={wish}
            onChange={(e) => setWish(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void run()
              }
            }}
            placeholder="What to change? For example: shorter, friendlier (optional)"
            aria-label={`What to change in ${label}`}
            data-testid={`${testId}-wish-input`}
          />
          <Button onClick={() => void run()} data-testid={`${testId}-wish-run`}>
            Improve
          </Button>
          <Button variant="quiet" onClick={() => setWishOpen(false)}>
            Cancel
          </Button>
        </div>
      )}
      {blocked && (
        <Hint tone="warn" data-testid={`${testId}-blocked`}>
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      <ErrorNote error={state.error} />
      {applied && canUndo(value, applied) && (
        <div className="ai-undo" role="status" data-testid={`${testId}-undo-note`}>
          <span className="hint">The AI wrote this text. Check it before you save.</span>
          <Button
            variant="quiet"
            onClick={() => {
              onChange(applied.before)
              setApplied(null)
            }}
            data-testid={`${testId}-undo`}
          >
            Undo
          </Button>
        </div>
      )}
    </div>
  )
}
