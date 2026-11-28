// How a send can be carried out, decided in one place: the approval's fit check, the gate's re-check at the send and the choice of the
// executor ask the same question, so what the owner is told can be sent is what is sent (DEC-031).

import { judgedForFit, kindsOf, platformLabel, renderForPlatform, sendProblems, type PostContent, type SendWays } from '../../shared/post-format'
import { hasInstagramMediaOptions, instagramMediaFitProblems } from '../../shared/instagram-media'
import type { Channel } from '../../shared/types'
import { reelProblem } from '../../shared/video-as'
import type { Core } from '../core'
import { pictureFitProblems } from './picture-fit'

export type Executor = 'connector' | 'ai_browser'

/** A post with the flair chosen for it, when it has one (a `Draft`; the flair is no part of the rendered text). */
export type FlairedPost = PostContent & { flair?: string | null }

/**
 * Why a post with a flair cannot go out as it is: the connector fills a form that has no flair, so the post would arrive without it and a
 * community that requires one would refuse it with nothing for the application to read back (lesson 330). Null when the AI browser carries
 * the send (it sets the flair), when the post has no flair, and for a channel with no connector, whose own message says what stops it.
 */
export function flairProblem(draft: FlairedPost, ways: SendWays): string | null {
  if (!draft.flair || ways.aiBrowser || ways.noConnector || ways.api) return null
  return ways.unattended
    ? `The flair “${draft.flair}” is set in the account's browser, and this is an automatic send, which never uses it. Press Send on it yourself, or give it a time. Nothing was sent.`
    : `The flair “${draft.flair}” is set in the account's browser, by the AI. Turn on “Let the AI publish in the account's browser” in Settings (Publishing), or take the flair off the post.`
}

/**
 * An item the owner put on a schedule: it has a time (`scheduledAt`). Together with the owner's own approval, given before that time, this is the owner's
 * press made ahead of time on exactly the approved content, which is what lets the scheduler send it without a click and lets the AI browser carry it
 * (DEC-049 for an answer from the Feed; DEC-053 for every post and reply). An approval made by an automatic rule never counts (`sendWays` asks who approved).
 */
export const scheduledByOwner = (opp: { scheduledAt: string | null }): boolean => opp.scheduledAt !== null

/**
 * Whether the AI browser may carry a send. It does when the owner chose it in the settings, or the channel is one the application does not read
 * (Instagram, Facebook, Threads...: no connector can post to it, so there is nothing to choose, DEC-035), the build has it, and the send is the
 * owner's own: a press on an approval the owner gave themselves, or a time the owner set on it (`scheduled`, see `scheduledByOwner`; DEC-053). A send
 * on an automatic rule's approval never drives a browser.
 * Without `send` (the approval, before anyone presses anything) the question is whether it could, if the owner presses Send. For a channel with
 * no connector the engine is asked too: any engine that can work the browser may carry the send (the owner's decision of 2026-11-20), and the owner is told at the approval when the selected one cannot.
 */
/** Whether a post to the channel may be a Reel: its connector publishes one (asked wherever a draft is stored for a channel, and by the screen through `sendWays`). */
export const takesReel = (core: Core, channel: Pick<Channel, 'reads'> & { connectorId?: string }): boolean => sendWays(core, undefined, channel).reels === true

/** Whether a post to the channel supports Instagram API media options (Stories, alt text, people tags — DEC-097). */
export const takesInstagramMedia = (core: Core, channel: Pick<Channel, 'reads'> & { connectorId?: string }): boolean => sendWays(core, undefined, channel).instagramMedia === true

export function sendWays(core: Core, send?: { automatic: boolean; approvedBy: string; scheduled?: boolean }, channel?: Pick<Channel, 'reads'> & { connectorId?: string }): SendWays {
  // A channel that works through its platform's API has one way, its connector, for everything it sends (DEC-055).
  const connector = channel?.connectorId ? core.connectors.get(channel.connectorId) : undefined
  if (connector?.api) {
    return {
      aiBrowser: false,
      api: true,
      publicFiles: core.services.publicFiles?.ready() === true,
      ...(connector.reels ? { reels: true } : {}),
      ...(connector.instagramMedia ? { instagramMedia: true } : {})
    }
  }
  const noConnector = channel !== undefined && !channel.reads
  const only = noConnector ? { noConnector: true } : {}
  const chosen = (noConnector || core.settings.app().publishWith === 'ai_browser') && core.services.postMissions !== undefined
  if (!chosen) return { aiBrowser: false, ...only }
  const ownerScheduled = send?.scheduled === true && send.approvedBy === 'user'
  if (send && ((send.automatic && !ownerScheduled) || send.approvedBy !== 'user')) return { aiBrowser: false, unattended: true, ...only }
  if (noConnector) {
    const engine = core.engines.selected()
    if (!engine) return { aiBrowser: false, noConnector: true, engineProblem: 'No AI engine is selected. The AI works the browser for this channel: choose Claude Code in Settings (AI engine), or use “Copy post” and publish it by hand.' }
    if (!engine.supportsAgent) {
      return { aiBrowser: false, noConnector: true, engineProblem: `${engine.label} cannot work the browser. The AI works the browser for this channel: choose Claude Code or Codex in Settings (AI engine), or use “Copy post” and publish it by hand.` }
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
export function chooseExecutor(ways: SendWays, draft: FlairedPost, platform: string): Executor {
  if (!ways.aiBrowser || ways.api) return 'connector'
  // No connector can post to this channel: whatever the draft holds, the AI browser is the only way.
  if (ways.noConnector) return 'ai_browser'
  // No connector sets a flair (the label a community asks of a post): the application sets it on the site's own form, in the browser.
  if (draft.flair) return 'ai_browser'
  // No connector uploads a video: it goes with the AI browser or by hand.
  if (kindsOf(draft.attachments).videos > 0) return 'ai_browser'
  if (draft.attachments.length > 0 && (!judgedForFit(draft) || sendProblems(platform, renderForPlatform(draft, platform), { aiBrowser: false }).length === 0)) return 'connector'
  return 'ai_browser'
}

/**
 * Why a post that the application judges (`judgedForFit`: a post written in the post editor, a quick post) cannot be sent as it is, in words: what
 * the platform cannot take (limits, pictures, what the render says), what the way the application publishes cannot carry, and, for a quick post,
 * what the platform refuses about its one picture (type, size, shape). The approval, the gate and the group view ask this one function, so what the
 * owner is told fits is what the press accepts (lesson 209). Empty when nothing stops it.
 */
export function sendFitProblems(core: Core, draft: FlairedPost, platform: string, ways: SendWays): string[] {
  const problems = sendProblems(platform, renderForPlatform(draft, platform), ways)
  const flair = flairProblem(draft, ways)
  if (flair) problems.push(flair)
  if (draft.videoAs === 'reel') {
    if (!ways.reels) problems.push(`The application does not publish a Reel on this ${platformLabel(platform)} channel: choose “Video post”.`)
    else {
      const notReel = reelProblem(draft.attachments)
      if (notReel) problems.push(`${notReel} Leave only the video on the post, or choose “Video post”.`)
    }
  }
  if (hasInstagramMediaOptions(draft)) {
    if (!ways.instagramMedia) problems.push(`Instagram Stories, alt text and people tags are published only through an Instagram API channel.`)
    else problems.push(...instagramMediaFitProblems(draft))
  }
  if (draft.postType === 'quick') problems.push(...pictureFitProblems(core, platform, draft.attachments))
  return problems
}
