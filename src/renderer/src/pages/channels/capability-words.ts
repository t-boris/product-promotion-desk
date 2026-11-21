// What the table "What this account can do here" calls its rows and their states (DEC-029 adds Membership). Pure, in a module without
// components, so it is tested on its own; model.ts re-exports it for the screens.

import type { Capability, CapabilityKey, CapabilityStatus, PlatformInfo } from '../../../../shared/types'

/** Membership comes first: whether the account joined explains what the rows below it can read. */
export const CAPABILITY_ORDER: CapabilityKey[] = ['membership', 'read_posts', 'read_comments', 'read_inbox', 'detect_changes', 'metrics', 'publish_post', 'publish_reply', 'verify_send']

export const CAPABILITY_LABEL: Record<CapabilityKey, string> = {
  membership: 'Membership',
  read_posts: 'Read posts',
  read_comments: 'Read comments',
  read_inbox: 'Read replies to you and mentions',
  detect_changes: 'Detect new activity',
  metrics: 'Read metrics',
  publish_post: 'Publish a post',
  publish_reply: 'Send a reply',
  verify_send: 'Confirm that a message was published'
}

export const CAPABILITY_STATUS_LABEL: Record<CapabilityStatus, string> = {
  verified: 'Verified',
  needs_check: 'Needs verification',
  needs_user: 'Needs you',
  unavailable: 'Unavailable',
  restricted: 'Restricted'
}

/** Membership is a fact about the account, not an ability: its states say that in the words people use for it. */
const MEMBERSHIP_STATUS_LABEL: Record<CapabilityStatus, string> = {
  verified: 'Member',
  needs_check: 'Not joined',
  needs_user: 'Needs you',
  unavailable: 'Unavailable',
  restricted: 'Banned'
}

/**
 * The word for the state of one row: Membership has its own, every other row the common one. `checkedAt` null is a row that was never
 * checked: Membership then says so, and does not say "Not joined" about an account nobody looked at. Left out (the legend), it is not asked.
 */
export function abilityStatusLabel(key: CapabilityKey, status: CapabilityStatus, checkedAt?: string | null): string {
  if (key !== 'membership') return CAPABILITY_STATUS_LABEL[status]
  return checkedAt === null ? 'Not checked yet' : MEMBERSHIP_STATUS_LABEL[status]
}

/** A state the owner may decide on, so it is a tag (amber) and not a quiet dot: an account that was found not to have joined, and may. */
export function abilityNeedsDecision(key: CapabilityKey, status: CapabilityStatus, checkedAt?: string | null): boolean {
  return key === 'membership' && status === 'needs_check' && checkedAt !== null
}

/**
 * The rows of the table for a channel of this platform. Membership is shown only where the connector can tell it (`canJoin`): any other
 * connector fills the row with a generic "needs verification" that would say something the app does not know.
 */
export function capabilityRows(platform: Pick<PlatformInfo, 'canJoin'> | undefined): CapabilityKey[] {
  return platform?.canJoin === true ? CAPABILITY_ORDER : CAPABILITY_ORDER.filter((key) => key !== 'membership')
}

/** The Membership line of the channel card: the state, or that it was never checked. */
export function membershipWord(capability: Pick<Capability, 'status' | 'checkedAt'> | undefined): string {
  return !capability || capability.checkedAt === null ? 'Not checked yet' : abilityStatusLabel('membership', capability.status)
}
