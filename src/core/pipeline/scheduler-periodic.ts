// Work that runs next to the per-channel monitoring cycles: scheduled publications, reconciliation of uncertain
// sends, metrics refresh and the daily digest. Every task is guarded so it never overlaps itself and a failure
// is logged instead of escaping into the tick loop.

import type { Core } from '../core'
import { sendDueDigests } from './attention-digest'
import type { NotificationSink } from './attention-notify'
import { lastCapturedAt, refreshTracked } from './metrics'
import { schedulableChannels } from './scheduler-eligibility'
import { MINUTE_MS } from './scheduler-timing'
import type { SendingService } from '../services'

export interface PeriodicOptions {
  /** How often uncertain sends are re-checked with the platform. */
  reconcileEveryMs: number
  /** How often each active channel's platform metrics are refreshed. */
  metricsEveryMs: number
  /** How often due metrics and digests are looked for (they are not needed on every tick). */
  scanEveryMs: number
  /** Delay before the startup reconciliation is retried after it failed. */
  gateRetryMs: number
  /** The same failing task logs at most once per this interval. */
  errorLogEveryMs: number
}

export const DEFAULT_PERIODIC: PeriodicOptions = {
  reconcileEveryMs: 5 * MINUTE_MS,
  metricsEveryMs: 60 * MINUTE_MS,
  scanEveryMs: MINUTE_MS,
  gateRetryMs: 30_000,
  errorLogEveryMs: 10 * MINUTE_MS
}

export class PeriodicTasks {
  /** Open once uncertain sends were reconciled after launch: until then no scheduled work may start (DEC-003). */
  private reconciled = false
  private reconcileDueMs = 0
  private gateRetryAtMs = 0
  private metricsScanAtMs = 0
  private digestScanAtMs = 0
  private halted = false
  private readonly busy = new Set<string>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly metricsAttemptMs = new Map<string, number>()
  private readonly lastLoggedMs = new Map<string, number>()

  constructor(
    private readonly core: Core,
    private readonly options: PeriodicOptions,
    private readonly sink: NotificationSink
  ) {}

  get gateOpen(): boolean {
    return this.reconciled
  }

  /** Background tasks that count as active runs in the automation state (the metrics sweep). */
  get activeCount(): number {
    return this.busy.has('metrics') ? 1 : 0
  }

  halt(): void {
    this.halted = true
  }

  /** Resolves when no task is running. Tasks started meanwhile are awaited as well. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
  }

  /** Makes the next tick re-check uncertain sends (after wake-up, or after the user resumes automation). */
  requestReconcile(nowMs: number): void {
    this.reconcileDueMs = nowMs
  }

  /**
   * The recovery step that must precede any scheduled work: ask the platform about every send whose outcome is
   * unknown instead of ever repeating it blindly. On failure the gate stays closed and the tick retries.
   */
  reconcileAtStartup(): Promise<void> {
    return this.track('reconcile-startup', () => this.attemptStartupReconcile())
  }

  private async attemptStartupReconcile(): Promise<void> {
    const sending = this.core.services.sending
    if (!sending) {
      this.reconciled = true
      return
    }
    const unresolved = this.unresolvedCount()
    try {
      await this.core.runs.track(
        'reconcile',
        {},
        async () => {
          const resolved = await sending.reconcileAllUnknown()
          const summary = unresolved === 0 && resolved === 0 ? 'No uncertain sends to reconcile' : `${resolved} of ${unresolved} uncertain sends resolved`
          return { status: 'ok' as const, summary }
        },
        { rethrow: true }
      )
      this.reconciled = true
      this.reconcileDueMs = this.core.clock.now().getTime() + this.options.reconcileEveryMs
    } catch (error) {
      this.gateRetryAtMs = this.core.clock.now().getTime() + this.options.gateRetryMs
      this.fail('reconcile-startup', error)
    }
  }

  /** Called on every scheduler tick. Starts whatever is due and returns immediately. */
  tick(nowMs: number, paused: boolean): void {
    if (this.halted) return
    if (!this.reconciled) {
      // Closed gate: only the retry may run; nothing else is scheduled until uncertain sends are reconciled.
      if (nowMs >= this.gateRetryAtMs) this.launch('reconcile-startup', () => this.attemptStartupReconcile())
      return
    }
    if (!paused) {
      const { sending, metrics } = this.core.services
      if (sending) {
        this.launch('send-due', async () => {
          const attempted = await sending.sendDuePublications()
          if (attempted > 0) this.core.log.info('scheduler', `${attempted} scheduled publication(s) attempted`)
        })
        if (nowMs >= this.reconcileDueMs) {
          this.reconcileDueMs = nowMs + this.options.reconcileEveryMs
          this.launch('reconcile', () => this.reconcilePeriodic(sending))
        }
      }
      if (metrics && nowMs >= this.metricsScanAtMs) {
        this.metricsScanAtMs = nowMs + this.options.scanEveryMs
        this.launch('metrics', () => this.refreshDueMetrics(nowMs))
      }
    }
    // A digest is a local summary, not work on a platform, so it also arrives while automation is paused.
    if (nowMs >= this.digestScanAtMs) {
      this.digestScanAtMs = nowMs + this.options.scanEveryMs
      try {
        sendDueDigests(this.core, this.sink)
      } catch (error) {
        this.fail('digest', error)
      }
    }
  }

  private unresolvedCount(): number {
    return (this.core.db.prepare("SELECT COUNT(*) AS n FROM send_actions WHERE state = 'unknown'").get() as { n: number }).n
  }

  private async reconcilePeriodic(sending: SendingService): Promise<void> {
    const unresolved = this.unresolvedCount()
    if (unresolved === 0) {
      await sending.reconcileAllUnknown()
      return
    }
    // Only a check that has something to resolve is worth a line in the run log.
    await this.core.runs.track(
      'reconcile',
      {},
      async () => {
        const resolved = await sending.reconcileAllUnknown()
        return { status: 'ok' as const, summary: `${resolved} of ${unresolved} uncertain sends resolved` }
      },
      { rethrow: true }
    )
  }

  private async refreshDueMetrics(nowMs: number): Promise<void> {
    for (const channel of schedulableChannels(this.core)) {
      if (this.halted) return
      const capability = channel.capabilities.find((c) => c.key === 'metrics')
      if (capability && (capability.status === 'unavailable' || capability.status === 'restricted')) continue
      const captured = lastCapturedAt(this.core, channel.id)
      const last = Math.max(this.metricsAttemptMs.get(channel.id) ?? 0, captured ? Date.parse(captured) : 0)
      if (nowMs - last < this.options.metricsEveryMs) continue
      this.metricsAttemptMs.set(channel.id, nowMs)
      try {
        await refreshTracked(this.core, channel.id)
      } catch (error) {
        this.fail(`metrics:${channel.id}`, error)
      }
    }
  }

  /** Runs `fn` unless the same task is still running; the promise is tracked for `idle()`. */
  private launch(name: string, fn: () => Promise<unknown>): void {
    if (this.busy.has(name)) return
    this.busy.add(name)
    void this.track(name, fn).finally(() => this.busy.delete(name))
  }

  private track(name: string, fn: () => Promise<unknown>): Promise<void> {
    const promise: Promise<void> = (async () => {
      try {
        await fn()
      } catch (error) {
        this.fail(name, error)
      }
    })().finally(() => this.pending.delete(promise))
    this.pending.add(promise)
    return promise
  }

  private fail(name: string, error: unknown): void {
    const now = this.core.clock.now().getTime()
    const last = this.lastLoggedMs.get(name)
    if (last !== undefined && now - last < this.options.errorLogEveryMs) return
    this.lastLoggedMs.set(name, now)
    try {
      this.core.log.error('scheduler', `Background task "${name}" failed: ${error instanceof Error ? error.message : String(error)}`)
    } catch {
      // The database may already be closed during shutdown; there is nowhere left to report to.
    }
  }
}
