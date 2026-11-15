// Cross-module service contracts. Modules attach their implementation to `core.services` in `register()`
// and consume other modules only through these interfaces, so they can be built and tested independently.

import type { AgentAsk, CapabilityKey, Channel, Claim, Id, MetricSnapshot, SendAction } from '../shared/types'
import type { PostMissionService } from './browser-agent/post-submit'
import type { WatchMissionService } from './browser-agent/watch'
import type { MediaService } from './media/service'

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
  /**
   * Only for `skipped`: when the channel is tried again, when that is sooner than its regular interval (a look at a channel that could not start, DEC-042). Nothing
   * failed, so no backoff is counted.
   */
  retryAt?: string
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

/** The content mix (DEC-033): prepares the drafts that are due. It prepares drafts and nothing else: never an approval, never a send. */
export interface MixService {
  /** Looks at every channel that may be worked on and prepares what is due. Returns how many drafts were prepared. */
  /** `stop` says the scan must end now (automation was paused, the app is closing); it is asked between channels. */
  runDue(stop?: () => boolean): Promise<number>
}

/** Platform metrics snapshots (I-8). */
export interface MetricsService {
  refresh(channelId: Id): Promise<MetricSnapshot[]>
}

/** Implemented by the channels module (I-3); called by the sending service after a confirmed publication. */
export interface ChannelsService {
  /** Marks a capability verified by actual authorized use (onboarding never publishes test messages). */
  markCapabilityVerified(channelId: Id, key: CapabilityKey, detail: string): void
  /** Asks the AI for a plan of the channel and stores it (DEC-013); the content mix reads the rhythm of its steps (DEC-033). */
  preparePlan?(channelId: Id): Promise<Channel>
}

/** Implemented by the channels module; read by the attention list: an AI working on an account that waits for the owner is something that needs them (DEC-018). */
export interface AgentQuestions {
  questions(): AgentAsk[]
  /** True while a mission is running on the account (the browser of an account is not changed meanwhile, DEC-026). */
  working(accountId: Id): boolean
}

export interface CoreServices {
  /** The picture library (DEC-030); the draft input adds the pictures of a draft to it and reads them from it. */
  media?: MediaService
  agent?: AgentQuestions
  /** Implemented by the channels module; the send flow runs an approved publication through it when the owner chose the AI browser (B1). */
  postMissions?: PostMissionService
  /** Implemented by the channels module; the monitor's watch flow has the AI look at a channel the app has no connector for, in the account's browser (DEC-042). */
  watchMissions?: WatchMissionService
  channels?: ChannelsService
  knowledge?: KnowledgeProvider
  pipeline?: PipelineHooks
  monitor?: MonitorService
  drafting?: DraftingService
  sending?: SendingService
  metrics?: MetricsService
  mix?: MixService
}
