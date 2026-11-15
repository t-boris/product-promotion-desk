// "Let the AI join" (DEC-029): the rules of the button on the channel card, in a module without components so they are tested on their
// own. The core decides what can really start (`agent.canStart`, `agent.start`); these rules only say whether the button is there, and why
// it is off, before the click.

import type { AgentReadiness, AgentRun, CapabilityStatus } from '../../../../shared/types'

export const JOIN_NOTE = 'Opens this community in the account’s browser and presses Join, nothing else. You can stop it any time. The app never joins on its own.'
export const JOIN_OWNER_HOLDS = 'Close the browser window first (Done) so the AI can work in it.'
export const JOIN_OTHER_RUN = 'The AI is working on this account. Join when it is done.'

/** The button's words: the channel's own name ("r/astrology"), as the channel card shows it. */
export function joinLabel(target: string): string {
  return `Let the AI join ${target.trim()}`
}

export interface JoinButton {
  /** The button is there: the platform can tell whether the account joined, and the account has not (yet). */
  show: boolean
  /** The button can be pressed. */
  enabled: boolean
  /** Why it is off, said beside it; null when it is on, or when the run panel already says what is going on. */
  reason: string | null
  /** This channel's own join run (going on, or how it ended) is shown under the button, instead of a reason. */
  runPanel: boolean
}

/** Whether the run of an account is the join of this channel. */
export function isJoinRunOf(run: AgentRun | null | undefined, channelId: string): run is AgentRun {
  return run?.kind === 'join' && run.channelId === channelId
}

export function joinButton(input: {
  platformCanJoin: boolean
  membershipStatus: CapabilityStatus | null | undefined
  readiness: AgentReadiness | null | undefined
  run: AgentRun | null | undefined
  channelId: string
  ownerHolds: boolean
}): JoinButton {
  const own = isJoinRunOf(input.run, input.channelId)
  // How the run ended stays on the screen after the button went (the channel is assessed again, and a member has nothing to join).
  const runPanel = input.platformCanJoin && own
  const show = input.platformCanJoin && input.membershipStatus !== 'verified'
  if (!show) return { show: false, enabled: false, reason: null, runPanel }
  if (input.run?.status === 'running') return { show, enabled: false, reason: own ? null : JOIN_OTHER_RUN, runPanel }
  if (input.ownerHolds) return { show, enabled: false, reason: JOIN_OWNER_HOLDS, runPanel }
  // Not loaded yet counts as on: the core refuses what cannot start, with its own sentence.
  if (input.readiness && !input.readiness.ready) return { show, enabled: false, reason: input.readiness.reason, runPanel }
  return { show, enabled: true, reason: null, runPanel }
}
