import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AutomationState } from '../../shared/types'
import { describeTray } from './lifecycle-status'
import { SHUTDOWN_KEY } from './lifecycle-recovery'
import { deferred, flush } from './scheduler-fakes'
import { makeHarness, TEST_SCHEDULER } from './scheduler-harness'
import { seedAccount, seedOpportunity, seedSend } from './scheduler-seed'
import { getAutomation, startAutomation } from './lifecycle'
import { makeTestCore } from '../testing/fakes'
import { ManualTimers } from './scheduler-fakes'
import { MINUTE_MS } from './scheduler-timing'

const marker = (h: ReturnType<typeof makeHarness>) => h.core.settings.getRaw<{ at: string; clean: boolean; activeRuns: number; interrupted?: number } | null>(SHUTDOWN_KEY, null)

describe('Startup sequence after a manual launch (DEC-003, REQ-005)', () => {
  it('closes interrupted runs and reports an unclean previous shutdown', async () => {
    const h = makeHarness()
    h.core.settings.setRaw(SHUTDOWN_KEY, { at: '2026-11-08T09:00:00.000Z', clean: false, activeRuns: 0 })
    h.core.db.prepare("INSERT INTO runs (id, kind, status, started_at) VALUES ('stale', 'monitor', 'running', '2026-11-08T09:00:00.000Z')").run()

    const automation = await h.start()

    expect(automation.recovery).toMatchObject({ uncleanShutdown: true, interruptedRuns: 1 })
    const stale = h.core.runs.list({ limit: 20 }).find((r) => r.id === 'stale')
    expect(stale).toMatchObject({ status: 'failed', summary: 'Interrupted by application stop' })
    expect(h.core.log.list(50, 'warn').some((l) => l.message.includes('did not shut down cleanly'))).toBe(true)
    // While running, the marker says "not shut down yet", so a crash is detectable next time.
    expect(marker(h)).toMatchObject({ clean: false })
  })

  it('does not report an unclean shutdown on the very first launch or after an orderly Quit', async () => {
    const first = makeHarness()
    expect((await first.start()).recovery?.uncleanShutdown).toBe(false)

    const again = makeHarness()
    again.core.settings.setRaw(SHUTDOWN_KEY, { at: '2026-11-08T09:00:00.000Z', clean: true, activeRuns: 0 })
    expect((await again.start()).recovery?.uncleanShutdown).toBe(false)
  })

  it('re-checks permissions first: nothing is scheduled for accounts that need a login or restricted capabilities', async () => {
    const h = makeHarness()
    const expired = seedAccount(h.core, { label: 'Expired', status: 'login_required' })
    const captcha = seedAccount(h.core, { label: 'Captcha', status: 'captcha' })
    const needsLogin = h.channel({ target: 'r/login', accountId: expired.id })
    const needsCaptcha = h.channel({ target: 'r/captcha', accountId: captcha.id })
    const restricted = h.channel({ target: 'r/restricted', capabilities: [{ key: 'read_comments', status: 'restricted', detail: 'no bots', checkedAt: null }] })
    const healthy = h.channel({ target: 'r/healthy' })

    const automation = await h.start()
    await h.elapse(MINUTE_MS)

    for (const channel of [needsLogin, needsCaptcha, restricted]) {
      const after = h.core.repos.channel(channel.id)
      expect(after.status).toBe('needs_user')
      expect(after.statusDetail.length).toBeGreaterThan(0)
      expect(h.monitor.calls).not.toContain(channel.id)
    }
    expect(h.core.repos.channel(needsLogin.id).statusDetail).toContain('sign in')
    expect(h.core.repos.channel(restricted.id).statusDetail).toContain('read_comments')
    expect(h.monitor.calls).toContain(healthy.id)
    expect(automation.recovery?.suspendedChannels.sort()).toEqual([needsLogin.id, needsCaptcha.id, restricted.id].sort())
  })

  it('reconciles uncertain sends before any scheduled work starts, and never starts work while that is pending', async () => {
    const h = makeHarness()
    h.channel()
    const opportunityId = seedOpportunity(h.core, h.core.repos.listChannels()[0].id, { state: 'unknown_result' })
    seedSend(h.core, { opportunityId, accountId: h.account.id, state: 'unknown', completedAt: null })
    const gate = deferred<void>()
    h.sending.reconcileGate = gate.promise

    const starting = h.start({ wait: false })
    await flush()
    // Reconciliation is running; the scheduler has not started: no tick timer, no monitoring, no scheduled sends.
    expect(h.log).toEqual(['reconcile'])
    expect(h.timers.pending).toBe(0)
    expect(h.sending.sendDueCalls).toBe(0)

    gate.resolve()
    await starting
    await h.automation.idle()
    expect(h.log[0]).toBe('reconcile')
    expect(h.log.indexOf('reconcile')).toBeLessThan(h.log.findIndex((l) => l.startsWith('monitor')))
    expect(h.log.indexOf('reconcile')).toBeLessThan(h.log.indexOf('sendDue'))
    const recorded = h.core.runs.list({ limit: 10 }).find((r) => r.kind === 'reconcile')
    expect(recorded).toMatchObject({ status: 'ok' })
    expect(recorded?.summary).toContain('uncertain sends')
  })

  it('keeps scheduled work blocked while reconciliation keeps failing, then proceeds once it succeeds', async () => {
    const h = makeHarness()
    h.channel()
    h.sending.reconcileFailure = new Error('platform unreachable')

    await h.start()
    await h.elapse(20_000)
    expect(h.monitor.calls).toEqual([])
    expect(h.sending.sendDueCalls).toBe(0)
    expect(h.core.runs.list({ limit: 10 }).find((r) => r.kind === 'reconcile')).toMatchObject({ status: 'failed' })

    h.sending.reconcileFailure = null
    await h.elapse(30_000)
    await h.elapse(15_000)
    expect(h.monitor.calls).toHaveLength(1)
    expect(h.sending.sendDueCalls).toBeGreaterThan(0)
  })

  it('resumes a channel it suspended once the account is ready again, without being asked', async () => {
    const h = makeHarness()
    const account = seedAccount(h.core, { label: 'Expired', status: 'login_required' })
    const channel = h.channel({ accountId: account.id })
    await h.start()
    await h.elapse(MINUTE_MS)
    expect(h.core.repos.channel(channel.id).status).toBe('needs_user')
    expect(h.monitor.calls).toEqual([])

    // The user signs in again; the account check marks it ready.
    h.core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(account.id)
    await h.elapse(30_000)

    expect(h.core.repos.channel(channel.id).status).toBe('active')
    expect(h.monitor.calls).toContain(channel.id)
  })

  it('does not auto-resume a channel that a person must look at for another reason', async () => {
    const h = makeHarness()
    const channel = h.channel({ status: 'needs_user', statusDetail: 'Site structure changed' })
    await h.start()
    await h.elapse(10 * MINUTE_MS)
    expect(h.core.repos.channel(channel.id).status).toBe('needs_user')
    expect(h.monitor.calls).toEqual([])
  })
})

describe('Shutdown and Quit (DEC-003)', () => {
  it('stops ticking, waits for running work, and records a clean shutdown with progress', async () => {
    const h = makeHarness()
    const channel = h.channel()
    const gate = deferred<{ status: 'ok'; summary: string; newOpportunities: number }>()
    h.monitor.behaviors.set(channel.id, () => gate.promise)
    const automation = await h.start({ wait: false })
    expect(automation.state().activeRuns).toBe(1)

    const stopping = automation.stop()
    gate.resolve({ status: 'ok', summary: '2 new comments', newOpportunities: 2 })
    await stopping

    expect(h.timers.pending).toBe(0)
    expect(marker(h)).toMatchObject({ clean: true, activeRuns: 1, interrupted: 0 })
    expect(h.core.runs.list({ limit: 10 }).find((r) => r.kind === 'monitor')).toMatchObject({ status: 'ok', summary: '2 new comments' })
    expect(automation.state().running).toBe(false)
  })

  it('closes runs that outlive the grace period as interrupted and still records the shutdown', async () => {
    const h = makeHarness()
    const channel = h.channel()
    h.monitor.behaviors.set(channel.id, () => new Promise(() => undefined))
    const automation = await h.start({ wait: false })

    const stopping = automation.stop()
    h.timers.advance(200)
    await stopping

    expect(marker(h)).toMatchObject({ clean: true, activeRuns: 1, interrupted: 1 })
    expect(h.core.runs.list({ limit: 10 }).find((r) => r.kind === 'monitor')).toMatchObject({ status: 'failed', summary: 'Interrupted by application stop' })
    // The interrupted cycle never reached a verdict, so the channel is still due and the next launch picks it up.
    expect(Date.parse(h.core.repos.channel(channel.id).nextCheckAt!)).toBeLessThanOrEqual(h.clock.now().getTime())
  })

  it('is wired into core.shutdown so Quit stops all automation', async () => {
    const h = makeHarness()
    h.channel()
    await h.start()
    expect(h.timers.pending).toBeGreaterThan(0)

    await h.core.shutdown()

    expect(h.timers.pending).toBe(0)
    h.timers.advance(10 * MINUTE_MS)
    expect(h.monitor.calls).toHaveLength(1)
  })

  it('never configures start-at-login: after a restart the user launches the app (DEC-003)', () => {
    const dir = join(__dirname, '../../main')
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n')
    const code = sources.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/setLoginItemSettings|openAtLogin/)
  })
})

describe('Persistence across restarts (REQ-005)', () => {
  it('keeps the pause flag and the failure streak when the application is relaunched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ppd-restart-'))
    const dbPath = join(dir, 'ppd.sqlite')

    const first = makeHarness({ dbPath })
    const channel = first.channel()
    first.monitor.behaviors.set(channel.id, async () => {
      throw new Error('offline')
    })
    await first.start()
    first.automation.setPaused(true)
    expect(first.automation.store.get(channel.id).consecutiveFailures).toBe(1)
    await first.core.shutdown()

    // Same database file, new process.
    const second = makeTestCore({ dbPath })
    const timers = new ManualTimers(second.clock)
    const relaunched = await startAutomation(second.core, { scheduler: { ...TEST_SCHEDULER, timers } })
    expect(relaunched.state().paused).toBe(true)
    expect(relaunched.recovery?.uncleanShutdown).toBe(false)
    expect(relaunched.store.get(channel.id).consecutiveFailures).toBe(1)
    expect(second.core.repos.channel(channel.id).nextCheckAt).not.toBeNull()
    await second.core.shutdown()
  })
})

describe('automation state API', () => {
  it('reports running, active runs, tick times and the background flag', async () => {
    const h = makeHarness()
    const channel = h.channel({ nextCheckAt: new Date(h.clock.now().getTime() + 20 * MINUTE_MS).toISOString() })
    expect(await h.core.router.call('automation.get', undefined)).toMatchObject({ running: false, paused: false, activeRuns: 0, lastTickAt: null })

    await h.start()
    h.core.background = true
    const state = await h.core.router.call('automation.get', undefined)
    expect(state).toMatchObject({ running: true, paused: false, background: true, lastTickAt: h.clock.now().toISOString() })
    expect(state.nextDueAt).toBe(h.core.repos.channel(channel.id).nextCheckAt)
  })

  it('is reachable through the same instance before and after start', () => {
    const { core } = makeTestCore()
    expect(getAutomation(core)).toBe(getAutomation(core))
  })
})

describe('Menu-bar status (REQ-005: status and pause stay reachable with every window closed)', () => {
  const base: AutomationState = { paused: false, running: true, activeRuns: 0, lastTickAt: null, nextDueAt: null, background: true }

  it('shows running, active runs, paused and attention items', () => {
    expect(describeTray(base, 0)).toMatchObject({ statusLine: 'Automation running', pauseLabel: 'Pause automation', attentionLine: null, title: 'PPD' })
    expect(describeTray({ ...base, activeRuns: 2 }, 0).statusLine).toBe('Automation running (2 active)')
    expect(describeTray({ ...base, paused: true }, 0)).toMatchObject({ statusLine: 'Automation paused', pauseLabel: 'Resume automation', title: 'PPD (paused)' })
    expect(describeTray(base, 1)).toMatchObject({ attentionLine: '1 item needs attention', title: 'PPD · 1' })
    expect(describeTray(base, 3).attentionLine).toBe('3 items need attention')
  })

  it('always offers opening the app and an explicit Quit', () => {
    const model = describeTray({ ...base, running: false }, 0)
    expect(model.openLabel).toBe('Open Promotion Desk')
    expect(model.quitLabel).toBe('Quit Promotion Desk')
    expect(model.statusLine).toBe('Automation starting')
  })
})
