import { describe, expect, it } from 'vitest'
import { deferred, FakeMetricsService, flush } from './scheduler-fakes'
import { makeHarness } from './scheduler-harness'
import { seedAccount } from './scheduler-seed'
import { MINUTE_MS } from './scheduler-timing'

const monitorRuns = (h: ReturnType<typeof makeHarness>) => h.core.runs.list({ limit: 100 }).filter((r) => r.kind === 'monitor')

describe('Scheduler: running due channels (REQ-005)', () => {
  it('runs monitoring then drafting for a due channel and records one run with a short result', async () => {
    const h = makeHarness()
    const channel = h.channel()
    h.monitor.outcome = { status: 'ok', summary: '3 new comments', newOpportunities: 3 }
    h.drafting.result = { prepared: 2, autoSent: 0, needsUser: 0 }

    await h.start()

    expect(h.log.filter((l) => l.startsWith('monitor') || l.startsWith('drafting'))).toEqual([`monitor:${channel.id}`, `drafting:${channel.id}`])
    const [run] = monitorRuns(h)
    expect(run).toMatchObject({ kind: 'monitor', channelId: channel.id, status: 'ok', summary: '3 new comments, 2 drafts' })
    expect(run.finishedAt).not.toBeNull()
    const after = h.core.repos.channel(channel.id)
    expect(after.nextCheckAt).toBe(new Date(h.clock.now().getTime() + 30 * MINUTE_MS).toISOString())
    expect(after.lastSuccessAt).toBe(h.clock.now().toISOString())
  })

  it('does not draft after a monitoring cycle that did not succeed', async () => {
    const h = makeHarness()
    h.channel()
    h.monitor.outcome = { status: 'failed', summary: 'Could not read r/test', newOpportunities: 0 }
    await h.start()
    expect(h.drafting.calls).toEqual([])
    expect(monitorRuns(h)[0]).toMatchObject({ status: 'failed', summary: 'Could not read r/test' })
  })

  it('does not start channels that are not active, not due, or whose account is not ready', async () => {
    const h = makeHarness()
    const later = new Date(h.clock.now().getTime() + 10 * MINUTE_MS).toISOString()
    h.channel({ status: 'paused' })
    h.channel({ status: 'setup' })
    h.channel({ status: 'needs_user' })
    h.channel({ nextCheckAt: later })
    const expired = seedAccount(h.core, { label: 'Expired', status: 'login_required' })
    h.channel({ accountId: expired.id })

    await h.start()
    await h.elapse(MINUTE_MS)

    expect(h.monitor.calls).toEqual([])
  })

  it('isolates failures: one channel throwing never stops the others', async () => {
    const h = makeHarness()
    const bad = h.channel({ target: 'r/bad' })
    const good = h.channel({ target: 'r/good' })
    h.monitor.behaviors.set(bad.id, async () => {
      throw new Error('browser crashed')
    })
    h.monitor.outcome = { status: 'ok', summary: '1 new comment', newOpportunities: 1 }

    await h.start()

    const runs = monitorRuns(h)
    expect(runs.find((r) => r.channelId === good.id)).toMatchObject({ status: 'ok' })
    expect(runs.find((r) => r.channelId === bad.id)).toMatchObject({ status: 'failed', summary: 'browser crashed' })
    expect(h.core.repos.channel(good.id).nextCheckAt).not.toBeNull()
    expect(h.core.repos.channel(bad.id).statusDetail).toContain('browser crashed')
    expect(h.automation.state().running).toBe(true)
  })

  it('treats an AI-process failure while drafting as a failed run without disconnecting the channel', async () => {
    const h = makeHarness()
    const channel = h.channel()
    h.monitor.outcome = { status: 'ok', summary: '2 new comments', newOpportunities: 2 }
    h.drafting.failWith = new Error('claude exited with code 1')

    await h.start()

    expect(monitorRuns(h)[0]).toMatchObject({ status: 'failed' })
    expect(monitorRuns(h)[0].summary).toContain('2 new comments')
    expect(monitorRuns(h)[0].summary).toContain('claude exited with code 1')
    // Observation worked, so the channel keeps its regular rhythm instead of backing off.
    expect(h.core.repos.channel(channel.id).nextCheckAt).toBe(new Date(h.clock.now().getTime() + 30 * MINUTE_MS).toISOString())
    expect(h.automation.store.get(channel.id).consecutiveFailures).toBe(0)
  })

  it('never starts a second run for a channel that is still running', async () => {
    const h = makeHarness()
    const channel = h.channel()
    const gate = deferred<{ status: 'ok'; summary: string; newOpportunities: number }>()
    h.monitor.behaviors.set(channel.id, () => gate.promise)

    await h.start({ wait: false, scheduler: { runTimeoutMs: 24 * 60 * MINUTE_MS } })
    h.timers.advance(10 * MINUTE_MS)
    await flush()
    expect(h.monitor.calls).toHaveLength(1)
    expect(h.automation.state().activeRuns).toBe(1)

    gate.resolve({ status: 'ok', summary: 'done', newOpportunities: 0 })
    await h.automation.idle()
    expect(h.automation.state().activeRuns).toBe(0)

    await h.elapse(31 * MINUTE_MS)
    expect(h.monitor.calls).toHaveLength(2)
  })

  it('bounds how many channels run at the same time', async () => {
    const h = makeHarness()
    const gates = new Map<string, ReturnType<typeof deferred<{ status: 'ok'; summary: string; newOpportunities: number }>>>()
    for (let i = 0; i < 4; i++) {
      const channel = h.channel({ target: `r/c${i}`, createdAt: new Date(h.clock.now().getTime() + i).toISOString() })
      const gate = deferred<{ status: 'ok'; summary: string; newOpportunities: number }>()
      gates.set(channel.id, gate)
      h.monitor.behaviors.set(channel.id, () => gate.promise)
    }

    await h.start({ wait: false, scheduler: { maxConcurrent: 2, runTimeoutMs: 24 * 60 * MINUTE_MS } })
    h.timers.advance(MINUTE_MS)
    await flush()
    expect(h.monitor.calls).toHaveLength(2)

    const first = h.monitor.calls[0]
    gates.get(first)!.resolve({ status: 'ok', summary: '', newOpportunities: 0 })
    await flush()
    h.timers.advance(15_000)
    await flush()
    expect(h.monitor.calls).toHaveLength(3)
  })

  it('tolerates missing services without crashing', async () => {
    const h = makeHarness()
    h.channel()
    h.core.services.monitor = undefined
    h.core.services.drafting = undefined
    h.core.services.sending = undefined
    h.core.services.metrics = undefined

    await h.start()
    await h.elapse(20 * MINUTE_MS)

    expect(h.automation.state().running).toBe(true)
    expect(h.core.log.list(50).some((l) => l.message.includes('Monitoring service is not available'))).toBe(true)
  })
})

describe('Scheduler: connection loss and recovery', () => {
  it('backs off exponentially up to 30 minutes and recovers on its own', async () => {
    const h = makeHarness()
    const channel = h.channel({ settings: { checkIntervalMin: 5 } })
    h.monitor.behaviors.set(channel.id, async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    await h.start()

    const delays: number[] = []
    for (let i = 0; i < 8; i++) {
      const next = Date.parse(h.core.repos.channel(channel.id).nextCheckAt!)
      delays.push((next - h.clock.now().getTime()) / MINUTE_MS)
      await h.elapse(next - h.clock.now().getTime())
    }
    expect(delays).toEqual([1, 2, 4, 8, 16, 30, 30, 30])
    expect(h.core.repos.channel(channel.id).statusDetail).toContain('net::ERR_INTERNET_DISCONNECTED')
    expect(h.core.repos.channel(channel.id).status).toBe('active')

    // The connection is back: the next attempt succeeds and the channel returns to its regular interval.
    h.monitor.behaviors.delete(channel.id)
    const next = Date.parse(h.core.repos.channel(channel.id).nextCheckAt!)
    await h.elapse(next - h.clock.now().getTime())
    const recovered = h.core.repos.channel(channel.id)
    expect(recovered.statusDetail).toBe('')
    expect(h.automation.store.get(channel.id).consecutiveFailures).toBe(0)
    expect(Date.parse(recovered.nextCheckAt!) - h.clock.now().getTime()).toBe(5 * MINUTE_MS)
  })

  it('keeps retrying a channel the monitor left in status "error" instead of leaving it stopped', async () => {
    const h = makeHarness()
    const channel = h.channel()
    // Like the real monitor: a failed read marks the channel 'error'; a good cycle puts it back to 'active'.
    let online = false
    h.monitor.behaviors.set(channel.id, async () => {
      h.core.db.prepare('UPDATE channels SET status = ? WHERE id = ?').run(online ? 'active' : 'error', channel.id)
      return online ? { status: 'ok' as const, summary: '1 new comment', newOpportunities: 1 } : { status: 'failed' as const, summary: 'offline', newOpportunities: 0 }
    })
    await h.start()
    expect(h.core.repos.channel(channel.id).status).toBe('error')

    await h.elapse(MINUTE_MS)
    await h.elapse(2 * MINUTE_MS)
    expect(h.monitor.calls.length).toBeGreaterThanOrEqual(3)

    online = true
    await h.elapse(5 * MINUTE_MS)
    expect(h.core.repos.channel(channel.id).status).toBe('active')
    expect(h.core.repos.channel(channel.id).statusDetail).toBe('')
  })

  it('stops scheduling a channel the monitor reports as suspended and leaves the others running', async () => {
    const h = makeHarness()
    const stuck = h.channel({ target: 'r/stuck' })
    const fine = h.channel({ target: 'r/fine' })
    h.monitor.behaviors.set(stuck.id, async () => ({ status: 'suspended' as const, summary: 'CAPTCHA shown', newOpportunities: 0 }))

    await h.start()
    await h.elapse(40 * MINUTE_MS)

    const after = h.core.repos.channel(stuck.id)
    expect(after.status).toBe('needs_user')
    expect(after.statusDetail).toBe('CAPTCHA shown')
    expect(h.monitor.calls.filter((id) => id === stuck.id)).toHaveLength(1)
    expect(h.monitor.calls.filter((id) => id === fine.id).length).toBeGreaterThan(1)
  })

  it('records a hung cycle as failed after the timeout and still never runs the channel twice', async () => {
    const h = makeHarness()
    const hung = h.channel({ target: 'r/hung' })
    const fine = h.channel({ target: 'r/fine' })
    const gate = deferred<{ status: 'ok'; summary: string; newOpportunities: number }>()
    h.monitor.behaviors.set(hung.id, () => gate.promise)

    await h.start({ wait: false, scheduler: { runTimeoutMs: 2 * MINUTE_MS } })
    h.timers.advance(3 * MINUTE_MS)
    await flush()

    const run = monitorRuns(h).find((r) => r.channelId === hung.id)
    expect(run).toMatchObject({ status: 'failed', summary: 'Timed out after 2 min' })
    expect(monitorRuns(h).find((r) => r.channelId === fine.id)).toMatchObject({ status: 'ok' })
    expect(h.automation.state().activeRuns).toBe(0)

    // The backoff expires while the old cycle is still hanging: no overlapping second run.
    h.timers.advance(10 * MINUTE_MS)
    await flush()
    expect(h.monitor.calls.filter((id) => id === hung.id)).toHaveLength(1)

    gate.resolve({ status: 'ok', summary: 'late', newOpportunities: 0 })
    await h.automation.idle()
    h.timers.advance(10 * MINUTE_MS)
    await h.automation.idle()
    expect(h.monitor.calls.filter((id) => id === hung.id).length).toBeGreaterThan(1)
  })
})

describe('Scheduler: pause (REQ-005 criterion 13)', () => {
  it('runs no scheduled monitoring, publications or periodic reconciliation while paused, and resumes afterwards', async () => {
    const h = makeHarness()
    h.channel()
    h.core.settings.setRaw('automation.paused', true)

    await h.start()
    await h.elapse(10 * MINUTE_MS)

    expect(h.monitor.calls).toEqual([])
    expect(h.drafting.calls).toEqual([])
    expect(h.sending.sendDueCalls).toBe(0)
    // Only the one recovery reconciliation after launch ran.
    expect(h.sending.reconcileCalls).toBe(1)
    expect(h.automation.state()).toMatchObject({ paused: true, nextDueAt: null })

    h.automation.setPaused(false)
    await h.automation.idle()
    expect(h.monitor.calls).toHaveLength(1)
    await h.elapse(MINUTE_MS)
    expect(h.sending.sendDueCalls).toBeGreaterThan(0)
  })

  it('persists the flag, reports it and tells every UI when it changes', async () => {
    const h = makeHarness()
    await h.start()
    const events: boolean[] = []
    h.core.events.subscribe((e) => {
      if (e.type === 'automation') events.push(e.state.paused)
    })

    const state = await h.core.router.call('automation.setPaused', { paused: true })
    expect(state.paused).toBe(true)
    expect((await h.core.router.call('automation.get', undefined)).paused).toBe(true)
    expect(h.core.settings.getRaw('automation.paused', false)).toBe(true)

    await h.core.router.call('automation.setPaused', { paused: false })
    expect(events[0]).toBe(true)
    expect(events.at(-1)).toBe(false)
  })
})

describe('Scheduler: sleep and wake-up (REQ-005)', () => {
  const sleepOptions = { wakeGapMs: 60_000, wakeSettleMs: 5_000, spreadMs: 20_000 }

  it('spreads overdue channels out after a long gap instead of running them all at once', async () => {
    const h = makeHarness()
    const soon = new Date(h.clock.now().getTime() + MINUTE_MS).toISOString()
    const channels = [0, 1, 2, 3].map((i) => h.channel({ target: `r/c${i}`, nextCheckAt: soon, createdAt: new Date(h.clock.now().getTime() + i).toISOString() }))
    await h.start({ scheduler: sleepOptions })
    expect(h.monitor.calls).toEqual([])

    h.timers.sleep(3 * 60 * MINUTE_MS)
    await h.elapse(15_000)
    expect(h.monitor.calls).toEqual([])

    const times = channels.map((c) => Date.parse(h.core.repos.channel(c.id).nextCheckAt!)).sort((a, b) => a - b)
    expect(times.map((t, i) => (i === 0 ? 0 : t - times[i - 1]))).toEqual([0, 20_000, 20_000, 20_000])

    // Channels are due 5 s, 25 s, 45 s and 65 s after the wake-up; ticks come every 15 s: one new run per tick at most.
    const seen: number[] = []
    for (let i = 0; i < 5; i++) {
      await h.elapse(15_000)
      seen.push(h.monitor.calls.length)
    }
    expect(seen).toEqual([1, 2, 3, 3, 4])
  })

  it('treats an explicit system resume as a wake-up and re-checks uncertain sends', async () => {
    const h = makeHarness()
    const soon = new Date(h.clock.now().getTime() + MINUTE_MS).toISOString()
    for (let i = 0; i < 3; i++) h.channel({ target: `r/c${i}`, nextCheckAt: soon, createdAt: new Date(h.clock.now().getTime() + i).toISOString() })
    const automation = await h.start({ scheduler: sleepOptions })
    const reconcileBefore = h.sending.reconcileCalls

    automation.onSuspend()
    h.timers.sleep(2 * 60 * MINUTE_MS)
    h.timers.advance(15_000)
    await flush()
    expect(h.monitor.calls).toEqual([])

    automation.onResume()
    await automation.idle()
    expect(h.monitor.calls).toEqual([])

    await h.elapse(15_000)
    expect(h.monitor.calls).toHaveLength(1)
    expect(h.sending.reconcileCalls).toBeGreaterThan(reconcileBefore)
  })

  it('starts nothing while the system is suspended', async () => {
    const h = makeHarness()
    const automation = await h.start()
    const dueBefore = h.sending.sendDueCalls
    h.channel()

    automation.onSuspend()
    await h.elapse(10 * MINUTE_MS)
    expect(h.monitor.calls).toEqual([])
    expect(h.sending.sendDueCalls).toBe(dueBefore)
  })
})

describe('Scheduler: periodic tasks', () => {
  it('attempts scheduled publications on every tick and reconciles uncertain sends every 5 minutes', async () => {
    const h = makeHarness()
    await h.start()
    expect(h.sending.reconcileCalls).toBe(1)
    const dueBefore = h.sending.sendDueCalls

    for (let i = 0; i < 4; i++) await h.elapse(15_000)
    expect(h.sending.sendDueCalls - dueBefore).toBe(4)
    expect(h.sending.reconcileCalls).toBe(1)

    await h.elapse(5 * MINUTE_MS)
    expect(h.sending.reconcileCalls).toBe(2)
  })

  it('refreshes platform metrics for each active channel about once an hour', async () => {
    const h = makeHarness()
    const metrics = new FakeMetricsService()
    h.core.services.metrics = metrics
    const channel = h.channel()
    await h.start()
    expect(metrics.calls).toEqual([channel.id])

    await h.elapse(59 * MINUTE_MS)
    expect(metrics.calls).toHaveLength(1)
    await h.elapse(2 * MINUTE_MS)
    expect(metrics.calls).toHaveLength(2)
    expect(h.core.runs.list({ limit: 50 }).filter((r) => r.kind === 'metrics')).toHaveLength(2)
  })

  it('survives a failing background task without stopping the loop', async () => {
    const h = makeHarness()
    h.channel()
    h.sending.sendDuePublications = async () => {
      throw new Error('sending service exploded')
    }
    await h.start()
    await h.elapse(MINUTE_MS)

    expect(h.monitor.calls.length).toBeGreaterThan(0)
    const errors = h.core.log.list(50, 'error').filter((l) => l.message.includes('sending service exploded'))
    expect(errors).toHaveLength(1)
  })

  it('does no interval work after it was stopped', async () => {
    const h = makeHarness()
    h.channel()
    const automation = await h.start()
    const callsAtStop = h.monitor.calls.length
    const dueAtStop = h.sending.sendDueCalls

    await automation.stop()
    expect(h.timers.pending).toBe(0)
    await h.elapse(3 * 60 * MINUTE_MS)

    expect(h.monitor.calls).toHaveLength(callsAtStop)
    expect(h.sending.sendDueCalls).toBe(dueAtStop)
    expect(automation.state().running).toBe(false)
  })
})
