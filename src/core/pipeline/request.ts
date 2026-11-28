import type { CapabilityKey, Draft, Opportunity } from '../../shared/types'
import { renderForPlatform } from '../../shared/post-format'
import type { PublishRequest } from '../ports'

/**
 * The connector request for an opportunity's draft. Deterministic, so reconciliation can rebuild the same request. A draft written in the
 * post editor is sent in the form its platform shows (DEC-030): the same function the preview on the screen uses. Any other draft is sent as written.
 */
export function buildPublishRequest(opp: Opportunity, draft: Draft, parent: { externalId: string } | null, destination: string, platform: string): PublishRequest {
  const post = renderForPlatform(draft, platform)
  return {
    kind: opp.kind === 'standalone' ? 'post' : 'reply',
    destination,
    // What the reply answers: a comment's id, or the post's own when the reply is a top-level comment on a new post (DEC-039).
    parentExternalId: parent?.externalId ?? null,
    title: post.title,
    text: post.text,
    link: post.link,
    attachments: post.attachments,
    flair: draft.flair,
    topicTag: draft.topicTag,
    videoAs: draft.videoAs
  }
}

export const publishCapability = (opp: Opportunity): CapabilityKey => (opp.kind === 'standalone' ? 'publish_post' : 'publish_reply')
