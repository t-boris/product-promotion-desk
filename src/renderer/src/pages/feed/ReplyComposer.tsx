import { useEffect, useRef, useState } from 'react'
import type { Finding, FindingComment } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote } from '../../ui'
import { nextAsk, placeKey, placeLabel, withRound, type Place, type Round } from './reply-composer'

interface Kept {
  text: string
  rounds: Round[]
}

/** What each place of each thread holds while the app is open, so going to another post and back does not lose the text the owner was working on. */
const kept = new Map<string, Kept>()

/**
 * The reply window under a post: the AI writes the comment for the place the owner picked, the owner changes the text or says what to change ("shorter",
 * "no link") and asks again, as many rounds as they like. The AI proposes; nothing here posts or sends anything: the text is the owner's to copy.
 */
export function ReplyComposer({ finding, place, comments, onClose }: { finding: Finding; place: Place; comments: FindingComment[]; onClose: () => void }) {
  const key = placeKey(finding.id, place)
  const [text, setText] = useState(kept.get(key)?.text ?? '')
  const [rounds, setRounds] = useState<Round[]>(kept.get(key)?.rounds ?? [])
  const [wish, setWish] = useState('')
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null)
  const latest = useRef({ text, rounds })
  latest.current = { text, rounds }

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

  // The first text is written when the window opens, unless this place already has one.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || kept.has(key)) return
    started.current = true
    void ask('')
  }, [key, ask])

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
      <div className="row">
        <Button variant="secondary" onClick={() => void copy()} disabled={text.trim() === ''} data-testid="reply-copy">
          Copy the comment
        </Button>
        <span className="muted small">{copied === 'yes' ? 'Copied. Paste it under the post yourself.' : copied === 'no' ? 'Could not copy: select the text and copy it yourself.' : 'The AI never posts on its own.'}</span>
      </div>
    </div>
  )
}
