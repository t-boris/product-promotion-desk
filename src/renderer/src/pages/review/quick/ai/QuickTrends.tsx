import { useEffect, useId, useRef, useState } from 'react'
import { QUICK_ANGLE_MAX, QUICK_SEARCH_WISH_MAX, type QuickTrendsResult } from '../../../../../../shared/quick-ai'
import { platformLabel } from '../../../../../../shared/post-format'
import { AiProgressPanel } from '../../../../AiProgress'
import { useAssistBlock } from '../../../../assist/useAssistBlock'
import { call, useAction } from '../../../../hooks'
import { Button, ErrorNote, Hint } from '../../../../ui'
import { angleInUse, angleToUse, angleUsable, progressSubject, trendsArgs, trendsBlockedReason, trendsFate, trendsSkippedNote, trendsView } from './trends-logic'
import type { QuickTrendsProps } from './types'
import '../../../../assist/assist.css'
import './quick-ai.css'
import { AddressLink } from '../../../AddressLink'

/**
 * What is talked about now (REQ-004, DEC-042): the owner asks, and the AI looks at the platform's own search in the AI browser of the channel's account,
 * which the owner watches (the progress with its Stop is shown while it works). It only reads: it posts nothing, signs in nowhere and presses nothing
 * that publishes. The topics and the angle it proposes are shown first; they steer the caption and the picture only when the owner presses "Use this
 * angle", and the owner may edit the angle before. When the browser is not available or the search fails, the owner is told in words and goes on without it.
 */
export function QuickTrends({ productId, channelId, platform, angle, disabled, onAngle }: QuickTrendsProps) {
  const id = useId()
  const [wish, setWish] = useState('')
  const [result, setResult] = useState<QuickTrendsResult | null>(null)
  const [draft, setDraft] = useState('')
  const [skipped, setSkipped] = useState<string | null>(null)
  const { blocked } = useAssistBlock({ productId, needsPassport: true, engineReady: false })
  const where = trendsBlockedReason(channelId, platform)
  const latest = useRef({ channelId })
  latest.current = { channelId }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const root = useRef<HTMLDivElement>(null)
  const hadFocus = useRef(false)

  const [search, state] = useAction(async () => {
    if (channelId === null) return
    hadFocus.current = root.current?.contains(document.activeElement) ?? false
    setSkipped(null)
    setResult(null)
    const answer = await call('quick.trends', trendsArgs(productId, channelId, wish))
    if (!mounted.current) return
    const note = trendsSkippedNote(trendsFate(channelId, latest.current.channelId))
    if (note) {
      setSkipped(note)
      return
    }
    setResult(answer)
    setDraft(answer.state === 'ready' && answer.angle ? answer.angle.text : '')
  })

  useEffect(() => {
    if (state.busy || !hadFocus.current) return
    hadFocus.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.quick-ai-btn')?.focus()
  }, [state.busy])

  const off = blocked !== null || where !== null || state.busy || disabled
  const view = result ? trendsView(result) : null
  const inUse = angle.trim() !== ''

  return (
    <section className="quick-ai-panel" ref={root} aria-labelledby={`${id}-title`} data-testid="quick-trends">
      <div className="quick-ai-panel-head">
        <span className="field-label" id={`${id}-title`}>
          What is talked about now
        </span>
      </div>
      <span className="hint">The AI looks at {platform ? `${platformLabel(platform)}'s` : "the platform's"} own search in this channel's browser, and only reads: it posts nothing and presses nothing. You see it work and can stop it.</span>
      <div className="ai-wish">
        <input
          className="input"
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (!off) void search()
            }
          }}
          disabled={state.busy}
          maxLength={QUICK_SEARCH_WISH_MAX}
          placeholder="What to look for? Optional: the channel's own topics are used"
          aria-label="What to look for"
          data-testid="quick-trends-wish"
        />
        <Button
          variant="secondary"
          icon="sparkles"
          className="quick-ai-btn"
          onClick={() => void search()}
          disabled={off}
          aria-describedby={blocked ? `${id}-blocked` : where ? `${id}-where` : undefined}
          data-testid="quick-trends-search"
        >
          {state.busy ? 'Searching…' : result ? 'Search again' : 'Search trends'}
        </Button>
      </div>
      {blocked && (
        <Hint tone="warn" id={`${id}-blocked`} data-testid="quick-trends-blocked">
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      {!blocked && where && (
        <Hint id={`${id}-where`} data-testid="quick-trends-where">
          {where}
        </Hint>
      )}
      {/* The owner sees the search while it runs, with the time and a Stop. */}
      {state.busy && <AiProgressPanel subject={progressSubject(channelId)} />}
      <ErrorNote error={state.error} />
      {skipped && (
        <p className="hint" role="status" data-testid="quick-trends-skipped">
          {skipped}
        </p>
      )}
      {view?.kind === 'message' && (
        <Hint tone={view.tone === 'warn' ? 'warn' : undefined} data-testid="quick-trends-message" data-state={view.state}>
          {view.text}
        </Hint>
      )}
      {view?.kind === 'topics' && (
        <div className="quick-trends-result" data-testid="quick-trends-result">
          <ul className="quick-topics" data-testid="quick-trends-topics">
            {view.topics.map((topic, index) => (
              <li key={`${index}-${topic.topic}`} data-testid={`quick-trends-topic-${index}`}>
                <strong>{topic.topic}</strong>
                <span>{topic.what}</span>
                {topic.url && (
                  <AddressLink className="small" url={topic.url}>
                    Open on {platform ? platformLabel(platform) : 'the platform'}
                  </AddressLink>
                )}
              </li>
            ))}
          </ul>
          {view.searched && <span className="hint">{view.searched}</span>}
          {view.note && (
            <Hint tone="warn" data-testid="quick-trends-note">
              {view.note}
            </Hint>
          )}
          {view.angle ? (
            <div className="quick-angle" data-testid="quick-trends-angle">
              <label className="field-label" htmlFor={`${id}-angle`}>
                The angle the AI proposes
              </label>
              <textarea id={`${id}-angle`} className="input" rows={2} value={draft} maxLength={QUICK_ANGLE_MAX} onChange={(e) => setDraft(e.target.value)} data-testid="quick-trends-angle-input" />
              <span className="hint" data-testid="quick-trends-angle-why">
                {view.angle.why} You can change the angle before you use it. Nothing in the post changes until you press the button.
              </span>
              <div className="quick-ai-actions">
                <Button variant="secondary" onClick={() => onAngle(angleToUse(draft))} disabled={disabled || !angleUsable(draft) || angleInUse(angle, draft)} data-testid="quick-trends-angle-use">
                  {angleInUse(angle, draft) ? 'Angle in use' : 'Use this angle'}
                </Button>
              </div>
            </div>
          ) : (
            <span className="hint" data-testid="quick-trends-no-angle">
              The AI could not form an angle from these topics. Read them, and write your own caption.
            </span>
          )}
          <div className="quick-ai-actions">
            <Button variant="quiet" onClick={() => setResult(null)} data-testid="quick-trends-hide">
              Hide the topics
            </Button>
          </div>
        </div>
      )}
      {inUse && (
        <div className="ai-undo" role="status" data-testid="quick-trends-in-use">
          <span className="hint">Angle in use: {angle}</span>
          <Button variant="quiet" onClick={() => onAngle('')} data-testid="quick-trends-angle-clear">
            Clear
          </Button>
        </div>
      )}
    </section>
  )
}
