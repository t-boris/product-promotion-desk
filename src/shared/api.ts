// The single contract between the UI and the core (DEC-006).
// The UI only ever calls `Transport.invoke` / `Transport.subscribe`; whether that travels over
// Electron IPC or over the loopback HTTP server is invisible to it.

import type {
  AgentReadiness,
  AgentRun,
  AgentTaskKind,
  Account,
  AccountRole,
  BrowserState,
  PageReport,
  Mailbox,
  SignInResult,
  VaultStatus,
  AppInfo,
  AppSettings,
  AttentionItem,
  AutomationState,
  Channel,
  ChannelMode,
  ChannelSettings,
  ChannelSuggestion,
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
  PlatformInfo,
  Product,
  ProductSource,
  PromotionGoalInput,
  ResultsView,
  RoleSuggestion,
  MetricSnapshot,
  Run,
  SavedSiteProfile,
  SiteProfileDraft,
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
  'products.saveGoal': [{ id: Id; goal: PromotionGoalInput }, Product]
  'products.removeGoal': [{ id: Id; goalId: Id }, Product]
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
  /** Every account: they are one library, not tied to a product (DEC-015). */
  'accounts.list': [void, Account[]]
  /** Creates an account with its own login and browser session. `productId` only records what it was created for. */
  'accounts.create': [{ productId?: Id; platform: string; label: string; role?: AccountRole | null; email?: string | null; mailboxId?: Id | null }, Account]
  /** Sets or clears (null) the e-mail address of an account. */
  'accounts.setEmail': [{ accountId: Id; email: string | null; mailboxId?: Id | null }, Account]
  /** An address of its own for a new account on `platform`, made from a base mailbox (an alias), different from every address in use. */
  'accounts.proposeEmail': [{ mailboxId: Id; platform: string }, { address: string }]
  'mailboxes.list': [void, Mailbox[]]
  'mailboxes.add': [{ address: string }, Mailbox]
  /** Removes a base mailbox; the addresses already given to accounts stay. */
  'mailboxes.remove': [{ id: Id }, void]
  /** Sets, changes or removes (null) the role of a login (DEC-010). Name and voice are trimmed and length-limited. */
  'accounts.setRole': [{ accountId: Id; role: AccountRole | null }, Account]
  /** AI ideas for roles and login names for this product, from its approved passport. Nothing is created. */
  'accounts.suggestRoles': [{ productId: Id }, RoleSuggestion[]]
  'accounts.remove': [{ id: Id }, void]
  /** Platforms the application can connect, from the registered connectors (DEC-009). */
  'platforms.list': [void, PlatformInfo[]]
  /** Opens the account's persistent browser at `url` and hands control to the user (login handoff). */
  'accounts.openBrowser': [{ accountId: Id; url?: string }, { tabId: string }]
  /** Who holds the account's browser and whether the person's window is open: the screen shows it instead of failing later. */
  'accounts.browser': [{ accountId: Id }, BrowserState]
  /** Brings the person's open window for the account to the front, without changing the page. `shown` is false when no window is open. */
  'accounts.showBrowser': [{ accountId: Id }, { shown: boolean }]
  /**
   * What the account's page shows and did (DEC-016): its alerts, readable text, a screenshot, the requests it made and the errors
   * of its console. Only when asked. `null` when the account has no page open. A form field's value is never read.
   */
  'accounts.pageReport': [{ accountId: Id }, PageReport | null]
  'agent.canStart': [{ accountId: Id; kind: AgentTaskKind }, AgentReadiness]
  'agent.start': [{ accountId: Id; kind: AgentTaskKind }, AgentRun]
  'agent.state': [{ accountId: Id }, AgentRun | null]
  'agent.stop': [{ accountId: Id }, AgentRun | null]
  'accounts.takeControl': [{ accountId: Id }, void]
  /** Gives the browser back to the app. The person's window, when open, is closed: it would still say that the person is in control. */
  'accounts.releaseControl': [{ accountId: Id }, void]
  'accounts.checkLogin': [{ accountId: Id }, Account]
  // credential vault and assisted sign-in (REQ-012, DEC-014). No result ever carries a password except revealPassword, which the web mode refuses.
  'vault.status': [void, VaultStatus]
  /** Saves the login name and the password of an account. The password goes only to the vault, encrypted by the system keychain. */
  'vault.savePassword': [{ accountId: Id; loginName: string; password: string }, Account]
  'vault.removePassword': [{ accountId: Id }, Account]
  /** Local only: the saved password, for the owner to read. */
  'vault.revealPassword': [{ accountId: Id }, { password: string }]
  /** Local only: puts the saved password on the clipboard and clears it after 30 seconds. */
  'vault.copyPassword': [{ accountId: Id }, void]
  /** Fills the sign-in form of the account's own browser with the saved password, once. A check or an unexpected page stops it. */
  'accounts.signIn': [{ accountId: Id }, SignInResult]
  'channels.list': [{ productId?: Id } | undefined, Channel[]]
  /**
   * Connects a channel of the product through any account of the platform (DEC-015). Fails with `role_exists` when another
   * login of this product on the platform already plays the same role.
   */
  'channels.connect': [{ productId: Id; accountId: Id; target: string }, Channel]
  /** AI ideas for channels of this product, from its approved passport. Unverified; nothing is connected. */
  'channels.preparePlan': [{ channelId: Id }, Channel]
  'channels.suggest': [{ productId: Id }, ChannelSuggestion[]]
  /**
   * Reads the site at `url` through the account's browser (read-only) and has the AI prepare a draft profile for the
   * universal connector. Never saves anything and never fails because the AI could not help: the draft then carries
   * manual `instructions`.
   */
  'channels.draftProfile': [{ productId: Id; accountId: Id; url: string }, SiteProfileDraft]
  /** Re-validates the reviewed definition and stores it as a new version for `host`. Only the owner's screen calls it. */
  'channels.saveProfile': [{ host: string; definition: unknown }, SavedSiteProfile]
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

/** Methods that return a secret: served over Electron IPC only, never over the loopback web mode (DEC-014). */
export const LOCAL_ONLY_METHODS: ReadonlySet<string> = new Set<ApiMethod>(['vault.revealPassword', 'vault.copyPassword'])
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
