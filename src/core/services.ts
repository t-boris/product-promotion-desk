// Cross-module service contracts. Modules attach their implementation to `core.services` in `register()`
// and consume other modules only through these interfaces, so they can be built and tested independently.

import type { Claim, Id } from '../shared/types'

/** Implemented by the passports module (I-1); consumed by drafting and sending (I-5, I-6). */
export interface KnowledgeProvider {
  /** Currently approved passport version, or null before the first approval. */
  activeVersionId(productId: Id): Id | null
  /** Approved facts of the active version that may be used in promotional text. Prohibited claims are never returned. */
  approvedClaims(productId: Id): Claim[]
  /** Claims the user prohibited from any use in publications. */
  prohibitedClaims(productId: Id): Claim[]
}

/** Implemented by the pipeline module (I-5); called by the passports module when facts change. */
export interface PipelineHooks {
  /**
   * Sends pending drafts that relied on any of `changedLineageIds` back to review and invalidates their approvals.
   * Returns the number of affected opportunities. Historical (sent) publications are never touched.
   */
  invalidateForChangedFacts(productId: Id, changedLineageIds: Id[]): number
}

export interface CoreServices {
  knowledge?: KnowledgeProvider
  pipeline?: PipelineHooks
}
