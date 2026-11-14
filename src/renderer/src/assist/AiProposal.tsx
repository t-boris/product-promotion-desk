import { useState, type ReactNode } from 'react'
import { useAction } from '../hooks'
import { Badge, Button, ErrorNote } from '../ui'
import { AiIdeaHead } from '../pages/channels/AiIdeaHead'
import type { Blocked } from './block'
import { ideaButtonLabel, rememberShown } from './field-logic'
import './assist.css'

/**
 * "The AI proposes, the owner decides", one idea at a time: the button asks, the idea is shown as unverified, "Use this" hands it to the
 * form, and the next press asks for another one, told which ideas were already seen. The owner may steer with one line. Nothing is
 * created here: what the idea becomes is the form's business, and the owner saves it.
 */
export function AiProposal<T>({
  title,
  summary,
  askLabel,
  anotherLabel,
  note,
  steer,
  blocked,
  engineLabel,
  emptyText,
  testId,
  ask,
  keyOf,
  onUse,
  children
}: {
  title: string
  summary: string
  askLabel: string
  anotherLabel: string
  /** What the help leaves alone, under the button. */
  note: string
  /** A one-line preference the owner may give; it steers the idea and never overrides the rules. */
  steer?: { label: string; placeholder: string }
  blocked: Blocked | null
  engineLabel: string | undefined
  /** What is said when the AI has no new safe idea. */
  emptyText: string
  testId: string
  ask: (input: { hint: string; avoid: string[] }) => Promise<T | null>
  /** What identifies an idea, so the next one is not the same. */
  keyOf: (idea: T) => string
  onUse: (idea: T) => void
  children: (idea: T) => ReactNode
}) {
  const [idea, setIdea] = useState<T | null>(null)
  const [none, setNone] = useState(false)
  const [shown, setShown] = useState<string[]>([])
  const [hint, setHint] = useState('')
  const [run, state] = useAction(() => ask({ hint, avoid: shown }))

  async function next(): Promise<void> {
    setNone(false)
    const result = await run()
    if (result === undefined) return // failed: the error is shown, the last idea stays
    if (result === null) {
      setIdea(null)
      setNone(true)
      return
    }
    setIdea(result)
    setShown((known) => rememberShown(known, keyOf(result)))
  }

  return (
    <section className="idea proposal" data-testid={`${testId}-card`}>
      <AiIdeaHead
        title={title}
        summary={summary}
        button={
          <Button variant="secondary" onClick={() => void next()} disabled={blocked !== null || state.busy} data-testid={`${testId}-ask`}>
            {ideaButtonLabel({ asking: state.busy, shownBefore: shown.length, ask: askLabel, another: anotherLabel })}
          </Button>
        }
        blocked={blocked}
        engineLabel={engineLabel}
        blockedTestId={`${testId}-blocked`}
        note={note}
      />
      {steer && (
        <div className="proposal-steer">
          <input className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder={steer.placeholder} aria-label={steer.label} maxLength={300} data-testid={`${testId}-steer`} />
        </div>
      )}
      <ErrorNote error={state.error} />
      {none && (
        <p className="muted" data-testid={`${testId}-none`}>
          {emptyText}
        </p>
      )}
      {idea !== null && (
        <div className="proposal-idea" data-testid={`${testId}-idea`}>
          <div>
            {children(idea)} <Badge tone="warn">Unverified</Badge>
          </div>
          <div className="row">
            <Button
              onClick={() => {
                onUse(idea)
                setIdea(null)
              }}
              data-testid={`${testId}-use`}
            >
              Use this
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
