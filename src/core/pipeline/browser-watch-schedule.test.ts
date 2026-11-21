// DEC-042: the scheduler looks at a channel the app only watches in the browser as it reads any other: when it is due, once at a time, never drafting
// anything for it, and a look that could not start is tried again in a few minutes without counting as a failure.

import { describe, expect, it } from 'vitest'
import { WATCH_TIMEOUT_MS } from '../browser-agent/watch'
import { deferred, flush } from './scheduler-fakes'
import { makeHarness } from './scheduler-harness'
import { seedAccount } from './scheduler-seed'
import { MINUTE_MS } from './scheduler-timing'

const monitorRuns = (h: ReturnType<typeof makeHarness>) => h.core.runs.list({ limit: 100 }).filter((r) => r.kind === 'monitor')
const watchedSeed = { platform: 'instagram', reads: false, target: '@natalmystic', nextCheckAt: null } as const

describe('Scheduler: a channel watched in the browser', () => {
  it('starts it when it is due, runs the monitor and never drafting, and plans the next check by the interval', async () => {
    const h = makeHarness()
    const channel = h.channel({ ...watchedSeed })
    h.monitor.outcome = { status: 'ok', summary: 'Watched in the browser: 2 noted, 1 judged not relevant, 0 already known', newOpportunities: 0 }
    h.drafting.result = { prepared: 5, autoSent: 0, needsUser: 0 }

    await h.start()

    expect(h.monitor.calls).toEqual([channel.id])
    expect(h.drafting.calls).toEqual([])
    expect(monitorRuns(h)[0]).toMatchObject({ channelId: channel.id, status: 'ok', summary: 'Watched in the browser: 2 noted, 1 judged not relevant, 0 already known' })
    expect(h.core.repos.channel(channel.id).nextCheckAt).toBe(new Date(h.clock.now().getTime() + 30 * MINUTE_MS).toISOString())
  })

  it('still drafts for a channel it reads, so the skipped drafting is about the watched channel alone', async () => {
    const h = makeHarness()
    const read = h.channel({ target: 'r/read' })
    h.channel({ ...watchedSeed })
    await h.start()
    expect(h.drafting.calls).toEqual([read.id])
  })

  it('does not start it before it is due, when it is paused or in setup, or when its account is not signed in', async () => {
    const h = makeHarness()
    const later = new Date(h.clock.now().getTime() + 10 * MINUTE_MS).toISOString()
    h.channel({ ...watchedSeed, target: '@not_due', nextCheckAt: later })
    h.channel({ ...watchedSeed, target: '@paused', status: 'paused' })
    h.channel({ ...watchedSeed, target: '@setup', status: 'setup' })
    const expired = seedAccount(h.core, { label: 'Expired', status: 'login_required' })
    h.channel({ ...watchedSeed, target: '@expired', accountId: expired.id })
    await h.start()
    await h.elapse(MINUTE_MS)
    expect(h.monitor.calls).toEqual([])
  })

  it('starts a channel of any site too, once it is due: the AI watches whatever the app cannot read (DEC-045)', async () => {
    const h = makeHarness()
    const forum = h.channel({ ...watchedSeed, platform: 'web', target: 'https://forum.example.com/c/astrology' })
    await h.start()
    await h.elapse(10 * MINUTE_MS)
    expect(h.monitor.calls).toContain(forum.id)
  })

  it('tries a look that could not start again at the time the monitor chose, not at the regular interval, and counts no failure', async () => {
    const h = makeHarness()
    const channel = h.channel({ ...watchedSeed })
    const retryAt = new Date(h.clock.now().getTime() + 5 * MINUTE_MS).toISOString()
    h.monitor.outcome = { status: 'skipped', summary: 'The channel was not looked at: another task is working in this account.', newOpportunities: 0, retryAt }

    await h.start()

    expect(h.core.repos.channel(channel.id)).toMatchObject({ status: 'active', nextCheckAt: retryAt })
    expect(h.automation.store.get(channel.id).consecutiveFailures).toBe(0)
    expect(monitorRuns(h)[0]).toMatchObject({ status: 'skipped' })
    // and it is looked at again then, not before
    await h.elapse(4 * MINUTE_MS)
    expect(h.monitor.calls).toHaveLength(1)
    h.monitor.outcome = { status: 'ok', summary: 'Watched in the browser: 0 noted, 0 judged not relevant, 0 already known', newOpportunities: 0 }
    await h.elapse(2 * MINUTE_MS)
    expect(h.monitor.calls).toHaveLength(2)
  })

  it('keeps the regular interval for a skipped cycle that asked for no earlier retry', async () => {
    const h = makeHarness()
    const channel = h.channel({ ...watchedSeed })
    h.monitor.outcome = { status: 'skipped', summary: 'You stopped the AI.', newOpportunities: 0 }
    await h.start()
    expect(h.core.repos.channel(channel.id).nextCheckAt).toBe(new Date(h.clock.now().getTime() + 30 * MINUTE_MS).toISOString())
  })

  it('gives a look the time the AI has, not the ten minutes of a read, and times it out only after that', async () => {
    const h = makeHarness()
    const watched = h.channel({ ...watchedSeed })
    const gate = deferred<{ status: 'ok'; summary: string; newOpportunities: number }>()
    h.monitor.behaviors.set(watched.id, () => gate.promise)

    await h.start({ wait: false })
    h.timers.advance(15 * MINUTE_MS)
    await flush()
    expect(h.automation.state().activeRuns).toBe(1)
    expect(monitorRuns(h).filter((r) => r.status === 'failed')).toEqual([])

    // the AI's own limit and the margin for the bookkeeping around it pass: now it is a timeout
    h.timers.advance(WATCH_TIMEOUT_MS)
    await flush()
    expect(monitorRuns(h)[0]).toMatchObject({ status: 'failed', summary: expect.stringMatching(/^Timed out after 2[0-9] min/) })
    gate.resolve({ status: 'ok', summary: 'late', newOpportunities: 0 })
    await h.automation.idle()
  })

  it('still times out a read of an ordinary channel after ten minutes', async () => {
    const h = makeHarness()
    const read = h.channel({ target: 'r/slow' })
    const gate = deferred<{ status: 'ok'; summary: string; newOpportunities: number }>()
    h.monitor.behaviors.set(read.id, () => gate.promise)
    await h.start({ wait: false })
    h.timers.advance(11 * MINUTE_MS)
    await flush()
    expect(monitorRuns(h)[0]).toMatchObject({ status: 'failed', summary: 'Timed out after 10 min' })
    gate.resolve({ status: 'ok', summary: 'late', newOpportunities: 0 })
    await h.automation.idle()
  })

  it('puts it back on the schedule, with a next check, when the problem that suspended it is gone', async () => {
    const h = makeHarness()
    const account = seedAccount(h.core, { label: 'Expired', status: 'login_required' })
    const channel = h.channel({ ...watchedSeed, accountId: account.id })
    await h.start()
    await h.elapse(MINUTE_MS)
    expect(h.core.repos.channel(channel.id)).toMatchObject({ status: 'needs_user', nextCheckAt: null })

    h.core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(account.id)
    await h.elapse(30_000)

    // not parked as a channel for own posts: it is looked at again
    expect(h.core.repos.channel(channel.id)).toMatchObject({ status: 'active', statusDetail: '' })
    expect(h.monitor.calls).toContain(channel.id)
  })
})
