// How a send can be carried out, decided in one place: the approval's fit check, the gate's re-check at the send and the choice of the
// executor ask the same question, so what the owner is told can be sent is what is sent (DEC-031).

import { renderForPlatform, sendProblems, type SendWays } from '../../shared/post-format'
import type { Draft } from '../../shared/types'
import type { Core } from '../core'

export type Executor = 'connector' | 'ai_browser'

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

/**
 * Who carries a send, given how it can be carried (`sendWays`): the connector unless the AI browser may drive the send. With pictures the AI
 * browser carries only what the connector cannot: a post the connector can send (Reddit's picture by itself) keeps going through it, the way
 * that is known to work. Legacy drafts are judged by their connector, as before: it refuses what it cannot carry. One function for the send
 * (`executorFor`) and for the group view that tells the owner "will go by".
 */
export function chooseExecutor(ways: SendWays, draft: Pick<Draft, 'attachments' | 'markup' | 'title' | 'text' | 'link'>, platform: string): Executor {
  if (!ways.aiBrowser) return 'connector'
  if (draft.attachments.length > 0 && (draft.markup !== 'markdown' || sendProblems(platform, renderForPlatform(draft, platform), { aiBrowser: false }).length === 0)) return 'connector'
  return 'ai_browser'
}
