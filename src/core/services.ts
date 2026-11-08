// Cross-module service contracts. Modules attach their implementation to `core.services` in `register()`
// and consume other modules only through these interfaces, so they can be built and tested independently.

import type { Claim, Id, MetricSnapshot, SendAction } from '../shared/types'

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


// ───────────────────────────── Pipeline services (I-4, I-5, I-6 implement; I-7, I-8 consume) ─────────────────────────────


export interface MonitorOutcome {
  status: 'ok' | 'failed' | 'suspended' | 'skipped'
  /** Short human-readable result shown in the run log. */
  summary: string
  newOpportunities: number
}

/** Discussion collection (I-4). A failure of one channel is returned as an outcome and never thrown. */
export interface MonitorService {
  /** One observation cycle. The first cycle stores existing comments as the baseline and creates no opportunities. */
  runChannel(channelId: Id): Promise<MonitorOutcome>
}

/** Draft preparation, mode handling and restricted automatic replies (I-5). */
export interface DraftingService {
  /**
   * Prepares drafts for the channel's discovered opportunities and applies the channel mode:
   * observe → leave as events; draft → save drafts; approval → queue for approval; auto → send only
   * explicitly enabled simple categories through the SendGate. Returns counts for the run summary.
   */
  processChannel(channelId: Id): Promise<{ prepared: number; autoSent: number; needsUser: number }>
}

/** Authorized sending and reconciliation (I-6). Every outgoing action goes through here and the SendGate. */
export interface SendingService {
  send(opportunityId: Id): Promise<SendAction>
  /** Resolves an 'unknown' outcome by asking the platform; returns the updated action, or null if none was pending. */
  reconcile(opportunityId: Id): Promise<SendAction | null>
  /** Reconciles every unresolved action; used after launch and periodically. Returns how many were resolved. */
  reconcileAllUnknown(): Promise<number>
  /** Sends approved standalone publications whose scheduled time has arrived. Returns how many were attempted. */
  sendDuePublications(): Promise<number>
}

/** Platform metrics snapshots (I-8). */
export interface MetricsService {
  refresh(channelId: Id): Promise<MetricSnapshot[]>
}

export interface CoreServices {
  knowledge?: KnowledgeProvider
  pipeline?: PipelineHooks
  monitor?: MonitorService
  drafting?: DraftingService
  sending?: SendingService
  metrics?: MetricsService
}
