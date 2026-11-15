// Where the owner is in setting up the channels of one product. Pure, so it is tested without the interface, and it imports no
// component (a test under tsconfig.node.json cannot follow an import of a .tsx file).

import type { Channel } from '../../../../shared/types'

/**
 * The one step the Channels screen asks for next (visual-system.md §10.2). The filled button of the screen is the button of this step;
 * every other button is a bezel. `choose` and `running` have no filled button: the owner picks a channel, or nothing is waiting.
 */
export type SetupStage = 'account' | 'connect' | 'choose' | 'assess' | 'activate' | 'running'

/** A channel whose abilities were never checked: assessing it is what the owner does first. */
export function neverAssessed(channel: Channel): boolean {
  return channel.capabilities.every((c) => c.checkedAt === null)
}

/** A channel that is still to be started: in setup, or one that needed the owner before its baseline was read. */
export function canActivate(channel: Channel): boolean {
  return channel.status === 'setup' || ((channel.status === 'needs_user' || channel.status === 'error') && channel.baselineDoneAt === null)
}

/**
 * Why "Activate" is off, or null when it can be pressed: a channel that is still to be started is assessed first (activating reads
 * the existing discussions as a baseline). The button's `disabled` and the sentence beside it both come from this one result.
 */
export function activateBlocker(channel: Channel): string | null {
  return canActivate(channel) && neverAssessed(channel) ? 'Assess the channel first to see what this account can do here. Then check the settings and activate it.' : null
}

export function canPause(channel: Channel): boolean {
  // A channel the app does not read never has a baseline: it was started once it left setup.
  return channel.status === 'active' || channel.status === 'error' || (channel.status === 'needs_user' && (channel.baselineDoneAt !== null || !channel.reads))
}

export interface StageFacts {
  /** The library has at least one account (any of them can serve any product). */
  hasAccount: boolean
  /** How many channels this product has. */
  channelCount: number
  /** The channel the owner works with: the one picked, or the only one. Undefined while several are listed and none is picked. */
  selected: Channel | undefined
}

export function setupStage({ hasAccount, channelCount, selected }: StageFacts): SetupStage {
  if (!hasAccount) return 'account'
  if (channelCount === 0) return 'connect'
  if (!selected) return 'choose'
  if (neverAssessed(selected)) return 'assess'
  if (canActivate(selected)) return 'activate'
  return 'running'
}
