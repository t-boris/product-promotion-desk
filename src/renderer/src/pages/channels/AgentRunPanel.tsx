import type { AgentRun } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button } from '../../ui'

const TONE: Record<AgentRun['status'], string> = { running: 'note', done: 'note good', needs_owner: 'note warn', failed: 'note warn', stopped: 'note' }
const HEADING: Record<AgentRun['status'], string> = {
  running: 'The AI is working in the account’s browser',
  done: 'The AI finished',
  needs_owner: 'The AI needs you',
  failed: 'The AI could not finish',
  stopped: 'Stopped'
}

/** What the browser agent is doing on an account, or how it ended (DEC-017): one sentence, the steps behind it, the values it chose, Stop while it works. */
export function AgentRunPanel({ run, onStop, stopping, testId }: { run: AgentRun; onStop: () => void; stopping: boolean; testId: string }) {
  return (
    <div className="stack" data-testid={testId}>
      <div className={TONE[run.status]} role="status" data-testid={`${testId}-summary`}>
        <div>
          <strong>{HEADING[run.status]}.</strong> {run.summary}
        </div>
        {run.status === 'running' && (
          <Button onClick={onStop} disabled={stopping} data-testid={`${testId}-stop`}>
            Stop
          </Button>
        )}
      </div>
      <Learned run={run} />
      {run.lines.length > 0 && (
        <details open={run.status === 'running'} data-testid={`${testId}-lines`}>
          <summary className="small">What the AI did ({run.lines.length})</summary>
          <ol className="plain-lines small">
            {run.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
        </details>
      )}
      {run.typed.length > 0 && (
        <div className="small" data-testid={`${testId}-typed`}>
          <strong>Values the AI chose on the site</strong>
          <ul className="plain-lines">
            {run.typed.map((value) => (
              <li key={value.label}>
                {value.label}: {value.value}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** What the AI kept from the owner's answers during this run, one line each, with Undo: the owner decides what stays (and can edit it in Settings). */
function Learned({ run }: { run: AgentRun }) {
  const lessons = useQuery('lessons.list', undefined, ['settings'])
  const [undo, undoing] = useAction((id: string) => call('lessons.remove', { id }))
  // A rule the owner already removed (here or in Settings) is not listed.
  const kept = run.learned.filter((l) => (lessons.data ?? []).some((known) => known.id === l.id))
  if (kept.length === 0) return null
  return (
    <div className="stack" data-testid="agent-learned">
      {kept.map((l) => (
        <div className="note good" key={l.id} data-testid={`agent-learned-${l.id}`}>
          <div>
            <strong>The AI will remember:</strong> {l.rule}
          </div>
          <Button onClick={() => void undo(l.id)} disabled={undoing.busy} data-testid={`agent-learned-undo-${l.id}`}>
            Undo
          </Button>
        </div>
      ))}
    </div>
  )
}
