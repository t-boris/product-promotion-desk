import { useEffect, useState } from 'react'
import type { AiTaskState } from '../../shared/types'
import { call, useAction, useQuery } from './hooks'
import { Badge, Button } from './ui'

/** A finished run stays on screen for a minute (the core keeps it that long); the clock here hides it without waiting for an event. */
const KEEP_FINISHED_MS = 60_000

/** One tick a second while something runs, so the running time moves. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** The runs to show: the ones going and those that ended less than a minute ago, optionally only the ones about `subject`. */
function useActivity(subject?: string): { tasks: AiTaskState[]; now: number } {
  const activity = useQuery('ai.activity', undefined, ['ai'])
  const all = activity.data ?? []
  const running = all.some((task) => task.status === 'running')
  // Finished runs need a tick too, to leave the screen when their minute is over.
  const now = useNow(running || all.length > 0)
  const tasks = all.filter((task) => (subject === undefined || task.subject === subject) && (task.finishedAt === null || now - new Date(task.finishedAt).getTime() < KEEP_FINISHED_MS))
  return { tasks, now }
}

function Task({ task, now, onStop, stopping }: { task: AiTaskState; now: number; onStop: () => void; stopping: boolean }) {
  const end = task.finishedAt ? new Date(task.finishedAt).getTime() : now
  const elapsed = clock(end - new Date(task.startedAt).getTime())
  const tone = task.status === 'running' ? 'note' : task.status === 'done' ? 'note good' : 'note warn'
  const state = task.status === 'running' ? 'working' : task.status === 'done' ? 'finished' : task.status === 'stopped' ? 'stopped' : 'failed'
  return (
    <div className={`${tone} ai-task`} data-testid={`ai-task-${task.id}`}>
      <div className="ai-task-head">
        <div>
          <strong>{task.title}</strong> <Badge tone={task.status === 'running' ? 'info' : task.status === 'done' ? 'good' : 'warn'}>{task.engineLabel}</Badge>{' '}
          <span className="muted small" data-testid={`ai-task-time-${task.id}`}>
            {state} · {elapsed}
          </span>
        </div>
        {task.status === 'running' && (
          <Button onClick={onStop} disabled={stopping} data-testid={`ai-task-stop-${task.id}`}>
            Stop
          </Button>
        )}
      </div>
      {task.error && <div className="small">{task.error}</div>}
      {task.lines.length > 0 && (
        <ol className="ai-lines" data-testid={`ai-task-lines-${task.id}`}>
          {task.lines.slice(-8).map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** What the AI is doing now, with the time, the latest lines and a Stop. Where an AI help is started, it replaces the silent button label; `subject` shows only the runs about that profile or account. */
export function AiProgressPanel({ subject }: { subject?: string }) {
  const { tasks, now } = useActivity(subject)
  const [stop, stopping] = useAction((id: string) => call('ai.stop', { id }))
  if (tasks.length === 0) return null
  return (
    <div className="stack" data-testid={subject ? `ai-progress-${subject}` : 'ai-progress'}>
      {tasks.map((task) => (
        <Task key={task.id} task={task} now={now} onStop={() => void stop(task.id)} stopping={stopping.busy} />
      ))}
    </div>
  )
}

/** The top bar: one pill "AI working: what · 0:23" while something runs; it opens the same panel from any screen. Nothing when idle. */
export function AiPill() {
  const { tasks, now } = useActivity()
  const [open, setOpen] = useState(false)
  const running = tasks.filter((task) => task.status === 'running')
  const lead = running[0]
  useEffect(() => {
    if (tasks.length === 0) setOpen(false)
  }, [tasks.length])
  if (tasks.length === 0) return null
  const label = lead
    ? `AI working: ${lead.title} · ${clock(now - new Date(lead.startedAt).getTime())}${running.length > 1 ? ` (+${running.length - 1})` : ''}`
    : `AI: ${tasks[0].title} ${tasks[0].status === 'done' ? 'finished' : tasks[0].status}`
  return (
    <div className="ai-pill" data-testid="ai-pill">
      <Button variant={lead ? 'primary' : 'ghost'} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="ai-pill-button">
        {label}
      </Button>
      {open && (
        <div className="ai-pill-panel" data-testid="ai-pill-panel">
          <AiProgressPanel />
        </div>
      )}
    </div>
  )
}
