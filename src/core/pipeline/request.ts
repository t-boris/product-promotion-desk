import type { CapabilityKey, Comment, Draft, Opportunity } from '../../shared/types'
import type { PublishRequest } from '../ports'

/** The connector request for an opportunity's draft. Deterministic, so reconciliation can rebuild the same request. */
export function buildPublishRequest(opp: Opportunity, draft: Draft, comment: Comment | null, destination: string): PublishRequest {
  return {
    kind: opp.kind === 'standalone' ? 'post' : 'reply',
    destination,
    parentExternalId: comment?.externalId ?? null,
    title: draft.title,
    text: draft.text,
    link: draft.link,
    attachments: draft.attachments
  }
}

export const publishCapability = (opp: Opportunity): CapabilityKey => (opp.kind === 'standalone' ? 'publish_post' : 'publish_reply')
