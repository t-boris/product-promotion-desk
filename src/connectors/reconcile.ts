// Shared rules for looking up the result of a send whose outcome is unknown (Connector.findPublished).
// Text alone must never match: an older identical comment ("Thanks!") would otherwise be taken for the new one,
// and the send would be recorded as done although nothing was published.

import type { PublishRequest } from '../core/ports'

/** Clock difference tolerated between this computer and the site when deciding whether content is newer than an attempt. */
export const CLOCK_SKEW_MS = 5 * 60_000

/**
 * Earliest creation time (ms) a publication of this attempt can have. Without the attempt time nothing can be
 * bound to it, so this throws: an unresolved outcome is safe, a wrong match is not.
 */
export function earliestCreation(request: PublishRequest): number {
  const started = request.attemptedAt ? Date.parse(request.attemptedAt) : Number.NaN
  if (!Number.isFinite(started)) {
    throw new Error('The time of the send attempt is unknown, so its publication cannot be told apart from older content. Check the account manually.')
  }
  return started - CLOCK_SKEW_MS
}

/** Creation time in ms; NaN (which never passes a `>=` check) when it is missing or unreadable. */
export const createdMs = (createdAt: string | null | undefined): number => (createdAt ? Date.parse(createdAt) : Number.NaN)
