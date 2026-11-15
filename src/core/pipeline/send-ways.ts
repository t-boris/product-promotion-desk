// How a send can be carried out, decided in one place: the approval's fit check, the gate's re-check at the send and the choice of the
// executor ask the same question, so what the owner is told can be sent is what is sent (DEC-031).

import type { SendWays } from '../../shared/post-format'
import type { Core } from '../core'

/**
 * Whether the AI browser may carry a send. It does when the owner chose it in the settings, the build has it, and the send is the owner's own
 * press on an approval the owner gave themselves: a scheduled send, or one on an automatic approval, never drives a browser. Without `send`
 * (the approval, before anyone presses anything) the question is whether it could, if the owner presses Send.
 */
export function sendWays(core: Core, send?: { automatic: boolean; approvedBy: string }): SendWays {
  const chosen = core.settings.app().publishWith === 'ai_browser' && core.services.postMissions !== undefined
  if (!chosen) return { aiBrowser: false }
  if (send && (send.automatic || send.approvedBy !== 'user')) return { aiBrowser: false, unattended: true }
  return { aiBrowser: true }
}
