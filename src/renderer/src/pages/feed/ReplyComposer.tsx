import { useEffect, useRef, useState } from 'react'
import type { Finding, FindingComment } from '../../../../shared/types'
import type { FindingSendResult } from '../../../../shared/api'
import { AiProgressPanel } from '../../AiProgress'
import { call, useAction, useQuery } from '../../hooks'
import { Button, ErrorNote, Hint } from '../../ui'
import { OpenChannelBrowser } from '../channels/OpenChannelBrowser'
import { FullReply } from './FullReply'
import { ReplyActions } from './ReplyActions'
import { nextAsk, placeKey, placeLabel, scheduledLine, sendBlock, sendLine, sendNote, storedText, wayOut, withRound, type Doing, type Place, type Round } from './reply-composer'

interface Kept {
  text: string
  rounds: Round[]
}

/** What each place of each thread holds while the app is open, so going to another post and back does not lose the text the owner was working on. */
const kept = new Map<string, Kept>()

/**
 * The reply window under a post: the AI writes the comment for the place the owner picked, the owner changes the text or says what to change ("shorter",
 * "no link") and asks again, as many rounds as they like. The AI proposes. Nothing is posted until the owner presses a button, and each button is the
 * owner's own decision about this exact text: Send now (the AI opens the post in the account's browser and types the text, exactly as it stands, at the place
 * the owner picked), Schedule (the application does the same at the time the owner chose) or Edit in full (the card every draft has, for a picture, a link or
 * formatting). When the community's own rules stand in the way the window says so in the community's words and offers Send anyway: the owner's own press,
 * for this text only. Copy stays for the owner who would rather do it by hand.
 */
export function ReplyComposer({ finding, place, comments, onClose }: { finding: Finding; place: Place; comments: FindingComment[]; onClose: () => void }) {
  const key = placeKey(finding.id, place)
  const [text, setText] = useState(kept.get(key)?.text ?? '')
  const [rounds, setRounds] = useState<Round[]>(kept.get(key)?.rounds ?? [])
  const [wish, setWish] = useState('')
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  // "Edit in full": the item that holds this comment while its full card is shown in place of the window.
  const [fullId, setFullId] = useState<string | null>(null)
  const latest = useRef({ text, rounds })
  latest.current = { text, rounds }

  const comment = place === 'post' ? null : (comments.find((c) => c.position === place) ?? null)
  const replies = useQuery('findings.replies', { id: finding.id }, ['opportunities'])
  const here = replies.data?.places.find((p) => p.position === (place === 'post' ? null : place)) ?? null
  const [result, setResult] = useState<FindingSendResult | null>(null)
  const [attempt, setAttempt] = useState<Doing>('send')
  const where = comment ? { position: comment.position, author: comment.author, text: comment.text } : null
  const [post, posting] = useAction(async (anyway: boolean) => {
    setResult(null)
    setAttempt('send')
    setResult(await call('findings.send', { id: finding.id, place: where, text: latest.current.text, anyway }))
  })
  const [plan, planning] = useAction(async (at: string, anyway: boolean) => {
    setResult(null)
    setAttempt('schedule')
    setResult(await call('findings.schedule', { id: finding.id, place: where, text: latest.current.text, at, anyway }))
  })
  const [cancelPlan, cancelling] = useAction(async () => {
    if (!here) return
    await call('findings.unschedule', { opportunityId: here.opportunityId })
    setResult(null)
  })
  const [openFull, opening] = useAction(async () => {
    const answer = await call('findings.saveDraft', { id: finding.id, place: where, text: latest.current.text })
    setFullId(answer.opportunityId)
  })
  const [settle, settling] = useAction(async (outcome: 'published' | 'not_published') => {
    if (!here) return
    await call('opportunities.resolveUnknown', { id: here.opportunityId, outcome })
    setResult(null)
  })
  const working = posting.busy || planning.busy || cancelling.busy || opening.busy
  const stopped = sendBlock({ text, blocked: replies.data?.blocked ?? '', state: here?.state ?? null, comment, busy: working })
  const line = result && result.state !== 'scheduled' ? sendLine(result, new Date(), attempt) : null
  const way = wayOut(result)
  // The time a comment is planned for comes from the item (so it survives closing the window); the answer of the press that just planned it covers the moment before it is reloaded.
  const planned = here && here.scheduledAt ? here : result?.state === 'scheduled' && result.at ? { scheduledAt: result.at, text: latest.current.text } : null
  const plannedLine = planned ? scheduledLine(planned, text, new Date()) : null

  const [ask, asking] = useAction(async (instruction: string) => {
    const { current, instruction: said } = nextAsk(latest.current.text, instruction)
    const answer = await call('findings.writeReply', { id: finding.id, place: place === 'post' ? null : place, current, instruction: said })
    const next = withRound(latest.current.rounds, said, answer.text)
    kept.set(key, { text: answer.text, rounds: next })
    setText(answer.text)
    setRounds(next)
    setWish('')
    setCopied(null)
  })

  // The first text is written when the window opens, unless this place already has one: one the window kept, or one the item holds (planned, or kept by
  // "Edit in full"). What the item holds is known once its answer is in.
  const started = useRef(false)
  const known = replies.data !== undefined || !replies.loading
  useEffect(() => {
    if (started.current || kept.has(key) || !known) return
    started.current = true
    const stored = storedText(here)
    if (stored !== null) {
      kept.set(key, { text: stored, rounds: [] })
      setText(stored)
      return
    }
    void ask('')
  }, [key, ask, known, here])

  // Back from the full card: the text is whatever the card kept.
  const backFromFull = (): void => {
    const stored = storedText(here)
    if (stored !== null) {
      kept.set(key, { text: stored, rounds: latest.current.rounds })
      setText(stored)
    }
    setResult(null)
    setFullId(null)
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }

  return (
    <div className="reply-composer" data-testid="reply-composer" data-place={String(place)}>
      <div className="reply-composer-head">
        <strong>Reply to {placeLabel(place, finding.author, comments)}</strong>
        <Button variant="quiet" onClick={onClose} data-testid="reply-close">
          Close
        </Button>
      </div>
      {fullId !== null ? (
        <FullReply opportunityId={fullId} onBack={backFromFull} />
      ) : (
        <>
          <textarea
            className="input"
            rows={6}
            value={text}
            placeholder={asking.busy ? 'The AI is writing…' : 'The comment to leave'}
            onChange={(e) => {
              setText(e.target.value)
              kept.set(key, { text: e.target.value, rounds: latest.current.rounds })
              setCopied(null)
            }}
            aria-label="The comment to leave"
            data-testid="reply-text"
          />
          <div className="reply-wish">
            <input
              className="input"
              value={wish}
              maxLength={300}
              placeholder="What to change? For example: shorter, friendlier, no link"
              aria-label="What to change"
              onChange={(e) => setWish(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !asking.busy && wish.trim() !== '') void ask(wish)
              }}
              data-testid="reply-wish"
            />
            <Button variant="secondary" onClick={() => void ask(wish)} disabled={asking.busy || wish.trim() === ''} data-testid="reply-ask">
              {asking.busy ? 'Writing…' : 'Ask the AI'}
            </Button>
            <Button variant="secondary" onClick={() => void ask('')} disabled={asking.busy} data-testid="reply-again">
              Write it again
            </Button>
          </div>
          <ErrorNote error={asking.error} />
          {rounds.length > 1 && (
            <details className="reply-rounds" data-testid="reply-rounds">
              <summary className="muted small">The rounds so far ({rounds.length})</summary>
              <ol>
                {rounds.map((round, index) => (
                  <li key={index}>
                    {round.wish && <span className="muted small">You: {round.wish}</span>}
                    <span className="reply-round-text">{round.text}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <ReplyActions
            way={way}
            plannedLine={plannedLine}
            working={working || asking.busy}
            stopped={stopped}
            posting={posting.busy}
            onSend={(anyway) => void post(anyway)}
            onSchedule={(at, anyway) => void plan(at, anyway)}
            onCancelPlan={() => void cancelPlan()}
            onEditFull={() => void openFull()}
            onCopy={() => void copy()}
            onBack={() => setResult(null)}
            copyDisabled={text.trim() === ''}
            openPost={<OpenChannelBrowser channelId={finding.channelId} url={comment?.url || finding.url} label="Open post" testId="reply-open-post" fallbackUrl={finding.url} />}
          />
          <span className="muted small" data-testid="reply-send-note">
            {stopped !== ''
              ? stopped
              : copied === 'yes'
                ? 'Copied. Paste it under the post yourself.'
                : copied === 'no'
                  ? 'Could not copy: select the text and copy it yourself.'
                  : sendNote(replies.data?.accountLabel ?? '', placeLabel(place, finding.author, comments))}
          </span>
          {(posting.busy || planning.busy) && <AiProgressPanel />}
          {line && (
            <Hint tone={line.tone === 'good' ? undefined : 'warn'} data-testid="reply-send-result" data-state={result?.state} data-code={result?.code ?? ''}>
              {line.text}
            </Hint>
          )}
          <ErrorNote error={posting.error ?? planning.error ?? cancelling.error ?? opening.error ?? settling.error} />
          {here?.state === 'unknown_result' && !posting.busy && (
            <div className="reply-resolve" data-testid="reply-resolve">
              <span className="muted small">Look at the post yourself, then tell the app:</span>
              <Button onClick={() => void settle('published')} disabled={settling.busy} data-testid="reply-resolve-published">
                It is there
              </Button>
              <Button variant="secondary" onClick={() => void settle('not_published')} disabled={settling.busy} data-testid="reply-resolve-not-published">
                It is not there
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
