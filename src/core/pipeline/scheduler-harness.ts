// Shared setup for the scheduler and lifecycle tests: an in-memory core with fake services, manual timers and
// a recording notification sink. Not imported by production code.

import type { Account, Channel } from '../../shared/types'
import type { CoreDeps } from '../core'
import { makeTestCore, type TestCore } from '../testing/fakes'
import type { AppNotification, NotificationSink } from './attention-notify'
import { getAutomation, startAutomation, type Automation, type AutomationOptions } from './lifecycle'
import { FakeDrafting, FakeMonitor, FakeSending, ManualTimers } from './scheduler-fakes'
import { seedAccount, seedChannel, seedProduct, type ChannelSeed } from './scheduler-seed'

export class RecordingSink implements NotificationSink {
  readonly sent: AppNotification[] = []
  notify(notification: AppNotification): void {
    this.sent.push(notification)
  }
}

export interface Harness extends TestCore {
  timers: ManualTimers
  log: string[]
  monitor: FakeMonitor
  drafting: FakeDrafting
  sending: FakeSending
  sink: RecordingSink
  productId: string
  account: Account
  /** The core's Automation (exists before it is started, like in the application). */
  automation: Automation
  /** Adds a due, active channel unless overridden. */
  channel(seed?: Partial<ChannelSeed>): Channel
  /** Starts automation; `wait: false` returns right after the first tick (for tests with runs that stay pending). */
  start(options?: AutomationOptions & { wait?: boolean }): Promise<Automation>
  /** Moves time forward (firing ticks on the way) and waits for the work they started. */
  elapse(ms: number): Promise<void>
}

/** Scheduler options that make tests deterministic: no wake-up detection, no spreading, short shutdown grace. */
export const TEST_SCHEDULER = { tickMs: 15_000, wakeGapMs: Number.MAX_SAFE_INTEGER, wakeSettleMs: 0, spreadMs: 0, shutdownGraceMs: 100 }

export function makeHarness(overrides: Partial<CoreDeps> = {}): Harness {
  const base = makeTestCore(overrides)
  const timers = new ManualTimers(base.clock)
  const log: string[] = []
  const monitor = new FakeMonitor(log)
  const drafting = new FakeDrafting(log)
  const sending = new FakeSending(log)
  const sink = new RecordingSink()
  base.core.services.monitor = monitor
  base.core.services.drafting = drafting
  base.core.services.sending = sending
  // Metrics are exercised by their own tests; here they would only add runs for a connector that is not registered.
  base.core.services.metrics = undefined
  const productId = seedProduct(base.core)
  const account = seedAccount(base.core)
  const automation = getAutomation(base.core)

  const harness: Harness = {
    ...base,
    timers,
    log,
    monitor,
    drafting,
    sending,
    sink,
    productId,
    account,
    automation,
    channel: (seed = {}) => seedChannel(base.core, { productId, accountId: account.id, ...seed }),
    start: async ({ wait = true, ...options } = {}) => {
      await startAutomation(base.core, {
        notifier: sink,
        ...options,
        scheduler: { ...TEST_SCHEDULER, timers, ...options.scheduler }
      })
      if (wait) await automation.idle()
      return automation
    },
    elapse: async (ms) => {
      timers.advance(ms)
      await automation.idle()
    }
  }
  return harness
}
