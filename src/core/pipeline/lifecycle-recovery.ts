// Startup recovery (DEC-003, REQ-005). After a manual launch the application must not resume blindly:
// interrupted work is closed, permissions are re-checked, and uncertain sends are reconciled before any
// scheduled work starts. Sends that were in flight when the process ended are handled by the sending service
// (`reconcileAllUnknown` marks them unknown and asks the platform); the lifecycle guarantees that this happens
// before anything else is scheduled.

import type { Id } from '../../shared/types'
import type { Core } from '../core'
import { reviewChannels } from './scheduler-eligibility'
import type { ScheduleStore } from './scheduler-state'

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

export interface RecoveryReport {
  /** The previous session ended without an orderly shutdown (crash, kill, power loss). */
  uncleanShutdown: boolean
  /** Run records left 'running' by the previous process. */
  interruptedRuns: number
  suspendedChannels: Id[]
  restoredChannels: Id[]
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
  return { uncleanShutdown, interruptedRuns, suspendedChannels: review.suspended, restoredChannels: review.restored }
}
