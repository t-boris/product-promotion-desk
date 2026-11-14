import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AssistField } from '../../../shared/types'
import { call, useAction } from '../hooks'
import { Button, ErrorNote, Hint } from '../ui'
import type { Blocked } from './block'
import { answerFate, canUndo, fieldAction, skippedNote, type AnswerFate, type AppliedText } from './field-logic'
import './assist.css'

/** What the AI is asked for one text: the text as it is, and the owner's wish when the field is filled. */
export interface AskRequest {
  current: string
  instruction: string | undefined
}

/**
 * A text field with the AI beside its label: "Suggest with AI" writes an empty field, "Improve with AI" rewrites a filled one (the
 * owner can say what to change). The text goes into the field, never into storage: the owner reads it and saves the form. "Undo"
 * puts back what was there, for as long as the owner has not typed over the AI's text (the owner's typing is never replaced silently).
 * The AI control is never the filled button (V-10). `ask` is what makes the text: assist.refine for a field of a form (AiField below),
 * drafts.refine for the title or the text of a draft.
 */
export function AiTextField({
  label,
  hint,
  value,
  onChange,
  ask,
  blocked,
  disabled = false,
  around = null,
  testId,
  children
}: {
  label: string
  hint?: string
  value: string
  onChange: (text: string) => void
  ask: (request: AskRequest) => Promise<string>
  blocked: Blocked | null
  /** The form is busy with something else (saving): the AI waits; the control stays where it is. */
  disabled?: boolean
  /**
   * What the answer depends on besides this field (the other field of the draft, the channel it is written for), as one string. The answer
   * was checked against it; if it differs when the answer arrives, the answer is dropped.
   */
  around?: string | null
  testId: string
  /** The input itself; it takes the id that ties it to the label. */
  children: (id: string) => ReactNode
}) {
  const id = useId()
  const [wishOpen, setWishOpen] = useState(false)
  const [wish, setWish] = useState('')
  const [applied, setApplied] = useState<AppliedText | null>(null)
  const [skipped, setSkipped] = useState<AnswerFate | null>(null)
  const action = fieldAction(value)
  // The field as it is when the answer arrives: the owner may keep typing while the AI works, and the form may be closed meanwhile.
  const latest = useRef({ value, around, locked: disabled })
  latest.current = { value, around, locked: disabled }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A button that is disabled while the AI works loses the focus to the page (lesson 138): give it back when the work ends.
  const root = useRef<HTMLDivElement>(null)
  const hadFocus = useRef(false)

  const [run, state] = useAction(async () => {
    const before = value
    const checkedAgainst = around
    hadFocus.current = root.current?.contains(document.activeElement) ?? false
    setSkipped(null)
    const text = await ask({ current: value, instruction: action.kind === 'improve' ? wish : undefined })
    if (!mounted.current) return // the form was closed: nothing is left to fill
    setWishOpen(false)
    setWish('')
    const fate = answerFate({ value: before, around: checkedAgainst }, latest.current)
    if (fate !== 'apply') {
      setSkipped(fate) // typing meanwhile wins, and an answer checked against a draft that moved on is dropped, not merged
      return
    }
    onChange(text)
    setApplied({ text, before })
  })

  useEffect(() => {
    if (state.busy || !hadFocus.current) return
    hadFocus.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.field-head button')?.focus()
  }, [state.busy])

  const start = (): void => {
    if (action.kind === 'improve') setWishOpen((open) => !open)
    else void run()
  }

  return (
    <div className="field ai-field" ref={root} data-testid={`${testId}-field`}>
      <div className="field-head">
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
        <Button
          variant="secondary"
          onClick={start}
          disabled={blocked !== null || state.busy || disabled}
          aria-label={`${state.busy ? 'Thinking…' : action.label}: ${label}`}
          aria-describedby={blocked ? `${id}-blocked` : undefined}
          data-testid={`${testId}-ai`}
          aria-expanded={action.kind === 'improve' ? wishOpen : undefined}
        >
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
            maxLength={300}
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
        <Hint tone="warn" id={`${id}-blocked`} data-testid={`${testId}-blocked`}>
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      <ErrorNote error={state.error} />
      {skipped && (
        <p className="hint" role="status" data-testid={`${testId}-skipped`}>
          {skippedNote(skipped)}
        </p>
      )}
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

/** A field of a form the AI can write or improve through assist.refine (a product's or a channel's text). */
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
  const ask = async ({ current, instruction }: AskRequest): Promise<string> => (await call('assist.refine', { field, productId, channelId, current, instruction, around })).text
  return (
    <AiTextField label={label} hint={hint} value={value} onChange={onChange} ask={ask} blocked={blocked} testId={testId}>
      {children}
    </AiTextField>
  )
}
