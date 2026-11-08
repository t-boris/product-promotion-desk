import { useState } from 'react'
import { call, useAction, useQuery } from './hooks'
import { Button, ErrorNote } from './ui'

/**
 * The pop-up of the AI agent (DEC-018): the AI works an account's browser and asks the owner for what only a person can do (a CAPTCHA, a code sent to the
 * e-mail, a check of the site). It appears over any screen while a question is open; the AI waits for the answer. The owner may bring the account's
 * browser to the front and act in it, then press "I'm done", or type the answer (a code), or stop the AI.
 */
export function AgentQuestionDialog() {
  const questions = useQuery('agent.questions', undefined, ['accounts', 'attention'])
  const [reply, setReply] = useState('')
  const ask = questions.data?.[0]
  const accountId = ask?.accountId ?? ''
  const [send, sending] = useAction(async (answer: string) => {
    await call('agent.answer', { accountId, answer })
    setReply('')
  })
  const [show, showing] = useAction(() => call('agent.showBrowser', { accountId }))
  const [stop, stopping] = useAction(() => call('agent.stop', { accountId }))

  if (!ask || !questions.data) return null
  const busy = sending.busy || stopping.busy
  const typed = reply.trim()

  return (
    <div className="modal-backdrop" data-testid="agent-question">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="agent-question-title" aria-describedby="agent-question-text">
        <h2 id="agent-question-title">
          The AI is waiting for you — {ask.accountLabel}
          {questions.data.length > 1 && <span className="muted small"> (1 of {questions.data.length})</span>}
        </h2>
        <p id="agent-question-text" className="modal-text" data-testid="agent-question-text">
          {ask.text}
        </p>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            if (typed) void send(typed)
          }}
        >
          <label className="field-label" htmlFor="agent-question-answer">
            Your answer to the AI, if it needs one (for example, a code)
          </label>
          <div className="row nowrap">
            <input
              id="agent-question-answer"
              className="input"
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              autoComplete="off"
              data-testid="agent-question-answer"
            />
            <Button type="submit" disabled={!typed || busy} data-testid="agent-question-send">
              Send
            </Button>
          </div>
        </form>
        <div className="row modal-actions">
          <Button onClick={() => void show()} disabled={showing.busy} data-testid="agent-question-show">
            Show the browser
          </Button>
          <Button variant="primary" onClick={() => void send('done')} disabled={busy} data-testid="agent-question-done">
            I’m done
          </Button>
          <Button variant="danger" onClick={() => void stop()} disabled={busy} data-testid="agent-question-stop">
            Stop the AI
          </Button>
        </div>
        <ErrorNote error={sending.error ?? showing.error ?? stopping.error ?? questions.error} />
      </div>
    </div>
  )
}
