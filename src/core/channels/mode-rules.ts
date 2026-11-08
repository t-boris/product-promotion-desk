// Which channel modes a channel may use (REQ-003). Observing and drafting never send anything, so they are always
// allowed. Approval and automatic mode send, so they need a reply path that is not known to be impossible.

import { ApiError } from '../../shared/api'
import type { Channel, ChannelMode } from '../../shared/types'
import { find } from './capabilities'

export const MODES: readonly ChannelMode[] = ['observe', 'draft', 'approval', 'auto']

const SENDING_MODES: readonly ChannelMode[] = ['approval', 'auto']

/** The reply ability is known to be impossible (platform) or forbidden (rules). */
export function replyBlocked(channel: Pick<Channel, 'capabilities'>): string | null {
  const reply = find(channel.capabilities, 'publish_reply')
  if (reply?.status === 'unavailable' || reply?.status === 'restricted') {
    const why = reply.status === 'restricted' ? 'forbidden by the community rules' : 'not possible here'
    return `Replying is ${why}${reply.detail ? `: ${reply.detail}` : '.'}`
  }
  return null
}

export function assertModeAllowed(channel: Channel, mode: ChannelMode): void {
  if (!MODES.includes(mode)) throw new ApiError('invalid_input', `Unknown mode: ${String(mode)}.`)
  if (!SENDING_MODES.includes(mode)) return
  const blocked = replyBlocked(channel)
  if (blocked) throw new ApiError('mode_not_allowed', `${mode === 'auto' ? 'Automatic' : 'Approval'} mode is not available for ${channel.target}. ${blocked}`)
  if (mode === 'auto' && channel.settings.autoCategories.length === 0) {
    throw new ApiError('mode_not_allowed', 'Choose at least one category for automatic replies (thanks or faq) before switching to automatic mode.')
  }
}

/** A re-assessment can reveal that replying became impossible: the channel then falls back to drafting only. */
export function modeAfterAssessment(channel: Pick<Channel, 'mode' | 'capabilities'>): { mode: ChannelMode; reason: string | null } {
  if (!SENDING_MODES.includes(channel.mode)) return { mode: channel.mode, reason: null }
  const blocked = replyBlocked(channel)
  return blocked ? { mode: 'draft', reason: blocked } : { mode: channel.mode, reason: null }
}
