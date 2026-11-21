import { useEffect, useId, useRef, useState } from 'react'
import { QUICK_WISH_MAX } from '../../../../../../shared/quick-ai'
import { answerFate, canUndo, skippedNote, type AnswerFate, type AppliedText } from '../../../../assist/field-logic'
import { useAssistBlock } from '../../../../assist/useAssistBlock'
import { call, useAction } from '../../../../hooks'
import { Button, ErrorNote, Hint } from '../../../../ui'
import { angleLine, captionAction, captionArgs, captionAround, captionBlockedReason } from './caption-logic'
import type { QuickCaptionAiProps } from './types'
import '../../../../assist/assist.css'
import './quick-ai.css'

/**
 * The AI beside the caption's label (REQ-004): "Write with AI" writes an empty caption, "Improve with AI" rewrites a filled one (the owner can say what
 * to change). It writes for the platform's own form and from the approved product knowledge; an angle the owner chose from the trends steers it, and
 * is said here so the owner sees what the AI was told. The text goes into the caption, never into storage: the owner reads it and saves the post.
 * "Undo" puts back what was there, for as long as the owner has not typed over the AI's text; an answer that arrives after the owner typed is dropped.
 * The picture has its own help: this one never touches the card. The control is never the filled button.
 */
export function QuickCaptionAi({ productId, channelId, platform, caption, angle, headline, disabled, onCaption }: QuickCaptionAiProps) {
  const id = useId()
  const [wishOpen, setWishOpen] = useState(false)
  const [wish, setWish] = useState('')
  const [applied, setApplied] = useState<AppliedText | null>(null)
  const [skipped, setSkipped] = useState<AnswerFate | null>(null)
  const { blocked } = useAssistBlock({ productId, needsPassport: true, engineReady: false })
  const where = captionBlockedReason(platform)
  const action = captionAction(caption)
  // The post as it is when the answer arrives: the owner may keep typing while the AI works, and the composer may be closed meanwhile.
  const around = captionAround(channelId, platform)
  const latest = useRef({ value: caption, around, locked: disabled, onCaption })
  latest.current = { value: caption, around, locked: disabled, onCaption }
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
    if (platform === null) return
    const asked = { value: caption, around }
    hadFocus.current = root.current?.contains(document.activeElement) ?? false
    setSkipped(null)
    const result = await call('quick.caption', captionArgs({ productId, channelId, platform, caption, angle, headline }, wish))
    if (!mounted.current) return // the composer was closed: nothing is left to fill
    setWishOpen(false)
    setWish('')
    const fate = answerFate(asked, latest.current)
    if (fate !== 'apply') {
      setSkipped(fate) // typing meanwhile wins, and an answer written for another channel or while saving is dropped, not merged
      return
    }
    latest.current.onCaption(result.caption)
    setApplied({ text: result.caption, before: asked.value })
  })

  useEffect(() => {
    if (state.busy || !hadFocus.current) return
    hadFocus.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.quick-ai-btn')?.focus()
  }, [state.busy])

  const start = (): void => {
    if (action.kind === 'improve') setWishOpen((open) => !open)
    else void run()
  }
  const off = blocked !== null || where !== null || state.busy || disabled
  const steer = angleLine(angle)
  const undoable = applied !== null && canUndo(caption, applied)

  return (
    <div className="quick-ai quick-ai-caption" ref={root} data-testid="quick-caption-ai">
      <Button
        variant="secondary"
        icon="sparkles"
        className="quick-ai-btn"
        onClick={start}
        disabled={off}
        aria-expanded={action.kind === 'improve' ? wishOpen : undefined}
        aria-describedby={blocked ? `${id}-blocked` : where ? `${id}-where` : undefined}
        data-testid="quick-caption-ai-button"
      >
        {state.busy ? 'Thinking…' : action.label}
      </Button>
      <div className="quick-ai-more">
        {wishOpen && !state.busy && (
          <div className="ai-wish" data-testid="quick-caption-ai-wish">
            <input
              className="input"
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (!off) void run()
                }
              }}
              maxLength={QUICK_WISH_MAX}
              placeholder="What to change? For example: shorter, friendlier (optional)"
              aria-label="What to change in the caption"
              data-testid="quick-caption-ai-wish-input"
            />
            <Button onClick={() => void run()} disabled={off} data-testid="quick-caption-ai-wish-run">
              Improve
            </Button>
            <Button variant="quiet" onClick={() => setWishOpen(false)}>
              Cancel
            </Button>
          </div>
        )}
        {steer && (
          <span className="hint" data-testid="quick-caption-ai-angle">
            {steer}
          </span>
        )}
        {blocked && (
          <Hint tone="warn" id={`${id}-blocked`} data-testid="quick-caption-ai-blocked">
            {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
          </Hint>
        )}
        {!blocked && where && (
          <Hint id={`${id}-where`} data-testid="quick-caption-ai-where">
            {where}
          </Hint>
        )}
        <ErrorNote error={state.error} />
        {skipped && (
          <p className="hint" role="status" data-testid="quick-caption-ai-skipped">
            {skippedNote(skipped)}
          </p>
        )}
        {undoable && applied && (
          <div className="ai-undo" role="status" data-testid="quick-caption-ai-undo-note">
            <span className="hint">The AI wrote this caption. Check it before you save.</span>
            <Button
              variant="quiet"
              onClick={() => {
                onCaption(applied.before)
                setApplied(null)
              }}
              data-testid="quick-caption-ai-undo"
            >
              Undo
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
