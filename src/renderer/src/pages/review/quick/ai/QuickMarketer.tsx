import { useEffect, useId, useRef, useState } from 'react'
import type { QuickAssessment } from '../../../../../../shared/quick-ai'
import { canUndo, type AppliedText } from '../../../../assist/field-logic'
import { useAssistBlock } from '../../../../assist/useAssistBlock'
import { call, useAction } from '../../../../hooks'
import { Badge, Button, Disclosure, ErrorNote, Hint } from '../../../../ui'
import { appliedCard, cardUndoable, undoCard, type AppliedCard } from './picture-logic'
import { assessArgs, goalLine, marketerBlockedReason, pictureFacts, POINT_ABOUT, readingCurrent, readingOf, suggestionLabel, suggestionState, suggestionText, VERDICT_VIEW, type Reading } from './marketer-logic'
import type { QuickMarketerProps } from './types'
import '../../../../assist/assist.css'
import './quick-ai.css'

type Reader = Reading & { illustration: string }

/** What the owner applied from a reading, to undo it: a caption, or the card's headline. */
type Applied = { kind: 'caption'; applied: AppliedText } | { kind: 'headline'; applied: AppliedCard }

/**
 * The marketer (REQ-004, DEC-043): reads the caption and the picture against the promotion goal of the approved product knowledge, and says in short
 * what it used as the goal, whether the post serves it, what works and what to fix. It offers a better caption and a better card headline; each is
 * applied only when the owner presses it, only while the caption or the card is still what it was read from, and Undo puts back what was there. The
 * reading itself changes nothing, and when the post changes after it, the reading says it is of an earlier version.
 */
export function QuickMarketer({ productId, channelId, platform, caption, angle, disabled, source, card, illustrationWish, onCaption, onHeadline }: QuickMarketerProps) {
  const id = useId()
  const [reading, setReading] = useState<{ assessment: QuickAssessment; asked: Reader } | null>(null)
  const [applied, setApplied] = useState<Record<number, Applied>>({})
  const { blocked } = useAssistBlock({ productId, needsPassport: true, engineReady: false })
  const facts = pictureFacts(source, card, illustrationWish)
  const where = marketerBlockedReason(platform, caption, facts)
  const now: Reader = readingOf({ caption, angle, channelId, platform }, source, card, illustrationWish)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const root = useRef<HTMLElement>(null)
  const hadFocus = useRef(false)

  const [check, state] = useAction(async () => {
    if (platform === null) return
    const asked = now
    hadFocus.current = root.current?.contains(document.activeElement) ?? false
    setReading(null)
    setApplied({})
    const assessment = await call('quick.assess', assessArgs({ productId, channelId, platform, caption, angle }, facts))
    if (!mounted.current) return
    setReading({ assessment, asked })
  })

  useEffect(() => {
    if (state.busy || !hadFocus.current) return
    hadFocus.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.quick-ai-btn')?.focus()
  }, [state.busy])

  const off = blocked !== null || where !== null || state.busy || disabled
  const current = reading !== null && readingCurrent(reading.asked, now)

  const use = (index: number, suggestion: QuickAssessment['suggestions'][number]): void => {
    if (suggestion.kind === 'caption') {
      onCaption(suggestion.caption)
      setApplied((all) => ({ ...all, [index]: { kind: 'caption', applied: { text: suggestion.caption, before: caption } } }))
    } else if (card) {
      onHeadline(suggestion.headline)
      setApplied((all) => ({ ...all, [index]: { kind: 'headline', applied: appliedCard(card, { headline: suggestion.headline, style: card.style, colour: card.colour }) } }))
    }
  }
  const undo = (index: number, done: Applied): void => {
    if (done.kind === 'caption') onCaption(done.applied.before)
    else {
      const back = undoCard(done.applied)
      onHeadline(back.headline, back.look)
    }
    setApplied((all) => {
      const { [index]: _gone, ...rest } = all
      return rest
    })
  }
  const undoable = (done: Applied): boolean => (done.kind === 'caption' ? canUndo(caption, done.applied) : cardUndoable(card, done.applied))

  return (
    <section className="quick-ai-panel" ref={root} aria-labelledby={`${id}-title`} data-testid="quick-marketer">
      <div className="quick-ai-panel-head">
        <span className="field-label" id={`${id}-title`}>
          Does the post serve its goal?
        </span>
        <Button
          variant="secondary"
          icon="sparkles"
          className="quick-ai-btn"
          onClick={() => void check()}
          disabled={off}
          aria-describedby={blocked ? `${id}-blocked` : where ? `${id}-where` : undefined}
          data-testid="quick-marketer-check"
        >
          {state.busy ? 'Reading…' : reading ? 'Check again' : 'Check the post'}
        </Button>
      </div>
      <span className="hint">The AI reads the caption and the picture against the promotion goal in your approved product knowledge, and tells you what works and what to change. It changes nothing by itself.</span>
      {blocked && (
        <Hint tone="warn" id={`${id}-blocked`} data-testid="quick-marketer-blocked">
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      {!blocked && where && (
        <Hint id={`${id}-where`} data-testid="quick-marketer-where">
          {where}
        </Hint>
      )}
      <ErrorNote error={state.error} />
      {reading && (
        <div className="quick-reading" data-testid="quick-marketer-reading">
          {!current && (
            <Hint tone="warn" data-testid="quick-marketer-stale">
              This reading is of an earlier version of the post. Check again to read the post as it is now.
            </Hint>
          )}
          <div className="quick-verdict">
            <Badge tone={VERDICT_VIEW[reading.assessment.verdict].tone}>
              <span data-testid="quick-marketer-verdict" data-verdict={reading.assessment.verdict}>
                {VERDICT_VIEW[reading.assessment.verdict].label}
              </span>
            </Badge>
            <span data-testid="quick-marketer-summary">{reading.assessment.summary}</span>
          </div>
          <span className="hint" data-testid="quick-marketer-goal">
            {goalLine(reading.assessment)}
          </span>
          {reading.assessment.goalBasis.length > 0 && (
            <Disclosure title="Where the goal comes from" testId="quick-marketer-basis">
              <ul className="quick-basis">
                {reading.assessment.goalBasis.map((line, index) => (
                  <li key={`${index}-${line}`}>{line}</li>
                ))}
              </ul>
            </Disclosure>
          )}
          {reading.assessment.points.length > 0 && (
            <ul className="quick-points" data-testid="quick-marketer-points">
              {reading.assessment.points.map((point, index) => (
                <li key={`${index}-${point.text}`} data-testid={`quick-marketer-point-${index}`} data-good={point.good}>
                  <Badge tone={point.good ? 'good' : 'warn'}>{point.good ? 'Works' : 'Fix'}</Badge>
                  <span>
                    <strong>{POINT_ABOUT[point.about]}.</strong> {point.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {reading.assessment.suggestions.map((suggestion, index) => {
            const done = applied[index]
            const fit = suggestionState(suggestion, reading.asked, now)
            return (
              <div className="quick-suggestion" key={`${index}-${suggestionText(suggestion)}`} data-testid={`quick-marketer-suggestion-${index}`} data-kind={suggestion.kind}>
                <span className="field-label">{suggestion.kind === 'caption' ? 'A better caption' : 'A better headline for the card'}</span>
                <p className="quick-suggestion-text" data-testid={`quick-marketer-suggestion-text-${index}`}>
                  {suggestionText(suggestion)}
                </p>
                <span className="hint">{suggestion.why}</span>
                {done && undoable(done) ? (
                  <div className="ai-undo" role="status" data-testid={`quick-marketer-used-${index}`}>
                    <span className="hint">Used. Check it before you save.</span>
                    <Button variant="quiet" onClick={() => undo(index, done)} data-testid={`quick-marketer-undo-${index}`}>
                      Undo
                    </Button>
                  </div>
                ) : (
                  <div className="quick-ai-actions">
                    <Button variant="secondary" onClick={() => use(index, suggestion)} disabled={disabled || !fit.usable} data-testid={`quick-marketer-use-${index}`}>
                      {suggestionLabel(suggestion)}
                    </Button>
                    {!fit.usable && (
                      <span className="hint" data-testid={`quick-marketer-unusable-${index}`}>
                        {fit.reason}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
