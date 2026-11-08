// Background lifecycle (I-7, DEC-003, REQ-005). One Automation object per core ties together the scheduler,
// the attention watcher and notifications, the pause flag and the startup/shutdown sequences.
//
//  launch  : close interrupted runs, detect an unclean shutdown, re-check permissions, reconcile uncertain
//            sends, and only then start ticking.
//  pause   : persisted flag; scheduled monitoring, automatic replies and scheduled publications stop.
//  quit    : the shutdown hook stops ticking, waits briefly for running cycles and records a clean shutdown.
//            There is deliberately no start-at-login: after a restart or Quit the user launches the app.

import type { AutomationState } from '../../shared/types'
import type { Core } from '../core'
import { AttentionWatcher } from './attention'
import { AttentionNotifier, silentSink, type NotificationSink } from './attention-notify'
import { SHUTDOWN_KEY, recoverOnStart, type RecoveryReport, type ShutdownMarker } from './lifecycle-recovery'
import { DEFAULT_SCHEDULER, PAUSE_KEY, Scheduler, isPaused, type SchedulerOptions } from './scheduler'
import { DEFAULT_PERIODIC, PeriodicTasks, type PeriodicOptions } from './scheduler-periodic'
import { ScheduleStore } from './scheduler-state'

export interface AutomationOptions {
  /** Where attention and digest notifications go (macOS notifications in the app). Defaults to none. */
  notifier?: NotificationSink
  scheduler?: Partial<SchedulerOptions>
  periodic?: Partial<PeriodicOptions>
}

export class Automation {
  readonly store: ScheduleStore
  readonly attention: AttentionWatcher
  /** What the last launch had to repair; null before `start`. */
  recovery: RecoveryReport | null = null

  private scheduler: Scheduler | null = null
  private periodic: PeriodicTasks | null = null
  private graceMs = DEFAULT_SCHEDULER.shutdownGraceMs
  private startPromise: Promise<void> | null = null
  private stopped = false
  private lastPublished = ''

  constructor(private readonly core: Core) {
    this.store = new ScheduleStore(core.db, () => core.clock.now().toISOString())
    this.attention = new AttentionWatcher(core, this.store)
  }

  state(): AutomationState {
    const snapshot = this.scheduler?.snapshot()
    return {
      paused: isPaused(this.core),
      running: snapshot?.running ?? false,
      activeRuns: snapshot?.activeRuns ?? 0,
      lastTickAt: snapshot?.lastTickAt ?? null,
      nextDueAt: snapshot?.nextDueAt ?? null,
      background: this.core.background
    }
  }

  /** Number of items that need the user, for the menu-bar item. */
  attentionCount(): number {
    return this.attention.size
  }

  /** Emits the state to every UI, but only when something other than the tick time changed. */
  publishState(force = false): AutomationState {
    const state = this.state()
    const { lastTickAt: _tick, ...stable } = state
    const signature = JSON.stringify(stable)
    if (force || signature !== this.lastPublished) {
      this.lastPublished = signature
      this.core.events.emit({ type: 'automation', state })
    }
    return state
  }

  start(options: AutomationOptions = {}): Promise<void> {
    this.startPromise ??= this.run(options)
    return this.startPromise
  }

  private async run(options: AutomationOptions): Promise<void> {
    const { core } = this
    const sink = options.notifier ?? silentSink
    const schedulerOptions: SchedulerOptions = { ...DEFAULT_SCHEDULER, ...options.scheduler }
    this.graceMs = schedulerOptions.shutdownGraceMs
    this.periodic = new PeriodicTasks(core, { ...DEFAULT_PERIODIC, ...options.periodic }, sink)
    this.scheduler = new Scheduler(core, this.store, this.periodic, schedulerOptions, () => this.publishState())

    // Registered first so a Quit during the (possibly slow) recovery still shuts down in order.
    core.onShutdown(() => this.stop())

    this.recovery = recoverOnStart(core, this.store)
    const notifier = new AttentionNotifier(core, sink)
    this.attention.onItems = (items) => notifier.consider(items)
    this.attention.start()

    // Uncertain sends are settled before anything is scheduled, so a send is never repeated blindly.
    await this.periodic.reconcileAtStartup()
    if (this.stopped) return

    this.scheduler.start()
    this.publishState(true)
    core.log.info('lifecycle', 'Automation started')
  }

  /** Pause or resume automation (REQ-005). Explicit user actions such as approve/send are unaffected. */
  setPaused(paused: boolean): AutomationState {
    const { core } = this
    const was = isPaused(core)
    core.settings.setRaw(PAUSE_KEY, paused)
    if (was !== paused) {
      core.log.info('automation', paused ? 'Automation paused by the user' : 'Automation resumed by the user')
      if (!paused) this.scheduler?.onUnpaused()
    }
    return this.publishState()
  }

  /** The system is going to sleep (powerMonitor 'suspend'). */
  onSuspend(): void {
    this.scheduler?.onSuspend()
  }

  /** The system woke up (powerMonitor 'resume'): spread overdue work, reconcile first. */
  onResume(): void {
    this.scheduler?.onResume()
    this.publishState()
  }

  /** Waits until scheduled work is idle; for tests and orderly shutdown. */
  async idle(): Promise<void> {
    await this.scheduler?.idle()
  }

  /** Runs one scheduler tick now (tests, and "check now" style callers). */
  tick(): Promise<void> {
    return this.scheduler?.tick() ?? Promise.resolve()
  }

  /**
   * Shutdown hook. Stops ticking, waits up to the grace period for running cycles, closes what is still running as
   * interrupted (their progress was committed step by step; the next launch picks the channel up again) and records
   * a clean shutdown so the next launch knows nothing needs repair.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    const { core } = this
    const activeRuns = this.scheduler?.activeRuns ?? 0
    this.scheduler?.stop()
    this.attention.stop()

    const drained = this.scheduler ? await this.scheduler.drain(this.graceMs) : true
    const interrupted = drained ? 0 : core.runs.closeInterrupted()
    if (!drained) core.log.warn('lifecycle', `${interrupted} run(s) did not finish within the shutdown grace period and were interrupted`)

    core.settings.setRaw(SHUTDOWN_KEY, { at: core.clock.now().toISOString(), clean: true, activeRuns, interrupted } satisfies ShutdownMarker)
    core.log.info('lifecycle', 'Automation stopped')
    this.publishState(true)
  }
}

const automations = new WeakMap<Core, Automation>()

/** The core's Automation. Created together with the core so API handlers work before `startAutomation`. */
export function getAutomation(core: Core): Automation {
  let automation = automations.get(core)
  if (!automation) {
    automation = new Automation(core)
    automations.set(core, automation)
  }
  return automation
}

/** Runs the startup sequence and starts the scheduler. The core's shutdown hook stops it again. */
export async function startAutomation(core: Core, options: AutomationOptions = {}): Promise<Automation> {
  const automation = getAutomation(core)
  await automation.start(options)
  return automation
}
