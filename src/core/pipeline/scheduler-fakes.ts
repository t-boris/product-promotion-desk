// Test doubles for the scheduler and lifecycle tests. Not imported by production code.

import type { Capability, Id, MetricReading } from '../../shared/types'
import type { Connector, ConnectorContext } from '../ports'
import type { DraftingService, MetricsService, MonitorOutcome, MonitorService, SendingService } from '../services'
import type { FakeClock } from '../testing/fakes'
import type { Timers } from './scheduler-timing'

/** Timers driven by hand: `advance` moves the FakeClock and fires everything that became due, in time order. */
export class ManualTimers implements Timers {
  private seq = 0
  private readonly timers = new Map<number, { at: number; every: number | null; fn: () => void }>()

  constructor(private readonly clock: FakeClock) {}

  setInterval(fn: () => void, ms: number): unknown {
    const id = ++this.seq
    this.timers.set(id, { at: this.clock.now().getTime() + ms, every: ms, fn })
    return id
  }
  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number)
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq
    this.timers.set(id, { at: this.clock.now().getTime() + ms, every: null, fn })
    return id
  }
  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  get pending(): number {
    return this.timers.size
  }

  /**
   * The machine sleeps: the clock jumps but no timer fires meanwhile. Afterwards intervals restart from "now"
   * (as a real timer does after wake-up) and due timeouts fire on the next advance.
   */
  sleep(ms: number): void {
    this.clock.advance(ms)
    const now = this.clock.now().getTime()
    for (const timer of this.timers.values()) timer.at = timer.every !== null ? now + timer.every : Math.max(timer.at, now)
  }

  advance(ms: number): void {
    const target = this.clock.now().getTime() + ms
    for (;;) {
      const next = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort(([, a], [, b]) => a.at - b.at)[0]
      if (!next) break
      const [id, timer] = next
      this.clock.set(new Date(timer.at).toISOString())
      if (timer.every !== null) timer.at += timer.every
      else this.timers.delete(id)
      timer.fn()
    }
    this.clock.set(new Date(target).toISOString())
  }
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets every pending promise callback run (one macrotask turn drains the microtask queue). */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export class FakeMonitor implements MonitorService {
  readonly calls: Id[] = []
  readonly behaviors = new Map<Id, () => Promise<MonitorOutcome>>()
  outcome: MonitorOutcome = { status: 'ok', summary: '0 new comments', newOpportunities: 0 }
  constructor(private readonly log: string[] = []) {}

  async runChannel(channelId: Id): Promise<MonitorOutcome> {
    this.calls.push(channelId)
    this.log.push(`monitor:${channelId}`)
    const behavior = this.behaviors.get(channelId)
    return behavior ? behavior() : this.outcome
  }
}

export class FakeDrafting implements DraftingService {
  readonly calls: Id[] = []
  result = { prepared: 0, autoSent: 0, needsUser: 0 }
  failWith: Error | null = null
  constructor(private readonly log: string[] = []) {}

  async processChannel(channelId: Id): Promise<{ prepared: number; autoSent: number; needsUser: number }> {
    this.calls.push(channelId)
    this.log.push(`drafting:${channelId}`)
    if (this.failWith) throw this.failWith
    return this.result
  }
}

export class FakeSending implements SendingService {
  sendDueCalls = 0
  reconcileCalls = 0
  dueResult = 0
  reconcileResult = 0
  reconcileFailure: Error | null = null
  /** When set, reconcileAllUnknown waits for it (to hold back the startup sequence). */
  reconcileGate: Promise<void> | null = null
  constructor(private readonly log: string[] = []) {}

  async send(): Promise<never> {
    throw new Error('send is not used by the lifecycle tests')
  }
  async reconcile(): Promise<null> {
    return null
  }
  async reconcileAllUnknown(): Promise<number> {
    this.reconcileCalls += 1
    this.log.push('reconcile')
    if (this.reconcileGate) await this.reconcileGate
    if (this.reconcileFailure) throw this.reconcileFailure
    return this.reconcileResult
  }
  async sendDuePublications(): Promise<number> {
    this.sendDueCalls += 1
    this.log.push('sendDue')
    return this.dueResult
  }
}

export class FakeMetricsService implements MetricsService {
  readonly calls: Id[] = []
  async refresh(channelId: Id): Promise<[]> {
    this.calls.push(channelId)
    return []
  }
}

/** A connector whose platform answers are scripted; only fetchMetrics is meaningful for the results tests. */
export function fakeConnector(overrides: Partial<Connector> & { metrics?: MetricReading[] | Error } = {}): Connector {
  const { metrics, ...rest } = overrides
  const unused = async (): Promise<never> => {
    throw new Error('not used in this test')
  }
  return {
    id: 'fake',
    platform: 'fake',
    version: '1',
    matches: () => true,
    normalizeTarget: (input: string) => ({ target: input, url: `https://fake.example/${input}` }),
    loginUrl: () => 'https://fake.example/login',
    checkLogin: unused,
    assess: async (): Promise<Capability[]> => [],
    fetchActivity: unused,
    fetchThread: unused,
    fetchMetrics: async (_ctx: ConnectorContext): Promise<MetricReading[]> => {
      if (metrics instanceof Error) throw metrics
      return metrics ?? []
    },
    publish: unused,
    findPublished: unused,
    ...rest
  }
}
