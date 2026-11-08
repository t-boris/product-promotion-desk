// REQ-005: after a manual launch the sign-in of every account that can send is re-checked live, bounded in time,
// before anything is scheduled. The router handler is faked here; the real one is covered in the integration test.

import { describe, expect, it, vi } from 'vitest'
import type { ApiMethod } from '../../shared/api'
import type { AccountStatus, Account } from '../../shared/types'
import { SIGN_IN_RECHECK_BUDGET_MS } from './lifecycle-recovery'
import { deferred, flush } from './scheduler-fakes'
import { makeHarness, type Harness } from './scheduler-harness'
import { seedAccount } from './scheduler-seed'

type Answer = AccountStatus | Promise<AccountStatus>

/** Replaces `accounts.checkLogin` with a scripted handler that stores its answer like the real one does. */
function fakeCheckLogin(h: Harness, answer: (account: Account) => Answer): string[] {
  const calls: string[] = []
  const original = h.core.router.call.bind(h.core.router)
  vi.spyOn(h.core.router, 'call').mockImplementation((async (method: ApiMethod, args: unknown) => {
    if (method !== 'accounts.checkLogin') return original(method, args as never)
    const account = h.core.repos.account((args as { accountId: string }).accountId)
    calls.push(account.label)
    h.log.push(`checkLogin:${account.label}`)
    const status = await answer(account)
    h.core.db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, account.id)
    return h.core.repos.account(account.id)
  }) as unknown as typeof h.core.router.call)
  return calls
}

const logMessages = async (h: Harness) => (await h.core.router.call('logs.list', { limit: 200 })).map((e) => e.message)

describe('Live sign-in re-check at startup (REQ-005)', () => {
  it('checks only accounts that have a sending channel, one at a time, after the stored-state check and before any scheduled work', async () => {
    const h = makeHarness()
    const second = seedAccount(h.core, { label: 'Second' })
    const observeOnly = seedAccount(h.core, { label: 'ObserveOnly' })
    seedAccount(h.core, { label: 'NoChannels' })
    const parked = seedAccount(h.core, { label: 'Parked' })
    const alreadyExpired = seedAccount(h.core, { label: 'AlreadyExpired', status: 'login_required' })
    h.channel({ target: 'r/first', mode: 'approval' })
    h.channel({ target: 'r/second', accountId: second.id, mode: 'auto' })
    h.channel({ target: 'r/observe', accountId: observeOnly.id, mode: 'observe' })
    h.channel({ target: 'r/draft', accountId: observeOnly.id, mode: 'draft' })
    h.channel({ target: 'r/parked', accountId: parked.id, mode: 'approval', status: 'needs_user' })
    h.channel({ target: 'r/expired', accountId: alreadyExpired.id, mode: 'approval' })

    const gate = deferred<void>()
    const calls = fakeCheckLogin(h, async (account): Promise<AccountStatus> => {
      if (account.label === 'Main') await gate.promise
      return 'ready'
    })

    const started = h.start({ wait: false })
    await flush()
    // Sequential: the second account waits for the first one's answer, and nothing is scheduled meanwhile.
    expect(calls).toEqual(['Main'])
    expect(h.monitor.calls).toEqual([])
    gate.resolve()
    await started
    await h.automation.idle()

    expect(calls).toEqual(['Main', 'Second'])
    const firstWork = h.log.findIndex((entry) => !entry.startsWith('checkLogin:'))
    expect(h.log.slice(0, firstWork)).toEqual(['checkLogin:Main', 'checkLogin:Second'])
    expect(h.automation.recovery?.signIns).toMatchObject({ failed: 0, timedOut: false, notReady: [] })
    expect(h.automation.recovery?.signIns.checked).toHaveLength(2)
  })

  it('does not run at all when no channel can send', async () => {
    const h = makeHarness()
    h.channel({ mode: 'observe' })
    h.channel({ mode: 'draft' })
    const calls = fakeCheckLogin(h, () => 'ready')

    await h.start()

    expect(calls).toEqual([])
    expect(h.automation.recovery?.signIns).toEqual({ checked: [], notReady: [], failed: 0, timedOut: false })
  })

  it('keeps the channels of an account that is no longer signed in out of scheduling, and leaves the others running', async () => {
    const h = makeHarness()
    const lapsed = seedAccount(h.core, { label: 'Lapsed' })
    const stuck = h.channel({ target: 'r/lapsed', accountId: lapsed.id, mode: 'auto' })
    const fine = h.channel({ target: 'r/fine', mode: 'approval' })
    fakeCheckLogin(h, (account) => (account.label === 'Lapsed' ? 'login_required' : 'ready'))

    await h.start()
    await h.elapse(60_000)

    const after = h.core.repos.channel(stuck.id)
    expect(after.status).toBe('needs_user')
    expect(after.statusDetail).toContain('Lapsed')
    expect(after.statusDetail).toContain('sign in')
    expect(h.monitor.calls).not.toContain(stuck.id)
    expect(h.monitor.calls).toContain(fine.id)
    expect(h.automation.recovery?.signIns.notReady).toEqual([lapsed.id])
    expect(h.automation.recovery?.suspendedChannels).toContain(stuck.id)
    expect((await h.core.router.call('attention.list', undefined)).some((item) => item.id === `login:${lapsed.id}`)).toBe(true)
  })

  it('treats a CAPTCHA answer the same way', async () => {
    const h = makeHarness()
    const channel = h.channel({ mode: 'approval' })
    fakeCheckLogin(h, () => 'captcha')

    await h.start()

    expect(h.core.repos.channel(channel.id).status).toBe('needs_user')
    expect(h.monitor.calls).not.toContain(channel.id)
  })

  it('logs a failing check, never throws, and keeps the stored state for that account', async () => {
    const h = makeHarness()
    const other = seedAccount(h.core, { label: 'Other' })
    const channel = h.channel({ mode: 'approval' })
    h.channel({ target: 'r/other', accountId: other.id, mode: 'auto' })
    const calls = fakeCheckLogin(h, (account) => {
      if (account.label === 'Main') throw new Error('browser is busy with a manual session')
      return 'ready'
    })

    await expect(h.start()).resolves.toBeDefined()

    // The failure of one account does not stop the next one, nor the application.
    expect(calls).toEqual(['Main', 'Other'])
    expect(h.automation.recovery?.signIns).toMatchObject({ failed: 1, timedOut: false })
    expect(h.automation.recovery?.signIns.checked).toHaveLength(1)
    expect(h.core.repos.channel(channel.id).status).toBe('active')
    expect(h.monitor.calls).toContain(channel.id)
    expect(h.automation.state().running).toBe(true)
    expect(await logMessages(h)).toContainEqual(expect.stringContaining('Could not re-check the sign-in of "Main" at startup: browser is busy with a manual session'))
  })

  it('stops waiting after the time budget and starts scheduling, without checking the remaining accounts', async () => {
    const h = makeHarness()
    const second = seedAccount(h.core, { label: 'Second' })
    const hung = h.channel({ target: 'r/hung', mode: 'approval' })
    const next = h.channel({ target: 'r/next', accountId: second.id, mode: 'approval' })
    const never = deferred<AccountStatus>()
    const calls = fakeCheckLogin(h, (account) => (account.label === 'Main' ? never.promise : 'ready'))

    const started = h.start({ wait: false })
    await flush()
    expect(calls).toEqual(['Main'])
    h.timers.advance(SIGN_IN_RECHECK_BUDGET_MS - 1)
    await flush()
    expect(h.automation.state().running).toBe(false)
    h.timers.advance(1)
    await started
    await h.automation.idle()

    expect(h.automation.recovery?.signIns).toMatchObject({ timedOut: true, checked: [], failed: 0 })
    expect(h.automation.state().running).toBe(true)
    expect(h.monitor.calls).toEqual(expect.arrayContaining([hung.id, next.id]))
    expect(calls).toEqual(['Main'])
    expect(await logMessages(h)).toContainEqual(expect.stringContaining('did not finish within 20 s'))

    // The abandoned check answering much later changes nothing in the report and does not break the loop.
    never.resolve('ready')
    await flush()
    expect(h.automation.recovery?.signIns.checked).toEqual([])
    expect(calls).toEqual(['Main'])
  })

  it('keeps the whole step bounded: a Quit during the check ends it without scheduling anything', async () => {
    const h = makeHarness()
    const channel = h.channel({ mode: 'approval' })
    const never = deferred<AccountStatus>()
    fakeCheckLogin(h, () => never.promise)

    const started = h.start({ wait: false })
    await flush()
    const stopping = h.automation.stop()
    h.timers.advance(SIGN_IN_RECHECK_BUDGET_MS)
    await Promise.all([started, stopping])

    expect(h.monitor.calls).not.toContain(channel.id)
    expect(h.automation.state().running).toBe(false)
  })
})
