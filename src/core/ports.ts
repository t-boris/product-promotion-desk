// Ports: the interfaces the core depends on. Implementations live in src/ai, src/connectors and
// src/browser (Electron). The core never imports Electron (DEC-005), so everything here is testable
// with fakes.

import type {
  Account,
  Attachment,
  Capability,
  Channel,
  EngineId,
  EngineStatus,
  Id,
  IsoTime,
  MetricReading,
  PageReport
} from '../shared/types'

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

// ───────────────────────────── AI engines ─────────────────────────────

export interface AiTask {
  /** Short label for logs, e.g. "passport.synthesize". */
  label: string
  prompt: string
  system?: string
  /** Working directory for the engine process; read-only analysis only. */
  cwd?: string
  timeoutMs?: number
}

export type AiErrorKind = 'unavailable' | 'failed' | 'cancelled' | 'timeout' | 'invalid_output'

export class AiError extends Error {
  readonly kind: AiErrorKind
  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
  }
}

export interface AiRunOptions {
  signal?: AbortSignal
  onProgress?: (message: string) => void
}

/** An installed command-line AI engine (Codex or Claude Code). It only returns text: it holds no sending tools. */
export interface AiEngine {
  readonly id: EngineId
  readonly label: string
  /**
   * True only when the adapter can guarantee the engine has no tools at all (cannot read files, run commands or
   * browse). Automatic replies are allowed only with a tool-free engine, because comment text is untrusted input.
   */
  readonly toolFree: boolean
  check(): Promise<EngineStatus>
  /** Resolves with the final text. A failure of the engine process rejects with AiError and never crashes the app. */
  run(task: AiTask, options?: AiRunOptions): Promise<string>
}

// ───────────────────────────── Authorization tickets (REQ-004) ─────────────────────────────

/**
 * Proof, issued by the SendGate only, that one specific outgoing action has been authorized.
 * Connectors and the browser service refuse write-class operations without a valid ticket,
 * so an AI instruction alone can never cause a publication.
 */
export interface SendTicket {
  readonly id: string
  readonly actionId: Id
  readonly contentHash: string
  readonly accountId: Id
  readonly destination: string
  /** Epoch milliseconds. */
  readonly expiresAt: number
  readonly signature: string
}

export interface TicketVerifier {
  /** Throws TicketError unless the ticket is genuine, unexpired, unused for another action and matches `expect`. */
  assertValid(ticket: SendTicket, expect?: Partial<Pick<SendTicket, 'accountId' | 'destination' | 'contentHash'>>): void
}

export class TicketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TicketError'
  }
}

// ───────────────────────────── Browser ─────────────────────────────

export class TakeoverError extends Error {
  constructor(message = 'The user has taken control of the browser; automation stopped interacting.') {
    super(message)
    this.name = 'TakeoverError'
  }
}

/** What the sign-in step needs: the credentials and the hosts of the platform whose page may receive them. */
export interface SignInForm {
  username: string
  password: string
  /** Only a page on one of these hosts (or a subdomain) is filled; anything else is refused inside the page itself. */
  hosts: string[]
}

export type SignInStatus = 'submitted' | 'next_step' | 'no_form' | 'captcha' | 'wrong_host'

/** Where passwords are kept (DEC-014): encrypted by the operating system, never in the database. The core never sees how. */
export interface SecretStore {
  /** False when the system cannot encrypt: nothing can then be stored. */
  available(): boolean
  has(key: string): boolean
  get(key: string): string | null
  /** Throws if the vault is unavailable; nothing is ever stored in plain text. */
  set(key: string, value: string): void
  delete(key: string): void
}

/** Puts a secret on the clipboard for a limited time. Supplied by the main process. */
export interface SecretClipboard {
  copy(text: string, clearAfterMs: number): void
}

export interface BrowserPage {
  /**
   * Fills the sign-in form with the credentials and submits it once. It is the only write-class operation that needs no
   * SendTicket: it publishes nothing, only the vault's owner reaches it, and it refuses a page outside `form.hosts`.
   * A page that has not drawn its form yet is given some seconds before the answer is "no_form".
   */
  signIn(form: SignInForm): Promise<{ status: SignInStatus }>
  goto(url: string, options?: { timeoutMs?: number }): Promise<void>
  url(): Promise<string>
  /** Evaluates a read-only script in the page and returns its JSON-serializable result. */
  read<T>(script: string): Promise<T>
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>
  /** Write-class actions need a valid SendTicket. */
  fill(selector: string, text: string, ticket: SendTicket): Promise<void>
  click(selector: string, ticket: SendTicket): Promise<void>
  uploadFile(selector: string, path: string, ticket: SendTicket): Promise<void>
}

/** One persistent browser identity (cookies, storage) per account. Control is held by exactly one party. */
export interface BrowserSession {
  readonly accountId: Id
  control(): { holder: 'agent' | 'user' | 'none'; owner: string | null }
  /**
   * Runs `work` with exclusive agent control. Runs for the same account are serialized; rejects with
   * TakeoverError when the user holds control, and in-flight page calls reject once the user takes over.
   */
  withAgentControl<T>(owner: string, work: (page: BrowserPage) => Promise<T>): Promise<T>
  /** The user takes the browser: the agent stops interacting with the tab. */
  takeControl(): void
  releaseControl(): void
}

export interface BrowserService {
  session(account: Account): BrowserSession
  /** Shows the account's browser to the user at `url` (login handoff) and gives them control. */
  openForUser(account: Account, url?: string): Promise<{ tabId: string }>
  /**
   * Set by the core: called when the person's window for an account has opened or closed, so the screen shows who holds the
   * browser and the account is looked at once when the person is done.
   */
  onUserWindowChange?: (accountId: Id, change: 'opened' | 'closed') => void
  /**
   * Set by the core: a request of the account's page failed or was refused by the site (host, path and status only). Throttled, so a
   * page that keeps failing is one line in the log, not hundreds.
   */
  onPageNote?: (accountId: Id, note: string) => void
}

/** Optional capability of a browser service (DEC-016): what an account's page shows and did, when the owner asks. */
export interface PageObserver {
  pageReport(account: Account): Promise<PageReport | null>
}

// ───────────────────────────── Connectors (REQ-002) ─────────────────────────────

export interface ConnectorContext {
  channel: Channel
  account: Account
  session: BrowserSession
  tickets: TicketVerifier
  clock: Clock
}

export interface RemoteComment {
  externalId: string
  parentExternalId: string | null
  author: string
  body: string
  url: string
  postedAt: IsoTime | null
}

export interface RemoteDiscussion {
  externalId: string
  url: string
  title: string
  author: string
  body: string
  postedAt: IsoTime | null
  comments: RemoteComment[]
  /** Thread no longer accepts replies (locked or archived); the SendGate refuses to send into it. */
  locked?: boolean
  archived?: boolean
  /**
   * The connector could not read the whole thread (e.g. unexpanded "load more" stubs). The SendGate must not
   * conclude "no reply by the account exists" from an incomplete snapshot.
   */
  incomplete?: boolean
}

export interface ActivityBatch {
  discussions: RemoteDiscussion[]
  fetchedAt: IsoTime
}

export interface PublishRequest {
  kind: 'post' | 'reply'
  /** Channel URL for posts; comment URL for replies. */
  destination: string
  /** Platform id of the comment/post being replied to. */
  parentExternalId: string | null
  title: string | null
  text: string
  link: string | null
  attachments: Attachment[]
  /** When the attempt being reconciled started; findPublished must ignore anything created before it. */
  attemptedAt?: IsoTime
}

export type PublishOutcome =
  | { status: 'confirmed'; url: string; externalId: string }
  /** Definitely not published (e.g. rejected before submission): safe to try again later. */
  | { status: 'failed'; error: string }
  /** Submitted but not confirmed: blocks any further attempt until reconciled. */
  | { status: 'unknown'; error: string }

export interface PublishedRef {
  url: string
  externalId: string
}

export interface LoginState {
  loggedIn: boolean
  identity: string | null
  captcha: boolean
  /** What the check saw ("a password field is shown", "a visible check on the page (…)"), for the log: a wrong reading cannot be told from a right one without it. */
  signal?: string
}

export interface NormalizedTarget {
  /** Short channel address, e.g. "r/astrology". */
  target: string
  url: string
}

/**
 * Optional capability of a connector that works from declarative site profiles (the universal connector). It lets the
 * core validate, store and describe profiles without importing the connector's code. Profiles are data, never code.
 */
export interface ProfileAuthoring {
  /** Plain description of the profile format and its rules, given to the AI so its draft matches the validator. */
  describeFormat(): string
  /** Validates a definition without storing it. `host` is read from the definition when present. */
  validateDefinition(definition: unknown): { valid: boolean; errors: string[]; summary: string[]; host: string | null }
  /** Stores a definition as a new version for `host` (invalid ones are kept with their errors but never used). */
  saveDefinition(host: string, definition: unknown): { id: Id; host: string; version: number; valid: boolean; errors: string[] }
  /** Whether a valid profile already exists for this host (or its parent domain). */
  hasValidProfile(host: string): boolean
  /**
   * The item selectors the definition relies on for the page at `url`: discussion items on any page, comment items only
   * on pages the profile calls discussion pages. The core counts them (read-only) on pages it really read, so an AI draft
   * whose selectors match nothing is never presented as a valid profile.
   */
  partsOnPage?(definition: unknown, url: string): { discussions: string | null; comments: string | null }
}

export interface Connector {
  readonly id: string
  readonly platform: string
  readonly version: string
  /** Display name, e.g. "Reddit". When absent the platform key is capitalized. */
  readonly label?: string
  /** Present only on connectors driven by declarative site profiles (named to avoid clashing with their own stores). */
  readonly authoring?: ProfileAuthoring
  /** Whether this connector recognizes the address (URL or short form). */
  matches(input: string): boolean
  normalizeTarget(input: string): NormalizedTarget
  /** Platform page where the user signs in. */
  loginUrl(): string
  /** Platform page where a new account is registered (DEC-015). Absent when the connector does not know one. */
  signupUrl?(): string
  checkLogin(ctx: ConnectorContext): Promise<LoginState>
  /** Inspects the channel without publishing anything. Only actually verified capabilities may be 'verified'. */
  assess(ctx: ConnectorContext): Promise<Capability[]>
  /** Recent discussions with their comments, newest first. */
  fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch>
  fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null>
  fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]>
  /** Performs one publication attempt. Requires a valid ticket for exactly this request. */
  publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome>
  /** Looks for an own publication matching the request, used to resolve an 'unknown' outcome. */
  findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null>
}

export interface ConnectorRegistry {
  list(): Connector[]
  get(id: string): Connector | undefined
  /** Finds the connector that recognizes `input`; falls back to the universal connector. */
  resolve(input: string): Connector | undefined
  register(connector: Connector): void
}
