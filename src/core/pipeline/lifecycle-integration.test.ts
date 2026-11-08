// The scheduler and the startup sequence against the REAL monitor, drafting and sending services (not fakes),
// to prove that the contracts line up: recovery, reconciliation before scheduling, retry after a read error.

import { afterEach, describe, expect, it } from 'vitest'
import { startAutomation } from './lifecycle'
import { ManualTimers } from './scheduler-fakes'
import { TEST_SCHEDULER } from './scheduler-harness'
import { MINUTE_MS } from './scheduler-timing'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World | null = null
afterEach(async () => {
  if (world) await closeWorld(world)
  world = null
})

const monitorRuns = (w: World) => w.core.runs.list({ limit: 100 }).filter((r) => r.kind === 'monitor')

describe('Lifecycle with the real pipeline services', () => {
  it('reconciles a send interrupted by a crash before any scheduled work, and never publishes it a second time', async () => {
    const w = (world = makeWorld())
    const opp = await w.readyReply()
    w.connector.publishScript.push({ kind: 'unknown', visible: true })
    const first = await w.sending.send(opp.id)
    expect(first.state).toBe('unknown')
    expect(w.connector.published).toHaveLength(1)
    // The process died while the attempt was still marked in flight.
    w.core.db.prepare("UPDATE send_actions SET state = 'sending', error = NULL WHERE id = ?").run(first.id)
    w.core.db.prepare("UPDATE opportunities SET state = 'sending' WHERE id = ?").run(opp.id)

    const timers = new ManualTimers(w.clock)
    const automation = await startAutomation(w.core, { scheduler: { ...TEST_SCHEDULER, timers } })
    await automation.idle()

    expect(w.core.repos.action(first.id).state).toBe('confirmed')
    expect(w.core.repos.opportunity(opp.id).state).toBe('confirmed')
    expect(w.connector.published).toHaveLength(1)
    const reconcile = w.core.runs.list({ limit: 50 }).find((r) => r.kind === 'reconcile')
    expect(reconcile).toBeDefined()
  })

  it('keeps retrying a channel the monitor marked "error" after a connection loss, and recovers by itself', async () => {
    const w = (world = makeWorld())
    const timers = new ManualTimers(w.clock)
    w.connector.fetchActivityError = new Error('net::ERR_INTERNET_DISCONNECTED')
    const automation = await startAutomation(w.core, { scheduler: { ...TEST_SCHEDULER, timers } })
    await automation.idle()

    const failed = w.refresh()
    expect(failed.status).toBe('error')
    expect(failed.statusDetail).toContain('net::ERR_INTERNET_DISCONNECTED')
    expect(Date.parse(failed.nextCheckAt!) - w.clock.now().getTime()).toBe(MINUTE_MS)

    // Still offline for the next attempts: the pauses grow.
    for (const expectedMinutes of [2, 4]) {
      timers.advance(Date.parse(w.refresh().nextCheckAt!) - w.clock.now().getTime())
      await automation.idle()
      expect(Date.parse(w.refresh().nextCheckAt!) - w.clock.now().getTime()).toBe(expectedMinutes * MINUTE_MS)
    }
    expect(monitorRuns(w).filter((r) => r.status === 'failed').length).toBeGreaterThanOrEqual(3)

    // The connection is back.
    w.connector.fetchActivityError = null
    timers.advance(Date.parse(w.refresh().nextCheckAt!) - w.clock.now().getTime())
    await automation.idle()

    const healthy = w.refresh()
    expect(healthy.status).toBe('active')
    expect(healthy.statusDetail).toBe('')
    expect(healthy.lastSuccessAt).not.toBeNull()
    expect(automation.store.get(w.channel.id).consecutiveFailures).toBe(0)
  })

  it('suspends work for an expired login, resumes it after the user signs in, and never touches other channels', async () => {
    const w = (world = makeWorld())
    const expired = w.addAccount({ label: 'Expired', status: 'login_required' })
    const stuck = w.addChannel({ accountId: expired.id, target: 'r/stuck' })
    const timers = new ManualTimers(w.clock)
    const automation = await startAutomation(w.core, { scheduler: { ...TEST_SCHEDULER, timers } })
    await automation.idle()

    expect(w.refresh(stuck).status).toBe('needs_user')
    expect(w.refresh(w.channel).status).toBe('active')
    expect(w.refresh(w.channel).lastSuccessAt).not.toBeNull()
    expect(w.refresh(stuck).lastRunAt).toBeNull()
    expect((await w.core.router.call('attention.list', undefined)).some((i) => i.kind === 'login')).toBe(true)

    w.core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(expired.id)
    timers.advance(30_000)
    await automation.idle()

    expect(w.refresh(stuck).status).toBe('active')
    expect(w.refresh(stuck).lastSuccessAt).not.toBeNull()
  })

  it('notices at launch that a session expired while the app was closed, before the first cycle, using the real sign-in check', async () => {
    const w = (world = makeWorld())
    // Stored state still says "ready"; the platform no longer agrees.
    w.connector.login = { loggedIn: false, identity: null, captcha: false }
    const timers = new ManualTimers(w.clock)
    const automation = await startAutomation(w.core, { scheduler: { ...TEST_SCHEDULER, timers } })
    await automation.idle()

    expect(w.core.repos.account(w.account.id).status).toBe('login_required')
    expect(w.refresh().status).toBe('needs_user')
    expect(w.connector.calls).toContain('checkLogin')
    expect(w.connector.calls).not.toContain('fetchActivity')
    expect(automation.recovery?.signIns.notReady).toEqual([w.account.id])
    expect((await w.core.router.call('attention.list', undefined)).some((i) => i.kind === 'login')).toBe(true)
  })

  it('checks the sign-in first and then runs normally when the session is still valid', async () => {
    const w = (world = makeWorld())
    const timers = new ManualTimers(w.clock)
    const automation = await startAutomation(w.core, { scheduler: { ...TEST_SCHEDULER, timers } })
    await automation.idle()

    expect(w.connector.calls[0]).toBe('checkLogin')
    expect(w.connector.calls).toContain('fetchActivity')
    expect(w.refresh().status).toBe('active')
    expect(automation.recovery?.signIns).toMatchObject({ notReady: [], failed: 0, timedOut: false })
    expect(automation.recovery?.signIns.checked).toEqual([w.account.id])
  })

  it('records a normal cycle for a new comment as one run with a short result', async () => {
    const w = (world = makeWorld())
    w.connector.addDiscussion({ externalId: 'd1' })
    w.connector.addComment('d1', { externalId: 't1_a', body: 'How does the natal chart work?' })
    const timers = new ManualTimers(w.clock)
    const automation = await startAutomation(w.core, { scheduler: { ...TEST_SCHEDULER, timers } })
    await automation.idle()

    const [run] = monitorRuns(w)
    expect(run.channelId).toBe(w.channel.id)
    expect(run.finishedAt).not.toBeNull()
    expect(run.summary.length).toBeGreaterThan(0)
    expect(automation.state().running).toBe(true)
  })
})
