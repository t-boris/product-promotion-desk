// Domain types shared by the core, the main process and the UI.
// Everything here is plain serializable data (it crosses IPC / HTTP boundaries).

export type Id = string
export type IsoTime = string

// ───────────────────────────── AI engines ─────────────────────────────

export type EngineId = 'claude' | 'codex'

export interface EngineStatus {
  id: EngineId
  label: string
  installed: boolean
  version: string | null
  path: string | null
  /** True when a trivial task completed successfully. */
  ready: boolean
  detail: string
  checkedAt: IsoTime
}

// ───────────────────────────── Products & passports (REQ-001) ─────────────────────────────

export type SourceKind = 'url' | 'text' | 'document' | 'image' | 'code_folder'

export interface SourceScope {
  /** Code folder: extra glob-like path prefixes to include. Empty = whole folder minus default exclusions. */
  include: string[]
  /** Code folder: extra path prefixes to exclude on top of the default exclusions. */
  exclude: string[]
}

export interface ProductSource {
  id: Id
  productId: Id
  kind: SourceKind
  /** URL, absolute path, or the text itself for kind 'text'. */
  ref: string
  label: string
  scope: SourceScope | null
  addedAt: IsoTime
}

/** One promotion goal of a product; a product may have several (REQ-006, DEC-012). */
export interface PromotionGoal {
  id: Id
  targetAction: string
  successMetrics: string[]
  notes: string
}

/** A goal as the owner edits it: no id yet while it is new. */
export type PromotionGoalInput = Omit<PromotionGoal, 'id'> & { id?: Id }

export type AnalysisStatus = 'idle' | 'running' | 'paused' | 'failed' | 'complete'

export interface Product {
  id: Id
  name: string
  websiteUrl: string | null
  description: string | null
  goals: PromotionGoal[]
  /** Currently approved passport version (null until the first approval). */
  activePassportVersionId: Id | null
  analysisStatus: AnalysisStatus
  createdAt: IsoTime
  updatedAt: IsoTime
}

export type PassportSection =
  | 'identity'
  | 'offer'
  | 'audience'
  | 'terms'
  | 'geo_languages'
  | 'communication'
  | 'materials'
  | 'goals'

export const PASSPORT_SECTIONS: PassportSection[] = [
  'identity',
  'offer',
  'audience',
  'terms',
  'geo_languages',
  'communication',
  'materials',
  'goals'
]

export type ClaimKind = 'fact' | 'assumption' | 'unknown' | 'contradiction'
export type ClaimStatus = 'proposed' | 'approved' | 'rejected' | 'prohibited'

export interface ClaimSourceRef {
  sourceId: Id | null
  /** Human-readable pointer (URL, file path, quote location). */
  ref: string
  verifiedAt: IsoTime
}

export interface Claim {
  id: Id
  /** Stable across passport versions: a claim copied into a new version keeps its lineage. */
  lineageId: Id
  passportVersionId: Id
  section: PassportSection
  text: string
  kind: ClaimKind
  status: ClaimStatus
  sources: ClaimSourceRef[]
  /** Latest verification date over the sources; null for assumptions/unknowns. */
  verifiedAt: IsoTime | null
  /** Capability found only in source code: availability to users is unconfirmed. */
  unconfirmedAvailability: boolean
  /** Other claims this one contradicts (never resolved silently). */
  conflictsWith: Id[]
  createdAt: IsoTime
  updatedAt: IsoTime
}

export type PassportStatus = 'draft' | 'approved' | 'superseded'

export interface PassportVersion {
  id: Id
  productId: Id
  version: number
  status: PassportStatus
  createdAt: IsoTime
  approvedAt: IsoTime | null
}

export type AnalysisStageName =
  | 'read_site'
  | 'analyze_documents'
  | 'scan_code'
  | 'synthesize'
  | 'find_contradictions'

export type AnalysisStageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface AnalysisStage {
  productId: Id
  name: AnalysisStageName
  status: AnalysisStageStatus
  detail: string
  updatedAt: IsoTime
}

export interface PassportView {
  product: Product
  /** Draft being edited if any, otherwise the approved version. */
  version: PassportVersion | null
  claims: Claim[]
  sources: ProductSource[]
  stages: AnalysisStage[]
}

// ───────────────────────────── Accounts, channels, capabilities (REQ-002) ─────────────────────────────

export type AccountStatus = 'ready' | 'login_required' | 'captcha' | 'suspended'

export interface Account {
  id: Id
  platform: string
  label: string
  /** Platform identity confirmed after login (e.g. Reddit username). */
  identity: string | null
  /** Persistent browser partition name holding this account's session. */
  partition: string
  status: AccountStatus
  createdAt: IsoTime
  /**
   * The product this login belongs to (DEC-009). Each product has its own login and browser session per platform.
   * Null only for an account created before products owned accounts that had no channel to infer a product from.
   * Another product's channel may use the account only by explicit choice (`reuseAccount`), and then the
   * shared-account rules (aggregate limits, one controller of the session) apply.
   */
  productId: Id | null
  /**
   * Who this login speaks as (DEC-010): a short name and the voice (how it writes, what it may talk about). Null
   * means no role: drafts use the channel's reply style. A role never presents itself as an independent user.
   */
  role: AccountRole | null
}

export interface AccountRole {
  /** Short name, e.g. "astrologer" or "developer". */
  name: string
  /** How this login writes and what it may talk about, in plain words. */
  voice: string
}

/** An idea for a role and a login name for a product. The owner creates the real login on the platform. */
export interface RoleSuggestion {
  name: string
  voice: string
  /** A few ideas for the login name on the platform; the application never registers accounts. */
  usernameIdeas: string[]
  /** Why this role fits the product's audience. */
  reason: string
}

/** A platform the application can connect, taken from the registered connectors (DEC-009). */
export interface PlatformInfo {
  /** Connector id, e.g. "reddit" or "universal". */
  connectorId: string
  /** Key stored on accounts and channels, e.g. "reddit". */
  platform: string
  label: string
  /** False for the universal connector, which needs a site profile for every site. */
  prepared: boolean
  loginUrl: string
}

/** An idea for a channel to connect. Unverified: the address is checked only when the channel is assessed. */
export interface ChannelSuggestion {
  /** Platform key from `PlatformInfo.platform`, or "other" for an unknown site. */
  platform: string
  /** Address or short form, e.g. "r/astrology" or "https://forum.example.com/". */
  target: string
  /** Why it may fit this product, in plain words. */
  reason: string
}

/**
 * Draft of a declarative site profile prepared by the AI for the universal connector. It is never executable
 * code: it is validated against the connector's schema, shown to the owner, and saved only after the owner accepts.
 */
export interface SiteProfileDraft {
  host: string
  /** The profile definition in the connector's schema; opaque to the interface, saved back unchanged. */
  definition: unknown
  valid: boolean
  /** Validation problems; empty when valid. */
  problems: string[]
  /** What the profile says, in plain lines for the owner to review (pages, sign-in check, what can be published). */
  summary: string[]
  /** Set when no usable draft could be made: step-by-step manual instructions, with the reason first. */
  instructions: string[]
}

export interface SavedSiteProfile {
  id: Id
  host: string
  version: number
  valid: boolean
  errors: string[]
}

export type CapabilityKey =
  | 'read_posts'
  | 'read_comments'
  | 'detect_changes'
  | 'publish_post'
  | 'publish_reply'
  | 'verify_send'
  | 'metrics'
  | 'rules'

/** needs_check: discovered, not yet confirmed. needs_user: a person must act. restricted: forbidden by rules. */
export type CapabilityStatus = 'verified' | 'needs_check' | 'needs_user' | 'unavailable' | 'restricted'

export interface Capability {
  key: CapabilityKey
  status: CapabilityStatus
  detail: string
  checkedAt: IsoTime | null
}

/** observe: show events. draft: save drafts. approval: queue for approval. auto: restricted automatic replies. */
export type ChannelMode = 'observe' | 'draft' | 'approval' | 'auto'
export type AutoCategory = 'thanks' | 'faq'

export interface ChannelLimits {
  perHour: number
  perDay: number
}

export interface ChannelSettings {
  languages: string[]
  style: string
  topics: string[]
  queries: string[]
  checkIntervalMin: number
  limits: ChannelLimits
  autoCategories: AutoCategory[]
  /** Local HH:MM for the daily summary, or null for none. */
  digestTime: string | null
  notifications: boolean
}

export type ChannelStatus = 'setup' | 'active' | 'paused' | 'needs_user' | 'error'

export interface Channel {
  id: Id
  productId: Id
  accountId: Id
  platform: string
  connectorId: string
  /** Channel address: e.g. "r/astrology" for Reddit. */
  target: string
  url: string
  mode: ChannelMode
  settings: ChannelSettings
  capabilities: Capability[]
  status: ChannelStatus
  statusDetail: string
  /** Set when the first observation cycle stored existing comments as the baseline. */
  baselineDoneAt: IsoTime | null
  lastRunAt: IsoTime | null
  lastSuccessAt: IsoTime | null
  nextCheckAt: IsoTime | null
  createdAt: IsoTime
}

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = {
  languages: ['en'],
  style: '',
  topics: [],
  queries: [],
  checkIntervalMin: 30,
  limits: { perHour: 2, perDay: 6 },
  autoCategories: [],
  digestTime: null,
  notifications: true
}

// ───────────────────────────── Discussions & comments (REQ-003) ─────────────────────────────

export interface Discussion {
  id: Id
  channelId: Id
  externalId: string
  url: string
  title: string
  author: string
  body: string
  /** Older discussion explicitly selected by the user for processing. */
  selectedForProcessing: boolean
  firstSeenAt: IsoTime
  lastSeenAt: IsoTime
}

export interface Comment {
  id: Id
  discussionId: Id
  channelId: Id
  externalId: string
  parentExternalId: string | null
  author: string
  body: string
  url: string
  postedAt: IsoTime | null
  /** Seen during the first observation cycle: never a trigger for automatic replies. */
  baseline: boolean
  /** Written by the account configured for this channel. */
  isOwn: boolean
  contentHash: string
  firstSeenAt: IsoTime
  lastSeenAt: IsoTime
}

export type CommentCategory =
  | 'product_question'
  | 'thanks'
  | 'purchase_interest'
  | 'complaint'
  | 'criticism'
  | 'irrelevant'
  | 'spam'

export type OpportunityKind = 'reply' | 'standalone'

export type OpportunityState =
  | 'discovered'
  | 'analyzing'
  | 'draft'
  | 'awaiting_approval'
  | 'ready'
  | 'sending'
  | 'confirmed'
  | 'no_reply'
  | 'deferred'
  | 'cancelled'
  | 'needs_user'
  | 'error'
  | 'unknown_result'

export type OpportunityDecision = 'reply' | 'ask_user' | 'handoff' | 'ignore'

export interface Opportunity {
  id: Id
  channelId: Id
  productId: Id
  kind: OpportunityKind
  state: OpportunityState
  commentId: Id | null
  discussionId: Id | null
  category: CommentCategory | null
  decision: OpportunityDecision | null
  /** Where the content will be published (thread/comment URL or channel URL). */
  destination: string
  /** Explanation of the current state (why no reply, what is needed, ...). */
  reason: string
  /** Planned send time for standalone publications. */
  scheduledAt: IsoTime | null
  createdAt: IsoTime
  updatedAt: IsoTime
}

// ───────────────────────────── Drafts, approvals, sending (REQ-003, REQ-004) ─────────────────────────────

export interface Attachment {
  name: string
  path: string
  mime: string
  sha256: string
}

export interface Draft {
  id: Id
  opportunityId: Id
  title: string | null
  text: string
  link: string | null
  attachments: Attachment[]
  /** Passport version used to prepare the draft. */
  knowledgeVersionId: Id | null
  /** Lineage ids of the approved claims the draft relies on; a change to any of them forces re-review. */
  usedClaimLineageIds: Id[]
  /** Why this response was proposed. */
  rationale: string
  author: 'ai' | 'user'
  createdAt: IsoTime
}

export interface Approval {
  id: Id
  draftId: Id
  /** sha256 over text, title, link, attachments, account and destination. */
  contentHash: string
  accountId: Id
  destination: string
  approvedBy: 'user' | 'auto_rule'
  /** For automatic approvals: the rule that allowed sending. */
  ruleId: string | null
  approvedAt: IsoTime
  invalidatedAt: IsoTime | null
  invalidReason: string | null
}

/** sending: attempt in flight. unknown: outcome unresolved, blocks further attempts. */
export type SendState = 'sending' | 'confirmed' | 'failed' | 'unknown'

export interface SendAction {
  id: Id
  opportunityId: Id
  draftId: Id
  approvalId: Id
  contentHash: string
  accountId: Id
  destination: string
  state: SendState
  attemptedAt: IsoTime
  completedAt: IsoTime | null
  resultUrl: string | null
  resultExternalId: string | null
  /** e.g. "user approval <id>" or "auto rule thanks-v1". */
  authorizationBasis: string
  knowledgeVersionId: Id | null
  error: string | null
}

// ───────────────────────────── Runs, logs, metrics, attention (REQ-005, REQ-006) ─────────────────────────────

export type RunKind = 'monitor' | 'analysis' | 'send' | 'reconcile' | 'metrics' | 'assess' | 'draft'
export type RunStatus = 'running' | 'ok' | 'failed' | 'skipped' | 'suspended'

export interface Run {
  id: Id
  kind: RunKind
  channelId: Id | null
  productId: Id | null
  status: RunStatus
  startedAt: IsoTime
  finishedAt: IsoTime | null
  summary: string
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEvent {
  id: number
  ts: IsoTime
  level: LogLevel
  source: string
  message: string
  channelId: Id | null
}

/** value is null when the platform does not provide the metric: unavailable is never shown as zero. */
export interface MetricReading {
  key: string
  label: string
  value: number | null
  available: boolean
}

export interface MetricSnapshot extends MetricReading {
  id: Id
  channelId: Id
  capturedAt: IsoTime
}

export type AttentionKind =
  | 'approval'
  | 'draft'
  | 'question'
  | 'login'
  | 'captcha'
  | 'connection'
  | 'error'
  | 'unknown_result'

export interface AttentionItem {
  id: string
  kind: AttentionKind
  title: string
  detail: string
  refType: 'opportunity' | 'channel' | 'account' | 'product' | 'action'
  refId: Id
  createdAt: IsoTime
}

export interface AutomationState {
  /** User paused all automation. */
  paused: boolean
  /** The scheduler loop is alive. */
  running: boolean
  activeRuns: number
  lastTickAt: IsoTime | null
  nextDueAt: IsoTime | null
  /** True while no application window is open. */
  background: boolean
}

export interface AppSettings {
  engineId: EngineId | null
  notifications: boolean
  webMode: { enabled: boolean; port: number }
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  dataDir: string
  webMode: { enabled: boolean; url: string | null }
}

/** Audit row shown in the action history (REQ-006): what was sent, where, when and on what basis. */
export interface HistoryEntry {
  action: SendAction
  opportunity: Opportunity
  draft: Draft
  channelTarget: string
  accountLabel: string
}

/** Everything the review UI needs about one opportunity or publication. */
export interface OpportunityCard {
  opportunity: Opportunity
  channelTarget: string
  accountLabel: string
  comment: Comment | null
  discussion: Discussion | null
  /** Parent chain and nearby comments available as conversation context. */
  thread: Comment[]
  draft: Draft | null
  approval: Approval | null
  lastAction: SendAction | null
}

export interface ResultsView {
  goals: { productId: Id; productName: string; goals: PromotionGoal[] }[]
  channels: { channel: Channel; metrics: MetricSnapshot[] }[]
  /** Version 1 never measures business conversions; the UI must say so (REQ-006, DEC-002). */
  businessConversions: 'not_measured'
}
