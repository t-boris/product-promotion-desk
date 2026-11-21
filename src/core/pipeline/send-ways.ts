// How a send can be carried out, decided in one place: the approval's fit check, the gate's re-check at the send and the choice of the
// executor ask the same question, so what the owner is told can be sent is what is sent (DEC-031).

import { judgedForFit, renderForPlatform, sendProblems, type PostContent, type SendWays } from '../../shared/post-format'
import type { Channel } from '../../shared/types'
import type { Core } from '../core'
import { pictureFitProblems } from './picture-fit'

export type Executor = 'connector' | 'ai_browser'

/**
 * Whether the AI browser may carry a send. It does when the owner chose it in the settings, or the channel is one the application does not read
 * (Instagram, Facebook, Threads...: no connector can post to it, so there is nothing to choose, DEC-035), the build has it, and the send is the
 * owner's own press on an approval the owner gave themselves: a scheduled send, or one on an automatic approval, never drives a browser.
 * Without `send` (the approval, before anyone presses anything) the question is whether it could, if the owner presses Send. For a channel with
 * no connector the engine is asked too: Claude Code is the one that can be held to the browser tools alone, and the owner is told so at the approval.
 */
export function sendWays(core: Core, send?: { automatic: boolean; approvedBy: string }, channel?: Pick<Channel, 'reads'>): SendWays {
  const noConnector = channel !== undefined && !channel.reads
  const only = noConnector ? { noConnector: true } : {}
  const chosen = (noConnector || core.settings.app().publishWith === 'ai_browser') && core.services.postMissions !== undefined
  if (!chosen) return { aiBrowser: false, ...only }
  if (send && (send.automatic || send.approvedBy !== 'user')) return { aiBrowser: false, unattended: true, ...only }
  if (noConnector) {
    const engine = core.engines.selected()
    if (!engine) return { aiBrowser: false, noConnector: true, engineProblem: 'No AI engine is selected. The AI works the browser for this channel: choose Claude Code in Settings (AI engine), or use “Copy post” and publish it by hand.' }
    if (!engine.supportsAgent || !engine.confinesAgent) {
      return { aiBrowser: false, noConnector: true, engineProblem: `${engine.label} cannot be held to the browser tools alone, so it is not allowed to publish for you. The AI works the browser for this channel: choose Claude Code in Settings (AI engine), or use “Copy post” and publish it by hand.` }
    }
  }
  return { aiBrowser: true, ...only }
}

/**
 * Who carries a send, given how it can be carried (`sendWays`): the connector unless the AI browser may drive the send. With pictures the AI
 * browser carries only what the connector cannot: a post the connector can send (Reddit's picture by itself) keeps going through it, the way
 * that is known to work. Legacy drafts are judged by their connector, as before: it refuses what it cannot carry. One function for the send
 * (`executorFor`) and for the group view that tells the owner "will go by".
 */
export function chooseExecutor(ways: SendWays, draft: PostContent, platform: string): Executor {
  if (!ways.aiBrowser) return 'connector'
  // No connector can post to this channel: whatever the draft holds, the AI browser is the only way.
  if (ways.noConnector) return 'ai_browser'
  if (draft.attachments.length > 0 && (!judgedForFit(draft) || sendProblems(platform, renderForPlatform(draft, platform), { aiBrowser: false }).length === 0)) return 'connector'
  return 'ai_browser'
}

/**
 * Why a post that the application judges (`judgedForFit`: a post written in the post editor, a quick post) cannot be sent as it is, in words: what
 * the platform cannot take (limits, pictures, what the render says), what the way the application publishes cannot carry, and, for a quick post,
 * what the platform refuses about its one picture (type, size, shape). The approval, the gate and the group view ask this one function, so what the
 * owner is told fits is what the press accepts (lesson 209). Empty when nothing stops it.
 */
export function sendFitProblems(core: Core, draft: PostContent, platform: string, ways: SendWays): string[] {
  const problems = sendProblems(platform, renderForPlatform(draft, platform), ways)
  if (draft.postType === 'quick') problems.push(...pictureFitProblems(core, platform, draft.attachments))
  return problems
}
