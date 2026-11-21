import { useEffect, useId, useRef, useState } from 'react'
import { answerFate, canUndo, skippedNote, type AnswerFate, type AppliedText } from '../../../../assist/field-logic'
import { useAssistBlock } from '../../../../assist/useAssistBlock'
import { call, useAction } from '../../../../hooks'
import { Button, ErrorNote, Hint } from '../../../../ui'
import { appliedCard, cardUndoable, cardValue, pictureAction, pictureArgs, pictureAround, pictureSkippedNote, undoCard, type AppliedCard } from './picture-logic'
import { angleLine } from './caption-logic'
import type { QuickPictureAiProps } from './types'
import '../../../../assist/assist.css'
import './quick-ai.css'

/** What the AI last put into the picture, with its reason: the card's headline and look, or an illustration's description. */
type Used = { kind: 'card'; applied: AppliedCard; why: string } | { kind: 'illustration'; applied: AppliedText; why: string }

/**
 * The AI under the picture (REQ-004): for the card it proposes the headline, the style and the colour; for an illustration it proposes the description the
 * picture will be made from. It is its own press, apart from the caption's: a caption is never rewritten here and a card never there. What it proposes
 * goes into the card or the description at once, with its reason, and "Undo" puts back what was there for as long as the owner has not changed it; an
 * answer that arrives after the owner changed the picture is dropped. A picture the owner chose is never touched: the button says so.
 */
export function QuickPictureAi({ productId, channelId, platform, caption, angle, disabled, source, card, illustrationWish, onHeadline, onIllustrationWish }: QuickPictureAiProps) {
  const id = useId()
  const [used, setUsed] = useState<Used | null>(null)
  const [skipped, setSkipped] = useState<AnswerFate | null>(null)
  const { blocked } = useAssistBlock({ productId, needsPassport: true, engineReady: false })
  const action = pictureAction(source, platform, illustrationWish)
  const around = pictureAround(channelId, platform, source)
  const value = source === 'illustration' ? illustrationWish : cardValue(card)
  const latest = useRef({ value, around, locked: disabled, onHeadline, onIllustrationWish })
  latest.current = { value, around, locked: disabled, onHeadline, onIllustrationWish }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const root = useRef<HTMLDivElement>(null)
  const hadFocus = useRef(false)

  const [run, state] = useAction(async () => {
    if (!action.ok || platform === null) return
    const asked = { value, around }
    hadFocus.current = root.current?.contains(document.activeElement) ?? false
    setSkipped(null)
    const result = await call('quick.picture', pictureArgs({ productId, channelId, platform, caption, angle }, action, { headline: card?.headline ?? '', description: illustrationWish }))
    if (!mounted.current) return
    const fate = answerFate(asked, latest.current)
    if (fate !== 'apply') {
      setSkipped(fate)
      return
    }
    if (result.kind === 'card' && card) {
      latest.current.onHeadline(result.headline, { style: result.style, colour: result.colour })
      setUsed({ kind: 'card', applied: appliedCard(card, result), why: result.why })
    } else if (result.kind === 'illustration') {
      latest.current.onIllustrationWish(result.description)
      setUsed({ kind: 'illustration', applied: { text: result.description, before: illustrationWish }, why: result.why })
    }
  })

  useEffect(() => {
    if (state.busy || !hadFocus.current) return
    hadFocus.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.quick-ai-btn')?.focus()
  }, [state.busy])

  const off = blocked !== null || !action.ok || state.busy || disabled
  const steer = angleLine(angle)
  const undoable = used !== null && (used.kind === 'card' ? source === 'card' && cardUndoable(card, used.applied) : source === 'illustration' && canUndo(illustrationWish, used.applied))

  return (
    <div className="quick-ai quick-ai-picture" ref={root} data-testid="quick-picture-ai">
      <Button
        variant="secondary"
        icon="sparkles"
        className="quick-ai-btn"
        onClick={() => void run()}
        disabled={off}
        aria-describedby={blocked ? `${id}-blocked` : !action.ok ? `${id}-hint` : undefined}
        data-testid="quick-picture-ai-button"
      >
        {state.busy ? 'Thinking…' : action.ok ? action.label : 'Suggest a picture with AI'}
      </Button>
      <div className="quick-ai-more">
        {steer && (
          <span className="hint" data-testid="quick-picture-ai-angle">
            {steer}
          </span>
        )}
        {blocked && (
          <Hint tone="warn" id={`${id}-blocked`} data-testid="quick-picture-ai-blocked">
            {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
          </Hint>
        )}
        {!blocked && !action.ok && (
          <Hint id={`${id}-hint`} data-testid="quick-picture-ai-hint">
            {action.hint}
          </Hint>
        )}
        <ErrorNote error={state.error} />
        {skipped && (
          <p className="hint" role="status" data-testid="quick-picture-ai-skipped">
            {pictureSkippedNote(skipped) ?? skippedNote(skipped)}
          </p>
        )}
        {used && undoable && (
          <div className="ai-undo" role="status" data-testid="quick-picture-ai-undo-note">
            <span className="hint" data-testid="quick-picture-ai-why">
              {used.kind === 'card' ? 'The AI changed the card.' : 'The AI wrote this description.'} {used.why}
            </span>
            <Button
              variant="quiet"
              onClick={() => {
                if (used.kind === 'card') {
                  const back = undoCard(used.applied)
                  onHeadline(back.headline, back.look)
                } else {
                  onIllustrationWish(used.applied.before)
                }
                setUsed(null)
              }}
              data-testid="quick-picture-ai-undo"
            >
              Undo
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
