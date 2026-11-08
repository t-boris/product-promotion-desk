// Which channels may be worked on right now (REQ-005: permissions are re-checked, nothing is retried blindly).

import type { Account, CapabilityKey, Channel, Id } from '../../shared/types'
import type { Core } from '../core'
import type { ScheduleStore } from './scheduler-state'

/**
 * Channels the scheduler works on. 'error' is included on purpose: the monitor marks a channel 'error' after a
 * failed read (connection loss, a changed page), and it must keep being retried with backoff rather than stay
 * stopped forever. A successful cycle puts it back to 'active'. Login, CAPTCHA and restricted capabilities are
 * different: those move the channel to needs_user and it is not retried until the problem is gone.
 */
const RUNNABLE: Channel['status'][] = ['active', 'error']

/** Capabilities without which a channel cannot be observed at all. */
const MONITORING_CAPABILITIES: CapabilityKey[] = ['read_posts', 'read_comments', 'detect_changes']

/** Why a channel must not be scheduled, or null when it may run. Purely derived from stored state. */
export function permissionProblem(channel: Channel, account: Account | undefined): string | null {
  if (!account) return 'The account for this channel no longer exists'
  switch (account.status) {
    case 'login_required':
      return `Account "${account.label}" needs you to sign in again`
    case 'captcha':
      return `Account "${account.label}" shows a CAPTCHA that needs you`
    case 'suspended':
      return `Account "${account.label}" is suspended by the platform`
    case 'ready':
      break
  }
  const required: CapabilityKey[] = channel.mode === 'auto' ? [...MONITORING_CAPABILITIES, 'publish_reply'] : MONITORING_CAPABILITIES
  const restricted = channel.capabilities.find((c) => c.status === 'restricted' && required.includes(c.key))
  if (restricted) return `The platform restricts "${restricted.key}" for this channel; review its rules before resuming`
  return null
}

export interface ReviewResult {
  suspended: Id[]
  restored: Id[]
}

/**
 * Re-evaluates every channel against its account and capabilities. Runnable channels with a problem become
 * needs_user (and are flagged for automatic resumption); channels the scheduler suspended earlier resume
 * automatically once the problem is gone. Channels the user paused or never activated are left alone.
 */
export function reviewChannels(core: Core, store: ScheduleStore, nowMs: number): ReviewResult {
  const result: ReviewResult = { suspended: [], restored: [] }
  const accounts = new Map(core.repos.listAccounts().map((a) => [a.id, a]))
  for (const channel of core.repos.listChannels()) {
    const problem = permissionProblem(channel, accounts.get(channel.accountId))
    if (RUNNABLE.includes(channel.status) && problem) {
      store.suspend(channel.id, problem, true)
      core.log.warn('scheduler', `Channel ${channel.target} suspended: ${problem}`, channel.id)
      result.suspended.push(channel.id)
    } else if (channel.status === 'needs_user' && !problem && store.get(channel.id).autoResume) {
      store.restore(channel.id, new Date(nowMs).toISOString())
      core.log.info('scheduler', `Channel ${channel.target} resumed: the problem that suspended it is gone`, channel.id)
      result.restored.push(channel.id)
    }
  }
  if (result.suspended.length > 0 || result.restored.length > 0) core.events.changed('channels')
  return result
}

/** Runnable channels that pass the permission check, i.e. the ones the scheduler may run. */
export function schedulableChannels(core: Core): Channel[] {
  const accounts = new Map(core.repos.listAccounts().map((a) => [a.id, a]))
  return core.repos.listChannels().filter((c) => RUNNABLE.includes(c.status) && permissionProblem(c, accounts.get(c.accountId)) === null)
}
