// The single contract between the UI and the core (DEC-006).
// The UI only ever calls `Transport.invoke` / `Transport.subscribe`; whether that travels over
// Electron IPC or over the loopback HTTP server is invisible to it.

import type {
  Account,
  AppInfo,
  AppSettings,
  AttentionItem,
  AutomationState,
  Channel,
  ChannelMode,
  ChannelSettings,
  Claim,
  ClaimKind,
  ClaimSourceRef,
  ClaimStatus,
  Attachment,
  Discussion,
  EngineId,
  EngineStatus,
  HistoryEntry,
  Id,
  IsoTime,
  LogEvent,
  LogLevel,
  OpportunityCard,
  OpportunityKind,
  OpportunityState,
  PassportSection,
  PassportVersion,
  PassportView,
  Product,
  ProductSource,
  PromotionGoal,
  ResultsView,
  MetricSnapshot,
  Run,
  SourceKind,
  SourceScope,
  AnalysisStage
} from './types'

export interface SourcePreview {
  /** Paths/URLs the AI will be allowed to read. */
  included: string[]
  /** Paths excluded by default rules or by the user (secrets, env files, dependencies, technical dirs). */
  excluded: { path: string; reason: string }[]
  summary: string
}

export interface ClaimInput {
  id?: Id
  section: PassportSection
  text: string
  kind?: ClaimKind
  sources?: ClaimSourceRef[]
}

export interface DraftInput {
  title?: string | null
  text: string
  link?: string | null
  attachments?: Attachment[]
}

/** method → [arguments, result]. Every handler is implemented in src/core/api/*. */
export interface ApiMethods {
  // application, automation, settings
  'app.info': [void, AppInfo]
  'app.settings.get': [void, AppSettings]
  'app.settings.update': [Partial<AppSettings>, AppSettings]
  'automation.get': [void, AutomationState]
  'automation.setPaused': [{ paused: boolean }, AutomationState]
  'attention.list': [void, AttentionItem[]]

  // AI engines (REQ-006)
  'engines.list': [void, EngineStatus[]]
  'engines.check': [{ id: EngineId }, EngineStatus]
  'engines.select': [{ id: EngineId }, AppSettings]

  // products and passports (REQ-001)
  'products.list': [void, Product[]]
  'products.create': [{ name: string; websiteUrl?: string; description?: string }, Product]
  'products.update': [{ id: Id; name?: string; websiteUrl?: string | null; description?: string | null }, Product]
  'products.delete': [{ id: Id }, void]
  'products.setGoal': [{ id: Id; goal: PromotionGoal }, Product]
  'sources.add': [{ productId: Id; kind: SourceKind; ref: string; label?: string; scope?: SourceScope | null }, ProductSource]
  'sources.remove': [{ id: Id }, void]
  'sources.preview': [{ kind: SourceKind; ref: string; scope?: SourceScope | null }, SourcePreview]
  'analysis.start': [{ productId: Id }, PassportView]
  'analysis.stop': [{ productId: Id }, PassportView]
  'passport.get': [{ productId: Id }, PassportView]
  'passport.versions': [{ productId: Id }, PassportVersion[]]
  'passport.claim.save': [{ productId: Id; claim: ClaimInput }, Claim]
  'passport.claim.setStatus': [{ claimId: Id; status: ClaimStatus }, Claim]
  'passport.claim.delete': [{ claimId: Id }, void]
  'passport.approve': [{ productId: Id }, PassportVersion]

  // accounts and channels (REQ-002)
  'accounts.list': [void, Account[]]
  'accounts.create': [{ platform: string; label: string }, Account]
  'accounts.remove': [{ id: Id }, void]
  /** Opens the account's persistent browser at `url` and hands control to the user (login handoff). */
  'accounts.openBrowser': [{ accountId: Id; url?: string }, { tabId: string }]
  'accounts.takeControl': [{ accountId: Id }, void]
  'accounts.releaseControl': [{ accountId: Id }, void]
  'accounts.checkLogin': [{ accountId: Id }, Account]
  'channels.list': [void, Channel[]]
  'channels.connect': [{ productId: Id; accountId: Id; target: string }, Channel]
  'channels.assess': [{ channelId: Id }, Channel]
  'channels.updateSettings': [{ channelId: Id; settings: Partial<ChannelSettings> }, Channel]
  'channels.setMode': [{ channelId: Id; mode: ChannelMode }, Channel]
  /** Runs the first observation cycle (baseline) and sets the channel active. */
  'channels.activate': [{ channelId: Id }, Channel]
  'channels.setPaused': [{ channelId: Id; paused: boolean }, Channel]
  'channels.remove': [{ id: Id }, void]
  'channels.discussions': [{ channelId: Id }, Discussion[]]
  'channels.selectOlder': [{ channelId: Id; discussionIds: Id[]; selected: boolean }, Discussion[]]
  'channels.checkNow': [{ channelId: Id }, Run]

  // opportunities, review queues, publications (REQ-003, REQ-004)
  'opportunities.list': [{ channelId?: Id; kind?: OpportunityKind; states?: OpportunityState[] }, OpportunityCard[]]
  'opportunities.get': [{ id: Id }, OpportunityCard]
  'opportunities.prepareDraft': [{ id: Id }, OpportunityCard]
  'opportunities.saveDraft': [{ id: Id; draft: DraftInput }, OpportunityCard]
  'opportunities.approve': [{ id: Id }, OpportunityCard]
  'opportunities.reject': [{ id: Id; reason?: string }, OpportunityCard]
  'opportunities.defer': [{ id: Id }, OpportunityCard]
  'opportunities.send': [{ id: Id }, OpportunityCard]
  /** Re-checks an 'unknown' send with the platform; only then may a new attempt happen. */
  'opportunities.reconcile': [{ id: Id }, OpportunityCard]
  /**
   * The owner settles an 'unknown' send by checking the platform themselves: it was published (optionally with its
   * link) or it was not. Without this an unreachable platform check would lock the item forever.
   */
  'opportunities.resolveUnknown': [{ id: Id; outcome: 'published' | 'not_published'; url?: string }, OpportunityCard]
  'publications.suggest': [{ channelId: Id }, OpportunityCard]
  'publications.create': [{ channelId: Id; draft: DraftInput }, OpportunityCard]
  'publications.schedule': [{ id: Id; at: IsoTime | null }, OpportunityCard]

  // results and logs (REQ-005, REQ-006)
  'results.get': [{ productId?: Id }, ResultsView]
  'results.refresh': [{ channelId: Id }, MetricSnapshot[]]
  'runs.list': [{ limit?: number; channelId?: Id }, Run[]]
  'logs.list': [{ limit?: number; level?: LogLevel }, LogEvent[]]
  'history.list': [{ limit?: number }, HistoryEntry[]]
}

export type ApiMethod = keyof ApiMethods
export type ApiArgs<M extends ApiMethod> = ApiMethods[M][0]
export type ApiResult<M extends ApiMethod> = ApiMethods[M][1]

export type ChangeScope =
  | 'products'
  | 'passport'
  | 'accounts'
  | 'channels'
  | 'opportunities'
  | 'results'
  | 'logs'
  | 'attention'
  | 'settings'

/** Pushed from the core to every connected UI. */
export type ApiEvent =
  | { type: 'automation'; state: AutomationState }
  | { type: 'changed'; scope: ChangeScope }
  | { type: 'analysis'; productId: Id; stage: AnalysisStage }
  | { type: 'run'; run: Run }

export interface ApiErrorShape {
  code: string
  message: string
}

export class ApiError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export interface Transport {
  invoke<M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<ApiResult<M>>
  subscribe(handler: (event: ApiEvent) => void): () => void
}

/** Names used on the Electron IPC channel and the HTTP routes. */
export const IPC_INVOKE = 'ppd:invoke'
export const IPC_EVENT = 'ppd:event'
export const WEB_TOKEN_HEADER = 'x-ppd-token'
