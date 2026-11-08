// The scheduler (I-7, REQ-005): a tick loop that starts due channel cycles, each isolated from the others.
//
//  - A cycle is monitor.runChannel then (if it went well) drafting.processChannel, recorded as one run.
//  - One channel's failure, timeout or AI-process failure never reaches the other channels or the app.
//  - A failing channel backs off exponentially; a recovered one is back on its normal interval.
//  - After a sleep (large gap between ticks) or a restart, overdue channels are spread out instead of fired at once.
//  - While automation is paused nothing scheduled starts; explicit user actions do not pass through here.

import type { Channel, Id } from '../../shared/types'
import type { Core } from '../core'
import type { RunResult } from '../runs'
import type { DraftingService, MonitorOutcome } from '../services'
import type { PeriodicTasks } from './scheduler-periodic'
import { permissionProblem, reviewChannels, schedulableChannels } from './scheduler-eligibility'
import { FAILURE_DETAIL_PREFIX, type ScheduleStore } from './scheduler-state'
import { MINUTE_MS, backoffDelayMs, formatDuration, raceTimeout, realTimers, spreadTimes, type Timers } from './scheduler-timing'

export const PAUSE_KEY = 'automation.paused'

export function isPaused(core: Core): boolean {
  return core.settings.getRaw<boolean>(PAUSE_KEY, false)
}

export interface SchedulerOptions {
  tickMs: number
  /** Upper bound for channel cycles running at the same time. */
  maxConcurrent: number
  /** A cycle that has not finished after this long is recorded as failed (it keeps its slot until it really ends). */
  runTimeoutMs: number
  backoffBaseMs: number
  backoffCapMs: number
  /** A gap between two ticks larger than this means the machine slept. */
  wakeGapMs: number
  /** Pause after wake-up before the first overdue channel runs (the network needs a moment). */
  wakeSettleMs: number
  /** Distance between overdue channels after wake-up, restart or resume. */
  spreadMs: number
  /** How long shutdown waits for running cycles. */
  shutdownGraceMs: number
  timers: Timers
}

export const DEFAULT_SCHEDULER: SchedulerOptions = {
  tickMs: 15_000,
  maxConcurrent: 3,
  runTimeoutMs: 10 * MINUTE_MS,
  backoffBaseMs: MINUTE_MS,
  backoffCapMs: 30 * MINUTE_MS,
  wakeGapMs: 60_000,
  wakeSettleMs: 5_000,
  spreadMs: 20_000,
  shutdownGraceMs: 5_000,
  timers: realTimers
}

export interface SchedulerSnapshot {
  running: boolean
  activeRuns: number
  lastTickAt: string | null
  nextDueAt: string | null
}

type Verdict = 'ok' | 'failed' | 'suspended' | 'skipped'

interface CycleResult {
  run: RunResult
  verdict: Verdict
  /** Raw reason for failures and suspensions. */
  error: string
}

interface Inflight {
  /** Set when the run timed out: it no longer counts as active but still blocks a second run of the channel. */
  timedOut: boolean
  done: Promise<void>
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function draftingParts(result: Awaited<ReturnType<DraftingService['processChannel']>>): string[] {
  const parts: string[] = []
  if (result.prepared > 0) parts.push(plural(result.prepared, 'draft', 'drafts'))
  if (result.autoSent > 0) parts.push(plural(result.autoSent, 'auto-reply sent', 'auto-replies sent'))
  if (result.needsUser > 0) parts.push(`${result.needsUser} need you`)
  return parts
}

function verdictOf(status: MonitorOutcome['status']): Verdict {
  return status === 'ok' ? 'ok' : status
}

export class Scheduler {
  private readonly inflight = new Map<Id, Inflight>()
  private timer: unknown = null
  private running = false
  private osSuspended = false
  private lastTickMs: number | null = null
  private lastTickAt: string | null = null
  private monitorMissingLogged = false

  constructor(
    private readonly core: Core,
    private readonly store: ScheduleStore,
    private readonly periodic: PeriodicTasks,
    private readonly options: SchedulerOptions,
    /** Called whenever something visible in the automation state may have changed. */
    private readonly onChange: () => void
  ) {}

  get activeRuns(): number {
    let n = this.periodic.activeCount
    for (const entry of this.inflight.values()) if (!entry.timedOut) n += 1
    return n
  }

  start(): void {
    if (this.running) return
    this.running = true
    // A restart is handled like a wake-up: channels that became overdue while the app was stopped are spread out.
    this.spreadDue(this.nowMs(), 0)
    this.timer = this.options.timers.setInterval(() => void this.tick(), this.options.tickMs)
    void this.tick()
  }

  /** Stops the loop. Cycles already running are not aborted; `drain` waits for them. */
  stop(): void {
    this.running = false
    this.periodic.halt()
    if (this.timer !== null) this.options.timers.clearInterval(this.timer)
    this.timer = null
  }

  /** Resolves true when every running cycle and background task finished within `graceMs`. */
  drain(graceMs: number): Promise<boolean> {
    return raceTimeout(
      this.idle().then(() => true),
      graceMs,
      this.options.timers,
      () => false
    )
  }

  /** Resolves when no cycle and no background task is running. */
  async idle(): Promise<void> {
    for (;;) {
      await Promise.allSettled([...[...this.inflight.values()].map((e) => e.done), this.periodic.idle()])
      if (this.inflight.size === 0) return
    }
  }

  /** The OS is about to sleep: start nothing new until `onResume`. */
  onSuspend(): void {
    this.osSuspended = true
    this.onChange()
  }

  /** The OS woke up: treat it as a wake-up, spread overdue work and check uncertain sends first. */
  onResume(): void {
    if (!this.running) return
    this.osSuspended = false
    const now = this.nowMs()
    this.lastTickMs = now
    this.wake(now, this.options.wakeSettleMs, 'system wake-up')
    void this.tick()
  }

  /** The user resumed a paused automation: work that piled up must not fire all at once. */
  onUnpaused(): void {
    if (!this.running) return
    const now = this.nowMs()
    this.spreadDue(now, 0)
    this.periodic.requestReconcile(now)
    void this.tick()
  }

  async tick(): Promise<void> {
    if (!this.running || this.osSuspended) return
    const now = this.nowMs()
    const gap = this.lastTickMs === null ? 0 : now - this.lastTickMs
    this.lastTickMs = now
    this.lastTickAt = new Date(now).toISOString()
    try {
      if (gap > this.options.wakeGapMs) this.wake(now, this.options.wakeSettleMs, `a ${formatDuration(gap)} gap between checks`)
      reviewChannels(this.core, this.store, now)
      const paused = isPaused(this.core)
      if (!paused && this.periodic.gateOpen) this.dispatch(now)
      this.periodic.tick(now, paused)
    } catch (error) {
      // The loop itself must survive anything; the next tick tries again.
      this.core.log.error('scheduler', `Scheduler tick failed: ${message(error)}`)
    }
    this.onChange()
  }

  snapshot(): SchedulerSnapshot {
    return { running: this.running, activeRuns: this.activeRuns, lastTickAt: this.lastTickAt, nextDueAt: this.nextDueAt() }
  }

  // ───────────────────────────── dispatching ─────────────────────────────

  private nowMs(): number {
    return this.core.clock.now().getTime()
  }

  private dueMs(channel: Channel): number {
    const at = channel.nextCheckAt ? Date.parse(channel.nextCheckAt) : 0
    return Number.isNaN(at) ? 0 : at
  }

  /** Active channels whose time has come and that are not already running, most overdue first. */
  private dueChannels(nowMs: number): Channel[] {
    return schedulableChannels(this.core)
      .filter((c) => this.dueMs(c) <= nowMs && !this.inflight.has(c.id))
      .sort((a, b) => this.dueMs(a) - this.dueMs(b) || a.createdAt.localeCompare(b.createdAt))
  }

  private nextDueAt(): string | null {
    if (!this.running || isPaused(this.core)) return null
    const upcoming = schedulableChannels(this.core).filter((c) => !this.inflight.has(c.id))
    if (upcoming.length === 0) return null
    const now = this.nowMs()
    return new Date(Math.max(now, Math.min(...upcoming.map((c) => this.dueMs(c))))).toISOString()
  }

  private dispatch(nowMs: number): void {
    if (!this.core.services.monitor) {
      if (!this.monitorMissingLogged) {
        this.monitorMissingLogged = true
        this.core.log.warn('scheduler', 'Monitoring service is not available; scheduled checks are idle')
      }
      return
    }
    const slots = this.options.maxConcurrent - this.activeRuns
    if (slots <= 0) return
    for (const channel of this.dueChannels(nowMs).slice(0, slots)) this.launch(channel)
  }

  /** After a sleep or restart: overdue channels get staggered times and uncertain sends are re-checked first. */
  private wake(nowMs: number, settleMs: number, reason: string): void {
    const spread = this.spreadDue(nowMs, settleMs)
    this.periodic.requestReconcile(nowMs)
    this.core.log.info('scheduler', `Wake-up detected (${reason}); ${plural(spread, 'overdue channel', 'overdue channels')} will run spread out`)
  }

  private spreadDue(nowMs: number, settleMs: number): number {
    const due = this.dueChannels(nowMs)
    const times = spreadTimes(due.length, nowMs, settleMs, this.options.spreadMs)
    due.forEach((channel, i) => this.store.setNextCheck(channel.id, new Date(times[i]).toISOString()))
    return due.length
  }

  // ───────────────────────────── one channel cycle ─────────────────────────────

  private launch(channel: Channel): void {
    const entry: Inflight = { timedOut: false, done: Promise.resolve() }
    this.inflight.set(channel.id, entry)
    entry.done = this.execute(channel, entry)
      .catch((error: unknown) => {
        try {
          this.core.log.error('scheduler', `Run bookkeeping for ${channel.target} failed: ${message(error)}`, channel.id)
        } catch {
          // Database already closed during shutdown.
        }
      })
      .finally(() => {
        if (this.inflight.get(channel.id) === entry) this.inflight.delete(channel.id)
        this.onChange()
      })
    this.onChange()
  }

  private async execute(channel: Channel, entry: Inflight): Promise<void> {
    let cycleDone: Promise<unknown> = Promise.resolve()
    let result: CycleResult = { run: { status: 'failed', summary: 'The run did not complete' }, verdict: 'failed', error: 'The run did not complete' }

    await this.core.runs.track('monitor', { channelId: channel.id, productId: channel.productId }, async () => {
      const cycle = this.cycle(channel)
      cycleDone = cycle
      const timeoutError = `Timed out after ${formatDuration(this.options.runTimeoutMs)}`
      result = await raceTimeout(cycle, this.options.runTimeoutMs, this.options.timers, (): CycleResult => {
        entry.timedOut = true
        return { run: { status: 'failed', summary: timeoutError }, verdict: 'failed', error: timeoutError }
      })
      return result.run
    })

    this.applyVerdict(channel, result)
    // A timed-out cycle holds the channel until it truly ends, so the same channel is never run twice at once.
    await cycleDone
  }

  /** Never throws: every failure becomes a result so the channel's neighbours are unaffected. */
  private async cycle(channel: Channel): Promise<CycleResult> {
    const { monitor, drafting } = this.core.services
    if (!monitor) return { run: { status: 'skipped', summary: 'Monitoring service is not available' }, verdict: 'skipped', error: '' }

    let outcome: MonitorOutcome
    try {
      outcome = await monitor.runChannel(channel.id)
    } catch (error) {
      return { run: { status: 'failed', summary: message(error) }, verdict: 'failed', error: message(error) }
    }
    const summary = outcome.summary || `${plural(outcome.newOpportunities, 'new opportunity', 'new opportunities')}`
    if (outcome.status !== 'ok') return { run: { status: outcome.status, summary }, verdict: verdictOf(outcome.status), error: summary }
    if (!drafting) return { run: { status: 'ok', summary }, verdict: 'ok', error: '' }

    try {
      const parts = draftingParts(await drafting.processChannel(channel.id))
      return { run: { status: 'ok', summary: [summary, ...parts].join(', ') }, verdict: 'ok', error: '' }
    } catch (error) {
      // Observation worked; the AI step did not. The run shows as failed, the channel is not treated as disconnected,
      // and the discovered items are picked up again by the next cycle.
      this.core.log.warn('scheduler', `Drafting failed for ${channel.target}: ${message(error)}`, channel.id)
      return { run: { status: 'failed', summary: `${summary}; drafting failed: ${message(error)}` }, verdict: 'ok', error: message(error) }
    }
  }

  private applyVerdict(channel: Channel, result: CycleResult): void {
    const nowMs = this.nowMs()
    const nowIso = new Date(nowMs).toISOString()
    const intervalMs = Math.max(1, channel.settings.checkIntervalMin) * MINUTE_MS
    const at = (ms: number): string => new Date(ms).toISOString()

    switch (result.verdict) {
      case 'ok':
        this.store.recordSuccess(channel.id, nowIso, at(nowMs + intervalMs))
        break
      case 'skipped':
        this.store.recordSkipped(channel.id, nowIso, at(nowMs + intervalMs))
        break
      case 'failed': {
        const streak = this.store.recordFailure(channel.id, nowIso, result.error, (n) => {
          const delay = backoffDelayMs(n, this.options.backoffBaseMs, this.options.backoffCapMs)
          return { nextCheckAt: at(nowMs + delay), detail: `${FAILURE_DETAIL_PREFIX} (${plural(n, 'time', 'times')} in a row): ${result.error}. Retrying in ${formatDuration(delay)}.` }
        })
        this.core.log.warn('scheduler', `Check of ${channel.target} failed (${streak} in a row): ${result.error}`, channel.id)
        break
      }
      case 'suspended': {
        const current = this.core.repos.channel(channel.id)
        // A user who paused the channel meanwhile keeps their choice; otherwise it waits for the person.
        if (current.status === 'active' || current.status === 'needs_user') {
          const account = this.core.repos.listAccounts().find((a) => a.id === current.accountId)
          this.store.suspend(channel.id, result.error || 'The platform needs your input', permissionProblem(current, account) !== null)
        }
        this.core.log.warn('scheduler', `Channel ${channel.target} suspended: ${result.error}`, channel.id)
        break
      }
    }
    this.core.events.changed('channels')
  }
}
