// Startup recovery (DEC-003, REQ-005). After a manual launch the application must not resume blindly:
// interrupted work is closed, permissions are re-checked, and uncertain sends are reconciled before any
// scheduled work starts. Sends that were in flight when the process ended are handled by the sending service
// (`reconcileAllUnknown` marks them unknown and asks the platform); the lifecycle guarantees that this happens
// before anything else is scheduled.

import type { Id } from '../../shared/types'
import type { Core } from '../core'
import { reviewChannels, sendingAccounts } from './scheduler-eligibility'
import type { ScheduleStore } from './scheduler-state'
import { raceTimeout, type Timers } from './scheduler-timing'

export const SHUTDOWN_KEY = 'lifecycle.shutdown'

/** Written at launch with clean=false and rewritten with clean=true by an orderly shutdown. */
export interface ShutdownMarker {
  at: string
  clean: boolean
  /** Runs that were in flight when the marker was written. */
  activeRuns: number
  /** Runs that did not finish within the shutdown grace period and were closed as interrupted. */
  interrupted?: number
}

/** Total time the startup sign-in re-check may take; whatever is left unchecked is simply not re-checked now. */
export const SIGN_IN_RECHECK_BUDGET_MS = 20_000

/** Outcome of the live sign-in re-check made after launch. */
export interface SignInRecheck {
  /** Accounts whose sign-in was actually checked. */
  checked: Id[]
  /** Checked accounts that came back not ready (login, CAPTCHA, suspended). */
  notReady: Id[]
  /** Checks that failed (offline, browser busy, no connector); the stored state is kept for those. */
  failed: number
  /** The time budget ran out before every account was checked. */
  timedOut: boolean
}

export interface RecoveryReport {
  /** The previous session ended without an orderly shutdown (crash, kill, power loss). */
  uncleanShutdown: boolean
  /** Run records left 'running' by the previous process. */
  interruptedRuns: number
  suspendedChannels: Id[]
  restoredChannels: Id[]
  signIns: SignInRecheck
}

export function recoverOnStart(core: Core, store: ScheduleStore): RecoveryReport {
  const nowIso = core.clock.now().toISOString()
  const interruptedRuns = core.runs.closeInterrupted()
  if (interruptedRuns > 0) core.events.changed('logs')

  const previous = core.settings.getRaw<ShutdownMarker | null>(SHUTDOWN_KEY, null)
  const uncleanShutdown = previous !== null && previous.clean !== true
  if (uncleanShutdown) {
    core.log.warn('lifecycle', `The previous session did not shut down cleanly (started ${previous.at}); recovering interrupted work`)
  }

  // Permissions first: nothing is resumed for an account that needs a login or a capability the platform restricts.
  const review = reviewChannels(core, store, core.clock.now().getTime())

  core.settings.setRaw(SHUTDOWN_KEY, { at: nowIso, clean: false, activeRuns: 0 } satisfies ShutdownMarker)
  core.log.info(
    'lifecycle',
    `Automation starting: ${interruptedRuns} interrupted run(s) closed, ${review.suspended.length} channel(s) need you, ${review.restored.length} resumed`
  )
  return {
    uncleanShutdown,
    interruptedRuns,
    suspendedChannels: review.suspended,
    restoredChannels: review.restored,
    signIns: { checked: [], notReady: [], failed: 0, timedOut: false }
  }
}

/**
 * REQ-005: after a manual launch the stored state is not enough, because a session may have expired while the
 * application was closed. Every account that has a channel able to send is asked, one at a time, whether it is
 * still signed in (the same `accounts.checkLogin` the interface uses), and channels are reviewed again with the
 * fresh answers so an account that is not ready keeps its channels out of scheduling (needs_user).
 *
 * It never blocks the application for long and never throws: the whole step has a time budget, a failing check
 * is logged and leaves the stored state as it was, and accounts that were not reached are left for the first
 * scheduled cycle, whose own login check catches a lapsed session anyway.
 */
export async function recheckSignIns(core: Core, store: ScheduleStore, report: RecoveryReport, timers: Timers, budgetMs = SIGN_IN_RECHECK_BUDGET_MS): Promise<RecoveryReport> {
  const result: SignInRecheck = { checked: [], notReady: [], failed: 0, timedOut: false }
  try {
    const accounts = sendingAccounts(core)
    if (accounts.length === 0) return report

    let expired = false
    const checkAll = async (): Promise<void> => {
      for (const account of accounts) {
        if (expired) return
        try {
          const fresh = await core.router.call('accounts.checkLogin', { accountId: account.id })
          if (expired) return
          result.checked.push(account.id)
          if (fresh.status !== 'ready') result.notReady.push(account.id)
        } catch (error) {
          if (expired) return
          result.failed += 1
          core.log.warn('lifecycle', `Could not re-check the sign-in of "${account.label}" at startup: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    await raceTimeout(checkAll(), budgetMs, timers, () => {
      expired = true
      result.timedOut = true
    })
    if (result.timedOut) core.log.warn('lifecycle', `The sign-in re-check did not finish within ${Math.round(budgetMs / 1000)} s; the remaining accounts are checked by their first cycle`)

    const review = reviewChannels(core, store, core.clock.now().getTime())
    core.log.info('lifecycle', `Sign-in re-check: ${result.checked.length} checked, ${result.notReady.length} need you, ${result.failed} could not be checked`)
    return {
      ...report,
      suspendedChannels: [...report.suspendedChannels, ...review.suspended],
      restoredChannels: [...report.restoredChannels, ...review.restored],
      signIns: { ...result }
    }
  } catch (error) {
    core.log.error('lifecycle', `The startup sign-in re-check failed: ${error instanceof Error ? error.message : String(error)}`)
    return report
  }
}
