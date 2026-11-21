import { useRef, useState } from 'react'
import { QUICK_ANGLE_MAX, QUICK_SEARCH_WISH_MAX, quickTrendsSubject, type QuickLookMode, type QuickTrendsResult } from '../../../../shared/quick-ai'
import type { Channel } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Hint } from '../../ui'
import { LOOK_AROUND_INTRO, LOOK_BUTTONS, lookArgs, lookBlockedReason, lookButtonOf, lookView } from './look-around'
import '../../assist/assist.css'

/**
 * Look around (DEC-045): on any channel, the owner asks the AI to look at the place in the browser of the channel's account and report what it saw:
 * what people talk about, what is happening now, or how the feed works. The AI only reads. The topics and the one angle it proposes are shown here and
 * nothing is saved: they are material for the owner's own post.
 */
export function LookAroundCard({ channel }: { channel: Channel }) {
  const [wish, setWish] = useState('')
  const [asked, setAsked] = useState<QuickLookMode | null>(null)
  const [result, setResult] = useState<QuickTrendsResult | null>(null)
  const { blocked } = useAssistBlock({ productId: channel.productId, needsPassport: true, engineReady: false })
  const paused = lookBlockedReason(channel)
  // The answer belongs to the channel it was asked for: if the page moves to another channel while the AI works, it is not shown there.
  const current = useRef(channel.id)
  current.current = channel.id

  const [look, state] = useAction(async (mode: QuickLookMode) => {
    const forChannel = channel.id
    setAsked(mode)
    setResult(null)
    const answer = await call('quick.trends', lookArgs(channel, mode, wish))
    if (current.current === forChannel) setResult(answer)
  })

  const off = blocked !== null || paused !== null || state.busy
  const view = result ? lookView(result) : null
  const button = lookButtonOf(asked)

  return (
    <Card title="Look around with the AI">
      <Hint>{LOOK_AROUND_INTRO}</Hint>
      <div className="ai-wish">
        <input
          className="input"
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          disabled={state.busy}
          maxLength={QUICK_SEARCH_WISH_MAX}
          placeholder="What to look for? Optional: the channel's own topics are used"
          aria-label="What to look for"
          data-testid="look-wish"
        />
      </div>
      <div className="row">
        {LOOK_BUTTONS.map((b) => (
          <Button key={b.mode} variant="secondary" onClick={() => void look(b.mode)} disabled={off} data-testid={`look-${b.mode}`}>
            {state.busy && asked === b.mode ? 'Looking…' : b.label}
          </Button>
        ))}
      </div>
      {blocked && (
        <Hint tone="warn" data-testid="look-blocked">
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      {!blocked && paused && <Hint data-testid="look-paused">{paused}</Hint>}
      {state.busy && button && <Hint>Looking at {button.what}. You can watch it in the account's browser and stop it any time.</Hint>}
      {state.busy && <AiProgressPanel subject={quickTrendsSubject(channel.id)} />}
      <ErrorNote error={state.error} />
      {view?.kind === 'message' && (
        <Hint tone={view.tone === 'warn' ? 'warn' : undefined} data-testid="look-message" data-state={view.state}>
          {view.text}
        </Hint>
      )}
      {view?.kind === 'topics' && (
        <div className="look-result" data-testid="look-result">
          <ul className="look-topics" data-testid="look-topics">
            {view.topics.map((topic, index) => (
              <li key={`${index}-${topic.topic}`}>
                <strong>{topic.topic}</strong>
                <span>{topic.what}</span>
                {topic.url && (
                  <a className="small" href={topic.url} target="_blank" rel="noreferrer">
                    Open the page
                  </a>
                )}
              </li>
            ))}
          </ul>
          {view.searched && <span className="hint">{view.searched}</span>}
          {view.note && (
            <Hint tone="warn" data-testid="look-note">
              {view.note}
            </Hint>
          )}
          {view.angle ? (
            <div className="look-angle" data-testid="look-angle">
              <span className="field-label">A way into your own post, if you want one</span>
              <textarea className="input" rows={2} readOnly value={view.angle.text.slice(0, QUICK_ANGLE_MAX)} aria-label="The angle the AI proposes" data-testid="look-angle-text" />
              <span className="hint">{view.angle.why} Nothing is saved or posted: it is only something to write from.</span>
            </div>
          ) : (
            <span className="hint">The AI could not form an angle from this. Read it and write your own.</span>
          )}
          <div className="row">
            <Button variant="quiet" onClick={() => setResult(null)} data-testid="look-hide">
              Hide
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
