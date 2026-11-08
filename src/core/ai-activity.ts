// What every AI run is doing, for the person to watch: the title in words, the engine, how long it has run, the latest lines it gave, and a Stop.
// One place at the engine boundary (EngineRegistry wraps every engine with it), so every AI help and mission shows progress the same way.

import type { AiTaskState } from '../shared/types'
import type { EventBus } from './events'
import type { Clock } from './ports'

const MAX_LINES = 30
const MAX_LINE = 200
/** A finished run stays visible for a minute, so a quick one is still seen and a failure can be read. */
const KEEP_FINISHED_MS = 60_000
/** At most about four change events a second, however many lines an engine prints. */
const NOTIFY_EVERY_MS = 250

/** What the panel calls a run, by the label the services give their tasks; a label not listed shows as it is. */
const TITLES: Record<string, string> = {
  'accounts.profile': 'Proposing a profile',
  'accounts.picture': 'Making the picture',
  'agent.signup': 'Creating the account on the site',
  'agent.profile': 'Filling in the profile on the site',
  'channels.suggest': 'Suggesting channels',
  'channels.roles': 'Suggesting roles',
  'channels.plan': 'Planning the channel',
  'channels.site_profile': 'Reading the site to prepare its profile',
  'passport.synthesize': 'Writing the product passport',
  'passport.contradictions': 'Looking for contradictions in the passport',
  'passport.code': 'Reading the code',
  'passport.documents': 'Reading the documents',
  'draft.reply': 'Drafting a reply',
  'draft.publication': 'Drafting a publication'
}

/** A run that corrects the answer of an earlier one ("<label>.repair") is named after it. */
export const titleOf = (label: string, given?: string): string => {
  if (given?.trim()) return given.trim()
  if (label.endsWith('.repair')) return `Correcting: ${titleOf(label.slice(0, -'.repair'.length)).toLowerCase()}`
  return TITLES[label] ?? label
}

interface Live {
  state: AiTaskState
  abort: AbortController
  finishedMs: number | null
}

/** What a run uses to report: lines while it works, and how it ended. */
export interface AiRunHandle {
  /** The caller's own signal and the Stop of the panel, merged: pass it to the engine. */
  readonly signal: AbortSignal
  line(text: string): void
  finish(): void
  /** `stopped` when the person (or the caller) ended it, not an error of the engine. */
  fail(message: string, stopped?: boolean): void
}

export class AiActivity {
  private readonly runs = new Map<string, Live>()
  private counter = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(
    private readonly events: EventBus,
    private readonly clock: Clock
  ) {}

  start(info: { title: string; engineLabel: string; subject?: string | null }, external?: AbortSignal): AiRunHandle {
    this.prune()
    const abort = new AbortController()
    const id = `ai-${Date.now().toString(36)}-${++this.counter}`
    const live: Live = {
      abort,
      finishedMs: null,
      state: { id, title: info.title, engineLabel: info.engineLabel, subject: info.subject ?? null, startedAt: this.clock.now().toISOString(), finishedAt: null, status: 'running', lines: [], error: null }
    }
    this.runs.set(id, live)
    this.notify()
    const end = (status: AiTaskState['status'], error: string | null): void => {
      if (live.state.status !== 'running') return
      live.state.status = status
      live.state.error = error
      live.state.finishedAt = this.clock.now().toISOString()
      live.finishedMs = Date.now()
      this.notify()
      // Nothing else tells the screen when the minute is over.
      const expire = setTimeout(() => this.notify(), KEEP_FINISHED_MS + 500)
      expire.unref?.()
    }
    return {
      signal: external ? AbortSignal.any([abort.signal, external]) : abort.signal,
      line: (text) => {
        if (live.state.status !== 'running') return
        const flat = text.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE)
        if (!flat || live.state.lines.at(-1) === flat) return
        live.state.lines.push(flat)
        if (live.state.lines.length > MAX_LINES) live.state.lines.shift()
        this.notify()
      },
      finish: () => end('done', null),
      fail: (message, stopped = false) => end(stopped ? 'stopped' : 'failed', stopped ? null : message.slice(0, 400))
    }
  }

  /** The runs now and those that ended in the last minute, newest first. */
  list(): AiTaskState[] {
    this.prune()
    return [...this.runs.values()].map((live) => ({ ...live.state, lines: [...live.state.lines] })).reverse()
  }

  /** The person pressed Stop: the engine process is ended, and the caller sees the usual "cancelled". */
  stop(id: string): void {
    const live = this.runs.get(id)
    if (live && live.state.status === 'running') live.abort.abort()
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, live] of this.runs) if (live.finishedMs !== null && now - live.finishedMs > KEEP_FINISHED_MS) this.runs.delete(id)
  }

  /** Tells the screens something changed, at most four times a second; the last change is never lost. */
  private notify(): void {
    if (this.timer) {
      this.dirty = true
      return
    }
    this.events.changed('ai')
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.dirty) {
        this.dirty = false
        this.notify()
      }
    }, NOTIFY_EVERY_MS)
    this.timer.unref?.()
  }
}
