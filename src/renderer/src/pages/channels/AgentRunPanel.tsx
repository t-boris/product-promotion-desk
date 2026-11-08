import type { AgentRun } from '../../../../shared/types'
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
