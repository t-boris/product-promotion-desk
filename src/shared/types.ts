// Domain types shared by the core, the main process and the UI.
// Everything here is plain serializable data (it crosses IPC / HTTP boundaries).

import type { PostType, QuickCard } from './quick-post'
import type { ThemeChoice } from './themes'

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

/** The text fields the AI can write or improve (assist.refine). The core holds the rules of each one. */
export type AssistField =
  | 'goal.targetAction'
  | 'goal.metrics'
  | 'goal.notes'
  | 'product.description'
  | 'channel.style'
  | 'channel.topics'
  | 'channel.queries'
  | 'picture.description'

/** What the AI helps with in a draft: the title, the text, or a whole new post (title and text). */
export type DraftHelpField = 'title' | 'text' | 'post'

/** What the AI wrote for a draft. Only the asked parts are set. Nothing is stored: the owner reads it and saves the draft. */
export interface DraftHelpResult {
  title?: string
  text?: string
}

/** One thing the owner's own text breaks: what the panel before an approval lists. */
export interface DraftFinding {
  rule: 'prohibited' | 'price' | 'discount' | 'free' | 'link' | 'unsafe_link' | 'credential' | 'connection_denied' | 'connection_unsaid'
  /** The rule, in words. */
  title: string
  /** The words of the text it is about, or what the rule is about; null when there are none to show. */
  quote: string | null
  /** Why it is a problem. */
  why: string
  /** True when approving is refused until it is fixed (the connection to the product, decided in code); false when the owner may approve anyway. */
  blocks: boolean
}

/** What a check of the owner's text found, the findings that block first. An empty list means nothing was found. */
export interface DraftCheckResult {
  findings: DraftFinding[]
}

/** One goal the AI proposes. Nothing is stored: the owner turns it into a goal by pressing "Use this" and "Add goal". */
export interface GoalIdea {
  targetAction: string
  successMetrics: string[]
  /** One plain sentence on why this goal fits the product. */
  reason: string
}

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

/** Which browser an account works in (DEC-026): the application's own, or the owner's installed Google Chrome. */
export type BrowserChoice = 'internal' | 'chrome'

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
   * The product this account was first created for, as information only (DEC-015). Accounts are one library: a channel of
   * any product may use any account of its platform, and the shared-account rules (aggregate limits, one controller of
   * the session) apply whenever an account has more than one channel. Null when it was created without a product.
   */
  productId: Id | null
  /**
   * Who this login speaks as (DEC-010): a short name and the voice (how it writes, what it may talk about). Null
   * means no role: drafts use the channel's reply style. A role never presents itself as an independent user.
   */
  role: AccountRole | null
  /** The name or e-mail the account signs in with (DEC-014). Not a secret; the password is only in the vault. */
  loginName: string | null
  /** The e-mail address of this account (DEC-015): what it signs up with and where its mail arrives. Null until given. */
  email: string | null
  /** The base mailbox the address was proposed from, if any. */
  mailboxId: Id | null
  /** The profile (person) this login belongs to; null for a login that has none (DEC-019). At most one account per platform for a profile. */
  profileId: Id | null
  /** The browser this account's session lives in and every operation on it uses (DEC-026). A session made in one browser is not in the other. */
  browser: BrowserChoice
  /** The account this one signs in through (DEC-027): a Threads account signs in through its Instagram account. Null for a login with its own credentials. */
  signsInVia: Id | null
}

/** A base mailbox (DEC-015): an ordinary mailbox of the owner, from which each account gets an address of its own. */
export interface Mailbox {
  id: Id
  address: string
  kind: 'existing'
  createdAt: IsoTime
}

/**
 * Why the vault cannot encrypt, as far as a real attempt has shown: `refused` is macOS not letting the app use its keychain item (the
 * owner pressed Deny, or the keychain is locked); `no_keychain` is a system without one.
 */
export type VaultUnavailable = 'refused' | 'no_keychain'

/**
 * What the vault holds, without any secret: whether it can encrypt, and which accounts have a password saved (DEC-014). Asking never
 * touches the keychain, so `available` is true until a save, a reveal or a sign-in has found otherwise.
 */
export interface VaultStatus {
  available: boolean
  /** Why `available` is false; null while it is true. */
  unavailable: VaultUnavailable | null
  accountIds: Id[]
}

/** The result of "Sign in with saved password" (DEC-014). */
/** Who holds an account's browser, and whether the person's window for it is open. */
export interface BrowserState {
  holder: 'agent' | 'user' | 'none'
  windowOpen: boolean
  /** Whether Google Chrome is installed on this Mac: the choice of Chrome for an account needs it (DEC-026). */
  chromeFound: boolean
}

/** One request the page made that is worth knowing about: what was sent to where, and what came back. Never a query string, header or body. */
export interface PageRequestNote {
  method: string
  /** Electron's resource type: mainFrame, subFrame, xhr (fetch too), ping ... */
  kind: string
  /** Host and path only. */
  target: string
  status: number | null
  error: string | null
  /** The same request, repeated one after another. */
  count: number
}

/**
 * What an account's page shows and did, taken when the owner asks (DEC-016). Text comes from what a person can read on the page;
 * the value of a form field is never read, so a password typed there is not in it.
 */
export interface PageReport {
  takenAt: IsoTime
  /** Whose page: the owner's own window, or the page the app works in. */
  where: 'owner_window' | 'app_page'
  /** Host and path only. */
  address: string
  title: string
  /** Visible messages a site shows for a problem or a state (alerts, live regions). */
  alerts: string[]
  /** The start of the readable text of the page. */
  text: string
  requests: PageRequestNote[]
  consoleErrors: string[]
  /** PNG as a data URL; null when the page could not be captured. */
  screenshot: string | null
  /** The file the report was also saved to (screenshot and details), or null. */
  savedAs: string | null
}

export interface SignInResult {
  account: Account
  /** `signed_in`: the site confirmed the sign-in. `needs_you`: a check or a changed page needs the owner in the account browser. */
  outcome: 'signed_in' | 'needs_you'
  detail: string
}

/** What the browser agent can be asked to do on an account's own browser (DEC-017). More kinds follow: read, answer, set up a profile. */
/**
 * `signup`: create the account on the platform. `profile`: fill in the profile of an account that exists (about-text, place, website, picture).
 * `join` (DEC-029): press the Join control of one community, for one channel; the only click the mission may make.
 */
export type AgentTaskKind = 'signup' | 'profile' | 'signin' | 'join'
/**
 * What a run of the browser agent is. The first four are started by the owner (`agent.start`); `post` is started only by the send flow,
 * for one approved publication, `watch` (DEC-042) only by the monitor, to look at a channel the app has no connector for, and `research` (REQ-004) only by
 * the quick-post helper, to search a platform for what its people talk about. None of the three can be started through the API.
 */
export type MissionKind = AgentTaskKind | 'post' | 'watch' | 'research'
export type AgentRunStatus = 'running' | 'done' | 'needs_owner' | 'failed' | 'stopped'

/** Whether the browser agent can start on an account now, and if not, the one thing to do first, in plain words. */
export interface AgentReadiness {
  ready: boolean
  reason: string | null
}

/** What the AI asked the owner and is waiting for (a CAPTCHA, a code): shown as a pop-up on any screen. */
export interface AgentQuestion {
  text: string
  askedAt: IsoTime
}

/** A question of a run, with the account it is about, for the pop-up that appears on any screen. */
export interface AgentAsk extends AgentQuestion {
  accountId: Id
  accountLabel: string
}

/** One run of the browser agent on one account: what it is doing or why it stopped, and what it did. Kept in memory; no secret is ever in it. */
export interface AgentRun {
  accountId: Id
  kind: MissionKind
  /** The channel the run is about (a `join` run), so the channel's own card can tell its run from another on the same account. */
  channelId?: Id
  status: AgentRunStatus
  /** One sentence for the owner: what it is doing now, or why it stopped and what to do. */
  summary: string
  /** What it did, oldest first (a password is named, never shown). */
  lines: string[]
  /** Plain values the AI chose itself on the site (names, a birth date): the owner may need them later. */
  typed: { label: string; value: string }[]
  /** Set while the AI waits for the owner's answer; the pop-up shows it. */
  question: AgentQuestion | null
  /** Rules the AI kept from the owner's answers during this run (it called remember_lesson); the owner may undo each. */
  learned: { id: Id; rule: string }[]
  startedAt: IsoTime
  finishedAt: IsoTime | null
}

/**
 * A rule the AI keeps from what the owner told it ("compress a picture to under 500 KB before uploading it", "edit only the editable
 * fields"). Every later mission on that platform gets it in its brief, so the owner is not asked the same thing again.
 */
export interface AgentLesson {
  id: Id
  /** The platform key it is for, or null for every platform. */
  platform: string | null
  /** One short imperative sentence, in plain words. Never a password, a code or a personal value. */
  rule: string
  /** What the AI asked and what the owner answered when it was learned; empty for a rule the owner wrote. */
  question: string
  answer: string
  enabled: boolean
  /** How many missions have been given this rule. */
  uses: number
  createdAt: IsoTime
  lastUsedAt: IsoTime | null
}

export type ProfileGender = 'female' | 'male' | 'other'
export type ProfileStatus = 'proposed' | 'approved'

/** The personal values of a profile: what the owner edits and approves, and what every mission takes from the account instead of making things up. */
export interface ProfileFields {
  firstName: string
  lastName: string
  /** The name shown on the platform. */
  displayName: string
  username: string
  /** YYYY-MM-DD; the person is an adult. */
  birthDate: string
  gender: ProfileGender
  /** City and country, in words. */
  place: string
  /** The text "about me" / bio. */
  about: string
  /** An address shown on the profile, or empty. */
  website: string
  /** What the picture shows and how it looks, as one description; the picture is made from it. */
  pictureIdea: string
}

/**
 * A profile (DEC-019): a person the owner makes up once, for a PURPOSE, and proposed by the AI. Accounts are the logins of a profile on platforms:
 * one profile has many accounts (one per platform), and a platform can have many profiles. `strategy` is the AI's reading of the purpose (the
 * audience, why this person fits); `reasons` says why for each choice, so the owner can overrule it.
 */
export interface Profile extends ProfileFields {
  id: Id
  /** The owner's own name for it ("Mara, Natal Mystic"). */
  label: string
  /** The product the person speaks for, if any: its passport feeds the proposal. */
  productId: Id | null
  /** Who this person speaks as: the same voice on every platform. Accounts of the profile use it. */
  role: AccountRole | null
  /** The platforms the person is meant for (platform keys): the strategy covers all of them. */
  platforms: string[]
  purpose: string
  strategy: string
  reasons: Partial<Record<keyof ProfileFields, string>>
  /** A picture exists for this profile (made by the AI or chosen by the owner). */
  hasPicture: boolean
  status: ProfileStatus
  createdAt: IsoTime
  updatedAt: IsoTime
}

export interface AccountRole {
  /** Short name, e.g. "astrologer" or "developer". */
  name: string
  /** How this login writes and what it may talk about, in plain words. */
  voice: string
}

/** An idea for a role and a login name for a product. The owner decides which one is used; the AI registers the account in its own browser (DEC-018, DEC-019). */
export interface RoleSuggestion {
  name: string
  voice: string
  /** A few ideas for the login name on the platform; the owner decides, and the AI registers the account in its own browser with the name the owner approved (DEC-018, DEC-019). */
  usernameIdeas: string[]
  /** Why this role fits the product's audience. */
  reason: string
}

/** A platform the application can connect, taken from the registered connectors (DEC-009). */
/** What a post on a platform can contain. */
export type PlatformContentKind = 'text' | 'image' | 'video' | 'link'

export interface PlatformInfo {
  /** Connector id, e.g. "reddit" or "universal". */
  connectorId: string
  /** Key stored on accounts and channels, e.g. "reddit" or "instagram". */
  platform: string
  label: string
  /** False for the universal connector and for the named platforms served by it: each site needs a site profile. */
  prepared: boolean
  loginUrl: string
  /** The platform's registration page, opened in the account's own browser (DEC-015); empty when there is none. */
  signupUrl?: string
  /** Said instead of the registration steps when the platform has no registration page on the web. */
  signupNote?: string
  /** Where channels of the platform are found and chosen (a list or a search of communities, groups, accounts), opened in the account's own browser (DEC-028); empty when the platform has none. */
  browseUrl?: string
  /** True when the connector can tell whether the account has joined a channel, so the AI may be asked to join one (DEC-029). */
  canJoin?: boolean
  /** The platform whose account this one signs in through (DEC-027): Threads signs in with Instagram. Such an account has no credentials of its own. */
  signsInWith?: string
  /** Named platform served by the universal connector (DEC-013): what address to give, what a post holds, what to know. */
  hint?: string
  /** A typical address to type, shown as the placeholder; and the template that turns "@name" into an address (`{handle}`). */
  example?: string
  handleUrl?: string
  accepts?: PlatformContentKind[]
  note?: string
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
  /** Whether the account has joined the community (DEC-029). Informational: it gates nothing. */
  | 'membership'
  /** Whether the account's inbox can be read, so that replies to the account and mentions of it are found (DEC-039). Informational: it gates nothing else. */
  | 'read_inbox'

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
  /** How often the channel is looked at, in minutes (DEC-040: every 3 hours by default; each check starts a little earlier or later than that, so channels never start together). */
  checkIntervalMin: number
  /** The one-time look-back of a channel reads this many days back (0 to 30; 0 = none). Afterwards only what is new is read. */
  lookBackDays: number
  limits: ChannelLimits
  autoCategories: AutoCategory[]
  /** Local HH:MM for the daily summary, or null for none. */
  digestTime: string | null
  notifications: boolean
  /** The content mix (DEC-033): which kinds of own posts the AI may prepare drafts of on this channel, and how often. Empty = none. */
  mix: MixSetting[]
}

/** What kind of own post a draft of the content mix is. Replies are what the monitor does and are not part of the mix. */
export type MixKind = 'product_post' | 'own_update' | 'showcase'

export interface MixSetting {
  kind: MixKind
  enabled: boolean
  /** A draft of this kind is prepared about this often (whole days, 1 to 90). */
  everyDays: number
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
  /** When the one-time look-back (the last `settings.lookBackDays` days) was made; null until then (DEC-040). */
  lookedBackAt: IsoTime | null
  lastRunAt: IsoTime | null
  lastSuccessAt: IsoTime | null
  nextCheckAt: IsoTime | null
  /** What the AI proposed to do on this channel; null until the owner asks for it. */
  plan: ChannelPlan | null
  /**
   * Whether the app can read this channel at all (a connector or a site profile that reads it). A channel it cannot read is a channel for the
   * owner's own posts: nothing is observed, no reply is prepared, it is activated without a first read (DEC-034).
   */
  reads: boolean
  /**
   * The app reads this channel through the account's browser, like a person (DEC-042): a channel of a platform it has no connector for (Instagram,
   * Facebook, Threads, X, LinkedIn). Derived, never stored: `!reads` and a platform in BROWSER_WATCH_PLATFORMS. Such a channel is watched and judged
   * on the schedule, and what the AI finds is shown as notices; nothing is replied to, measured or sent from what it reads.
   */
  watchedInBrowser: boolean
  createdAt: IsoTime
}

/** The platforms whose channels are watched through the browser when the app has no connector for them (DEC-042). */
export const BROWSER_WATCH_PLATFORMS: readonly string[] = ['instagram', 'facebook', 'threads', 'x', 'linkedin']

/** Start of the status text a channel carries while its checks fail (the scheduler writes it; the watching line reads it back without repeating it). */
export const FAILURE_DETAIL_PREFIX = 'Last check failed'

export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = {
  languages: ['en'],
  style: '',
  topics: [],
  queries: [],
  checkIntervalMin: 180,
  lookBackDays: 30,
  limits: { perHour: 2, perDay: 6 },
  autoCategories: [],
  digestTime: null,
  notifications: true,
  mix: []
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
  /** When the post was written on the platform; null when the platform did not say (DEC-040). */
  postedAt: IsoTime | null
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

/**
 * Where an opportunity came from (DEC-039). `comment`: a new comment in a discussion the channel reads. `new_post`: a new post by someone else that matches the
 * channel's topics (its reply is a top-level comment on the post, so it has no comment). `reply_to_me`, `mention`: found in the account's inbox. A standalone
 * publication is of no source in this sense and keeps the default, `comment`.
 */
export type OpportunitySource = 'comment' | 'new_post' | 'reply_to_me' | 'mention'

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
  /** What made this opportunity (DEC-039). Rows from before the Feed are `comment`. */
  source: OpportunitySource
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
  /** The post group this is one version of (one post for several channels), or null. Nothing but the group view reads it. */
  groupId: Id | null
  createdAt: IsoTime
  updatedAt: IsoTime
}

// ───────────────────────────── Drafts, approvals, sending (REQ-003, REQ-004) ─────────────────────────────

export type PlanFormat = PlatformContentKind | 'other'

/** One thing to do on a channel, as the AI proposed it. */
export interface ChannelPlanStep {
  title: string
  detail: string
  format: PlanFormat
  /** What the owner has to prepare first (a photo, a short video, a text), or null when nothing. */
  youPrepare: string | null
  frequency: string | null
  /** What the step is, as the content mix knows it (DEC-033); null for a plan made before the mix and for a step that is not a kind of post. */
  kind?: MixKind | 'replies' | null
  /** The rhythm in whole days, when the step has one the mix can use. */
  everyDays?: number | null
}

/**
 * What to do on one channel, written by the AI from the approved passport, the goals and the platform (DEC-013).
 * Suggestions only: nothing in it is done by the application, and nothing is published without the owner's approval.
 */
export interface ChannelPlan {
  generatedAt: IsoTime
  engineId: EngineId
  summary: string
  steps: ChannelPlanStep[]
  watchOut: string[]
}

export interface Attachment {
  name: string
  path: string
  mime: string
  sha256: string
  /** The picture of the media library this file is (DEC-030). A picture placed inside a text is found by it: `![alt](media:<id>)`. */
  mediaId?: Id
}

// ───────────────────────────── Pictures and the post editor (DEC-030) ─────────────────────────────

/** `card`: the template card of a quick post, drawn by the application (DEC-045). */
export type MediaOrigin = 'picked' | 'pasted' | 'dropped' | 'generated' | 'card'

/** The shape of a picture the AI makes: a square one, a wide one (landscape) or a tall one (portrait). */
export type MediaShape = 'square' | 'wide' | 'tall'

/** A picture of a product's library. The file lives in the application's data folder and never changes; a draft that uses it is bound to its bytes. */
export interface MediaItem {
  id: Id
  productId: Id
  name: string
  /** Absolute path inside the data folder. */
  path: string
  mime: string
  sha256: string
  bytes: number
  width: number | null
  height: number | null
  origin: MediaOrigin
  /** What it shows, in the owner's words: the description it was made from, or the alternative text of a picture the owner added. */
  description: string
  createdAt: IsoTime
}

/**
 * How the words of a draft are marked up. `legacy`: the text is sent as it is written (every draft before the editor, every reply, every
 * text the AI wrote). `markdown`: the owner wrote it in the post editor with marks (emphasis, headings, lists, quotes, links) and pictures
 * placed in the text; each platform gets the form it can show (DEC-030).
 */
export type PostMarkup = 'legacy' | 'markdown'

export interface Draft {
  id: Id
  opportunityId: Id
  title: string | null
  text: string
  link: string | null
  attachments: Attachment[]
  /** How the text is marked up (see `PostMarkup`); part of what an approval binds when it is `markdown`. */
  markup: PostMarkup
  /**
   * `article` (every draft before DEC-046) or `quick` (one picture plus a caption; the caption is in `text`, the title is empty). Screens choose their
   * layout by this field, never by guessing from an empty title.
   */
  postType: PostType
  /** The template card of a quick post (DEC-046): what is needed to draw it again. Null when the picture is an illustration or the owner's file, and for an article. */
  card: QuickCard | null
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

/** Who carries out an approved publication: the platform's connector (default), or the AI in the account's own browser (B1). */
export type PublishWith = 'connector' | 'ai_browser'

export interface AppSettings {
  engineId: EngineId | null
  notifications: boolean
  webMode: { enabled: boolean; port: number }
  /**
   * Only for what the owner approved themselves and sends with a click of their own; scheduled and rule-driven sends always use the
   * connector. The approval, the send ticket and the limits are the same either way.
   */
  publishWith: PublishWith
  /** The look of the application (visual-system.md §33): `system` follows macOS (light Daylight, dark Graphite); anything else is a theme of its own. */
  theme: ThemeChoice
  /** A slow glow behind the pages. Off unless the owner turns it on, and never while macOS asks for less motion. */
  animatedBackground: boolean
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
  /** The platform of the channel ("reddit", "facebook"): what the post editor shows the post as, and what a picture needs to be sent. */
  channelPlatform: string
  /** Whether the application reads the channel; a channel it does not read can be posted to only by the AI browser (DEC-035). */
  channelReads: boolean
  accountLabel: string
  comment: Comment | null
  discussion: Discussion | null
  /** Parent chain and nearby comments available as conversation context. */
  thread: Comment[]
  draft: Draft | null
  approval: Approval | null
  lastAction: SendAction | null
}

// ───────────── the AI triage of what a channel shows (DEC-040) ─────────────

/** What the AI made of a post: worth a reply, worth noticing, or not relevant to the product's goal. */
export type FindingLabel = 'reply' | 'notice' | 'skip'

/**
 * `pending`: found but not yet judged (the AI engine was not ready); `title`: judged by its title alone (not relevant: label `skip`; relevant: no label yet,
 * the post waits to be opened and read); `read`: opened and read, and labelled.
 */
export type FindingStage = 'pending' | 'title' | 'read'

/** One post of a channel that was judged once. The owner decides what to do with it; nothing here is ever sent. */
export interface Finding {
  id: Id
  productId: Id
  channelId: Id
  /** The post's id on the platform: a post is judged once per channel. */
  externalId: string
  title: string
  url: string
  author: string
  postedAt: IsoTime | null
  stage: FindingStage
  /** Null while `stage` is `pending`, and also while `stage` is `title` and the post waits to be read (it was judged relevant by its title). */
  label: FindingLabel | null
  /** One line: how the post relates, or does not relate, to the product's goal. Written by the AI from page text; shown as data. */
  relation: string
  /** Found by the look-back of a new channel, not by a later check. */
  firstLook: boolean
  /** The reply opportunity that was opened for it (label `reply`), when there is one. */
  opportunityId: Id | null
  seenAt: IsoTime | null
  createdAt: IsoTime
}

export interface FindingCard {
  finding: Finding
  channelTarget: string
  channelPlatform: string
}

export interface FindingCounts {
  /** Findings labelled `notice` that the owner has not looked at yet. */
  unseenNotices: number
  notices: number
  /** Posts judged not relevant: counted, never listed unless the owner asks. */
  skipped: number
  /** Posts without a label: found but not yet judged, and judged relevant by title but not yet read. */
  pending: number
}

// ───────────── one post for several channels (DEC-032) ─────────────

/** The text the owner wrote once; each channel's version is made from it. */
export interface PostMaster {
  title: string | null
  text: string
  link: string | null
  attachments: Attachment[]
  markup: PostMarkup
  /** Left out in a group made before DEC-046: `article`. */
  postType?: PostType
  card?: QuickCard | null
}

/** A wrapper around ordinary posts: each version is a standalone opportunity of one channel with its own drafts, approval, send and failure. */
export interface PostGroup {
  id: Id
  productId: Id
  master: PostMaster
  createdAt: IsoTime
}

export type SendWay = 'connector' | 'ai_browser'

export interface PostVersion {
  /** The ordinary card of the version: it is edited, approved and sent through the same calls as any post. */
  card: OpportunityCard
  /** What stops this version from fitting its platform as it is (limits, a missing picture), or from being sent now (a paused channel). Empty: nothing. */
  problems: string[]
  /** The owner changed this version by hand: the AI's "Adapt" leaves it alone unless asked to start over. */
  edited: boolean
  /** How it goes out when the owner presses Send: by the connector, or by the AI in the account's browser (the owner's press, never scheduled). */
  way: SendWay
}

export interface PostGroupCard {
  group: PostGroup
  versions: PostVersion[]
}

// ───────────────────────────── Content mix and the owner's own updates (DEC-033) ─────────────────────────────

/** One line the owner wrote about something they did ("What's new"): the only source of an own-update draft. */
export interface ProductUpdate {
  id: Id
  productId: Id
  text: string
  createdAt: IsoTime
  /** The post prepared from it; null while it is unused. */
  usedInOpportunityId: Id | null
  /** How many times the AI could not make a post from it; after 3 it is set aside until the owner rewrites it. */
  failedTries: number
}

export interface MixKindCard extends MixSetting {
  /** When a draft of this kind was last prepared by the mix; null if never. */
  lastDraftAt: IsoTime | null
  /** When the next draft is due (never before now); null while the kind is off. */
  nextAt: IsoTime | null
  /** Why the last attempt did not give a draft, or what stops the next one, in words; null when nothing does. */
  problem: string | null
}

export interface MixCard {
  channelId: Id
  kinds: MixKindCard[]
  /** Posts of this channel waiting for the owner (not approved yet). The mix prepares no draft while this reaches `cap`. */
  waiting: number
  cap: number
  /** Notes not used yet (of the channel's product). */
  unusedUpdates: number
  /** Why the mix cannot run on this channel at all now (observe-only, cannot publish, paused), or null. */
  blocked: string | null
}

/** A channel of the product the post could also go to, and whether it fits there as it is. */
export interface GroupChannelOption {
  channelId: Id
  platform: string
  target: string
  accountLabel: string
  fits: boolean
  /** One line: why it fits, or what is wrong. */
  reason: string
  /** The app suggests it: it fits and is not already chosen. */
  suggested: boolean
}

/** What happened to one version in a group-wide step (adapt, approve, send). */
export interface PostGroupResult {
  opportunityId: Id
  channelLabel: string
  status: 'done' | 'skipped' | 'failed'
  reason: string
}

export interface PostGroupOutcome {
  card: PostGroupCard
  results: PostGroupResult[]
}

export interface ResultsView {
  goals: { productId: Id; productName: string; goals: PromotionGoal[] }[]
  channels: { channel: Channel; metrics: MetricSnapshot[] }[]
  /** Version 1 never measures business conversions; the UI must say so (REQ-006, DEC-002). */
  businessConversions: 'not_measured'
}

/** One reading of one metric. `value` is null where the platform gave none: a missing reading is never drawn as zero. */
export interface MetricPoint {
  capturedAt: IsoTime
  value: number | null
}

/** The readings of one metric of one channel over a period, oldest first (UI-redesign phase C, DEC-037). */
export interface MetricSeries {
  channelId: Id
  key: string
  label: string
  points: MetricPoint[]
}

/** What `results.history` returns: every kept reading of the product's channels inside the period. */
export interface ResultsHistory {
  productId: Id
  days: number
  from: IsoTime
  to: IsoTime
  series: MetricSeries[]
}

/** The path of the product's opportunities that were created in the period: how many reached each step (never rises from one step to the next). */
export interface OverviewFunnel {
  found: number
  drafted: number
  approved: number
  sent: number
}

/** One channel of the product at a glance. */
export interface OverviewChannel {
  channelId: Id
  platform: string
  target: string
  status: ChannelStatus
  /** Opportunities of this channel that wait for the owner (draft, awaiting approval, approved but not sent, needs the owner). */
  waiting: number
  /** Confirmed sends of this channel inside the period. */
  sent: number
  lastSuccessAt: IsoTime | null
  nextCheckAt: IsoTime | null
  /** When the last confirmed send of this channel happened, whenever that was; null if nothing was ever sent. */
  lastSentAt: IsoTime | null
}

/** Confirmed sends of one local day: replies and own posts apart. */
export interface OverviewDay {
  /** The local day, `YYYY-MM-DD`, as the caller's UTC offset puts it. */
  day: string
  posts: number
  replies: number
}

/** What the product's Overview screen shows (UI-redesign phase C, DEC-037). Counts only; nothing here is a prediction. */
export interface OverviewView {
  productId: Id
  days: number
  from: IsoTime
  to: IsoTime
  funnel: OverviewFunnel
  channels: OverviewChannel[]
  /** The product's own attention items, plus the account items that belong to no product. */
  attention: AttentionItem[]
  /** One entry for every day of the period, oldest first (days with nothing sent are zeros: a count of sends is a count, not a reading). */
  activity: OverviewDay[]
}

/** One run of an AI engine for the person to watch (progress of every AI help and mission): what it does, for how long, the latest lines. */
export interface AiTaskState {
  id: Id
  /** What it is in words, e.g. "Proposing a profile". */
  title: string
  engineLabel: string
  /** What it is about (a profile, an account), so the block that started it can show only its own. */
  subject: string | null
  startedAt: IsoTime
  finishedAt: IsoTime | null
  status: 'running' | 'done' | 'failed' | 'stopped'
  /** The latest lines, oldest first. */
  lines: string[]
  error: string | null
}
