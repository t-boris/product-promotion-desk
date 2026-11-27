import { useEffect, useState } from 'react'
import { MAX_QUESTIONS, citedMost, namedMost } from '../../../../shared/answer-check'
import type { AnswerResult, Product } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Hint, formatTime } from '../../ui'
import { earlierLine, earlierOf, linesOf, questionsChanged, tallyLine } from './answer-view'

/**
 * What AI answers to a buyer's questions (DEC-061). The owner keeps the questions; "Ask now" puts each one to the AI engine with web search
 * and no word about the product. The application says whether the product was named and whether its site was a source, and who else was.
 */
export function AnswerCheckCard({ product }: { product: Product }) {
  const [runId, setRunId] = useState<string | null>(null)
  const check = useQuery('answers.get', { productId: product.id, runId }, ['results'])
  const view = check.data
  const [text, setText] = useState<string | null>(null)
  // The box follows the kept list until the owner types or the AI proposes.
  const kept = view ? view.questions.join('\n') : null
  useEffect(() => {
    if (kept !== null) setText(kept)
  }, [kept])
  const [save, saving] = useAction(() => call('answers.setQuestions', { productId: product.id, questions: linesOf(text ?? '') }))
  const [propose, proposing] = useAction(async () => setText((await call('answers.propose', { productId: product.id })).join('\n')))
  const [ask, asking] = useAction(() => call('answers.ask', { productId: product.id }))
  if (!view || text === null) return check.error ? <ErrorNote error={check.error} /> : null
  const changed = questionsChanged(text, view.questions)
  const busy = saving.busy || proposing.busy
  const running = asking.busy || view.running
  const run = view.shown
  const before = earlierLine(earlierOf(view))
  const ok = run ? run.results.filter((r) => r.state === 'ok') : []
  return (
    <Card title="What AI answers to a buyer’s questions">
      <Hint>
        Each question below is put to the AI engine of this application with a web search and no word about your product; the application then looks for your product’s name and site in what came back. It is a sign of where you are present, not a measurement: a person asking ChatGPT or Google may see another answer.
      </Hint>
      <label className="field">
        <span className="field-label">Questions a buyer would ask, one a line (at most {MAX_QUESTIONS})</span>
        <textarea className="input answers-questions" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} data-testid="answers-questions" />
      </label>
      <div className="answers-actions">
        <Button onClick={() => void propose()} disabled={busy || running} data-testid="answers-propose">
          {proposing.busy ? 'Proposing…' : 'Let the AI propose questions'}
        </Button>
        <Button onClick={() => void save()} disabled={busy || running || !changed} data-testid="answers-save">
          {saving.busy ? 'Saving…' : 'Save the questions'}
        </Button>
        <Button variant="primary" onClick={() => void ask()} disabled={busy || running || changed || view.questions.length === 0} data-testid="answers-ask">
          {running ? 'Asking…' : 'Ask now'}
        </Button>
        <Hint>
          {changed ? 'Save the questions before asking.' : view.questions.length > 0 ? `${view.questions.length} AI request${view.questions.length === 1 ? '' : 's'} with a web search: several minutes.` : ''}
          {view.nextAt ? ` Asked again by itself on ${formatTime(view.nextAt)}.` : ''}
        </Hint>
      </div>
      <ErrorNote error={proposing.error ?? saving.error ?? asking.error} />
      {run && (
        <div className="answers-run" data-testid="answers-run">
          <div className="answers-run-head">
            <strong data-testid="answers-tally">{tallyLine(run)}</strong>
            <span className="muted">
              {run.engine} · {formatTime(run.startedAt)}
              {run.finishedAt === null && !running ? ' · cut short' : ''}
            </span>
            {view.history.length > 1 && (
              <select className="input answers-history" value={run.id} onChange={(e) => setRunId(e.target.value)} aria-label="Check to show" data-testid="answers-history">
                {view.history.map((h) => (
                  <option key={h.id} value={h.id}>
                    {formatTime(h.startedAt)} · named in {h.named} of {h.asked}
                  </option>
                ))}
              </select>
            )}
          </div>
          {before && <Hint>{before}</Hint>}
          {ok.length > 0 && (
            <dl className="answers-most">
              <div>
                <dt>Named most</dt>
                <dd>{namedMost(ok).map((n) => `${n.name} (${n.count})`).join(', ') || 'no names'}</dd>
              </div>
              <div>
                <dt>Sites the answers rest on</dt>
                <dd>{citedMost(ok).map((c) => `${c.host} (${c.count})`).join(', ') || 'no sources reported'}</dd>
              </div>
            </dl>
          )}
          <ul className="answers-list">
            {run.results.map((result, index) => (
              <ResultRow key={index} result={result} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function ResultRow({ result }: { result: AnswerResult }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="answers-row">
      <div className="answers-row-head">
        <span className="answers-question">{result.question}</span>
        {result.state === 'failed' ? <Badge tone="warn">Not answered</Badge> : result.productNamed ? <Badge tone="good">Named</Badge> : <Badge>Not named</Badge>}
        {result.productCited && <Badge tone="good">Your site is a source</Badge>}
        <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide the answer' : 'Show the answer'}
        </button>
      </div>
      {result.state === 'ok' && result.named.length > 0 && <span className="muted">Named: {result.named.join(', ')}</span>}
      {open && (
        <div className="answers-answer">
          {result.state === 'failed' ? <p>{result.error ?? 'The engine gave no answer that could be read.'}</p> : <p>{result.answer}</p>}
          {result.sources.length > 0 && (
            <ul className="answers-sources">
              {result.sources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
