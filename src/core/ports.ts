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
  PageReport,
  VaultUnavailable
} from '../shared/types'
import type { McpLaunch } from './mcp/protocol'

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

// ───────────────────────────── AI engines ─────────────────────────────

export interface AiTask {
  /** Short label for logs, e.g. "passport.synthesize". */
  label: string
  /** What the progress panel calls this run, in words; without it the panel uses the label's usual name. */
  title?: string
  /** What this run is about (a profile id, an account id): the block that started it shows only its own runs. */
  subject?: string
  prompt: string
  system?: string
  /** Working directory for the engine process; read-only analysis only. */
  cwd?: string
  timeoutMs?: number
  /**
   * An agent run (DEC-018): the engine owns a goal and works for as long as it needs by calling the tools of this MCP server. It then runs with
   * FULL ACCESS, as the owner decided (like MarkView's agents). Without it the engine only answers with text, and a tool-free engine has no tools.
   */
  agent?: {
    server: string
    launch: McpLaunch
    /**
     * The post mission (B1): the engine has no power but the tools of this MCP server (no shell, no files, no web of its own), and nothing it
     * prints on a failure is put into an error message (a failure says only that the engine failed and its exit code): what an engine prints
     * can echo the pages it worked on, and an error message reaches the log and the owner's lists. An engine that cannot be held to the
     * tools (`confinesAgent` is not true) is never given `confined`: it refuses it, and the application does not ask (the owner decided on
     * 2026-11-20 that any selected agent may work the browser). Without it the run has full access, as in DEC-018.
     */
    confined?: boolean
    /**
     * The mission works pages of strangers or publishes (post, join, watch, research): nothing the engine or the system printed is put into an
     * error message, whatever the engine can be held to. Set for every such mission, so a run with full access leaks no page text either.
     */
    quiet?: boolean
  }
  /**
   * The engine may create files in this folder and nowhere else (the sandbox allows writing in it): the pictures of account profiles (DEC-019),
   * made with the engine's own image tool. Only an engine with `makesImages` accepts it.
   */
  makeFiles?: { dir: string }
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
  /** True when the engine can run an agent mission (`AiTask.agent`): it works the application's browser through the MCP server it is given. */
  readonly supportsAgent?: boolean
  /**
   * True when an agent run can be held to the tools of the application's MCP server and nothing else (`AiTask.agent.confined`): the engine
   * has no shell, no file access and no web of its own. Only such an engine may publish for the owner (the post mission).
   */
  readonly confinesAgent?: boolean
  /** True when the engine can make a picture with its own image tool (`AiTask.makeFiles`). */
  readonly makesImages?: boolean
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

/** The owner explicitly took control of the account's browser (DEC-038): the AI stops using it until control is given back. Opening a window does not do this. */
export class TakeoverError extends Error {
  constructor(message = 'The user has taken control of the browser; automation stopped interacting.') {
    super(message)
    this.name = 'TakeoverError'
  }
}

/**
 * The owner did something in the account's session that can change who is signed in (DEC-038): a sign-in or sign-out page was used in one of their
 * windows. A write that needs a ticket is refused with this before it reaches the page, so nothing is submitted; the next sign-in check decides what is true.
 */
export class SessionChangedError extends Error {
  constructor(message = 'The account\'s sign-in may have changed while the app worked (a sign-in or sign-out page was used in the account\'s browser). Nothing was submitted.') {
    super(message)
    this.name = 'SessionChangedError'
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

/**
 * One thing a person does on a page (DEC-017): type into a field, choose in a list, press a button or a key. `ref` is the label the
 * page snapshot gave the element ("e12"), never a selector. `text` of a `type` step may be a password: it is never logged.
 */
export type PageStep =
  | { do: 'type'; ref: string; text: string }
  | { do: 'select'; ref: string; text: string }
  /** Puts a file (an absolute path, one the application chose) into a file input: a script cannot do this, the browser's own protocol does. */
  /** `path` goes into the input; `also` goes in with it, in one step (a file input holds the files of its last step, so several pictures go in together). */
  | { do: 'upload'; ref: string; path: string; also?: string[] }
  /** `still`: press only where the pointer already rests on the element (a `hover` was made); never scroll, glide or aim again. Nothing is waited for. */
  | { do: 'click'; ref: string; still?: boolean }
  | { do: 'key'; key: 'Enter' | 'Tab' | 'Escape' }
  /** The mouse wheel, as a person scrolls: down or up by most of a screen (`screen`) or half of one (`half`), in small smooth turns, over the middle of the page. */
  | { do: 'scroll'; direction: 'down' | 'up'; amount: 'screen' | 'half' }
  /** The pointer glides to an element and rests on it, with no press: a person points before pressing, and what must be seen before a press is seen first. */
  | { do: 'hover'; ref: string }

/**
 * `done`: carried out. `wrong_host`: the page is not one of `hosts`. `not_found`: no such element (the page changed). These two are answered
 * before any input reaches the page, so they say that nothing was done. `refused`: the element cannot take it (disabled, not a list, not a
 * field), or a click could not be confirmed: it may follow input that already landed (a mouse press, then a page that replaced its own
 * document), so a caller that must know whether a click happened (a press that publishes) cannot read "nothing happened" from it.
 */
export type PageStepStatus = 'done' | 'wrong_host' | 'not_found' | 'refused'

export interface PageStepResult {
  status: PageStepStatus
  /** What happened, in words, without the typed text. */
  detail: string
}

/** Where passwords are kept (DEC-014): encrypted by the operating system, never in the database. The core never sees how. */
export interface SecretStore {
  /**
   * Whether the system can encrypt now. This asks the keychain, and macOS may show a prompt for it, so only a save, a reveal or a
   * sign-in calls it. It is asynchronous so that an open prompt does not stop the application.
   */
  available(): Promise<boolean>
  /** Why the vault is known not to work, from the last real attempt; null while it worked or nobody has tried. Never asks the keychain. */
  blocked(): VaultUnavailable | null
  /** Whether a value is stored under the key. Reads the vault file only, never the keychain, so it never prompts. */
  has(key: string): boolean
  /** The value, or null when none is stored. Throws `SecretOpenError` when one is stored and cannot be opened. */
  get(key: string): Promise<string | null>
  /** Throws if the vault is unavailable; nothing is ever stored in plain text. */
  set(key: string, value: string): Promise<void>
  delete(key: string): void
}

/**
 * A value is stored but cannot be opened. `blocked` says why when the whole vault is unusable (macOS refused the app its keychain item, or
 * there is no keychain); it is null when the keychain answered and only this value cannot be read (it was made with another key).
 */
export class SecretOpenError extends Error {
  readonly blocked: VaultUnavailable | null
  constructor(blocked: VaultUnavailable | null) {
    super('A stored value cannot be opened.')
    this.name = 'SecretOpenError'
    this.blocked = blocked
  }
}

/** Puts a secret on the clipboard for a limited time. Supplied by the main process. */
export interface SecretClipboard {
  copy(text: string, clearAfterMs: number): void
}

export interface BrowserPage {
  /**
   * Fills the sign-in form with the credentials and submits it once. One of two write-class operations that need no
   * SendTicket (the other is `pageStep`): it publishes nothing, only the vault's owner reaches it, and it refuses a page outside `form.hosts`.
   * A page that has not drawn its form yet is given some seconds before the answer is "no_form".
   */
  signIn(form: SignInForm): Promise<{ status: SignInStatus }>
  /**
   * The second write-class operation that needs no SendTicket (DEC-017): one step of the browser agent. It is for work that
   * publishes nothing (signing up, signing in, looking around, setting up a profile): whatever can publish goes through a
   * connector with a ticket, or through `publishStep`. It refuses a page outside `hosts` and works only on an element the page snapshot
   * labelled. Typing and clicking use the browser's own input, as a person's hands would.
   */
  pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult>
  /**
   * The same step as `pageStep`, but it needs a valid SendTicket of this account (REQ-004): the way the AI browser puts the approved
   * content into a form and presses the control that publishes it. The guard refuses it without a genuine, unexpired, unused ticket;
   * the caller (the post mission, see mission-publisher.ts) holds the ticket and has checked that it is bound to exactly this content.
   */
  publishStep(step: PageStep, hosts: string[], ticket: SendTicket): Promise<PageStepResult>
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

/**
 * One piece of the AI's work that goes on across several calls and keeps one page and one window for all of them (a mission: the AI looks at a
 * place, then follows a link, then reads). Opened by `BrowserSession.task`; the page is the task's alone, so nothing else the AI does for the
 * account (another channel's check, a login check) moves it, and it is closed, with its window, when the task ends.
 */
export interface AgentTask {
  /** One turn of the task, on the task's own page (made on the first turn). Turns of the account are serialized; rejects with TakeoverError like `withAgentControl`. */
  withAgentControl<T>(work: (page: BrowserPage) => Promise<T>): Promise<T>
  /** Makes the task's page now and shows its window to the owner without taking the focus (a failure to show it is not a failure of the task). */
  show(): Promise<void>
  /** Closes the task's page and window. Safe to call twice; the task takes no more turns. */
  close(): Promise<void>
}

/**
 * One persistent browser identity (cookies, storage) per account (DEC-038). Every call the AI makes works in a page of its own on that session
 * and closes it again; the owner may have any number of windows on the same session at the same time, and none of them takes the browser from the
 * AI. Only an explicit `takeControl` (the owner wants to finish something in the AI's page) makes the AI wait.
 */
export interface BrowserSession {
  readonly accountId: Id
  control(): { holder: 'agent' | 'user' | 'none'; owner: string | null }
  /**
   * Runs `work` as one call of the AI, in a page made for this call alone and closed when it ends, so that a call for one channel never finds
   * the page of another. Turns of the same account are serialized (one at a time); rejects with TakeoverError when the owner explicitly took control,
   * and in-flight page calls reject once they do. An owner window does not do either.
   */
  withAgentControl<T>(owner: string, work: (page: BrowserPage) => Promise<T>): Promise<T>
  /** A piece of work of several calls on one page of its own (a mission); `owner` labels its turns. */
  task(owner: string): AgentTask
  /** Brings the windows of the open tasks to the front (the owner acts in the very page the AI waits on). Windows of calls are not shown. */
  revealTasks(focus: boolean): Promise<void>
  /** Closes every open task's page: the account is let go of or erased. */
  closeTasks(): Promise<void>
  /** The owner explicitly takes the AI's own page: the AI stops interacting with it until `releaseControl`. */
  takeControl(): void
  releaseControl(): void
  /**
   * How many times the owner did something in the session that can change who is signed in (DEC-038). A caller that checked the sign-in
   * remembers the number, and asks again before it submits: a different number means the check is out of date.
   */
  identityEpoch(): number
}

/** The page the owner is on, as the browser reports it (DEC-028, DEC-038). */
export interface OwnerPage {
  url: string
  title: string
  /** How many pages the owner has in view when nobody can tell which one they are on (more than one); absent when the page is known. */
  tabs?: number
}

/** What a prepared connector says about finding and naming its channels (DEC-028). */
export interface ChannelGuide {
  /** A page of the platform where channels are listed or searched; opened in the account's own browser. */
  browseUrl: string
  /** A typical channel address, shown as the placeholder of the address field. */
  example: string
  /** One sentence: what to give as the channel address and what is refused. */
  hint: string
}

/**
 * Whether the account has joined a channel (DEC-029). `member` is null when the platform did not say. `access` is how the community
 * admits people: `private` and `restricted` ones are not joined by pressing a button.
 */
export interface Membership {
  member: boolean | null
  banned: boolean
  access: 'open' | 'restricted' | 'private' | 'unknown'
}

export interface BrowserService {
  session(account: Account): BrowserSession
  /**
   * Opens a window of the account's own session for the owner at `url` (DEC-038). It is an additional window: the AI keeps working in its own page,
   * nothing waits and nobody takes control. A window that already shows that address is brought to the front instead of being opened again.
   */
  openForUser(account: Account, url?: string): Promise<{ tabId: string }>
  /**
   * Optional (DEC-018): shows the windows of the AI's open tasks of the account, so the owner acts in the very page the AI waits on. A window is
   * shown without taking the focus unless `focus` is set: that brings it in front of the owner's other windows, and the owner asked for it.
   */
  showAgentBrowser?(account: Account, focus?: boolean): void
  /**
   * Set by the core: called when the owner's first window of an account has opened or its last one has closed, so the screen follows and the
   * account's sign-in is looked at once when the owner is done.
   */
  onUserWindowChange?: (accountId: Id, change: 'opened' | 'closed') => void
  /**
   * Set by the core: a request of the account's page failed or was refused by the site (host, path and status only). Throttled, so a
   * page that keeps failing is one line in the log, not hundreds.
   */
  onPageNote?: (accountId: Id, note: string) => void
  /** Optional (DEC-026): whether the owner's Google Chrome is installed, so that it can be chosen for an account. */
  chromeFound?(): boolean
  /** Optional (DEC-026): lets go of the page and the window kept for an account, without erasing its session; called when the account moves to the other browser. */
  releaseAccount?(account: Account): Promise<void>
  /**
   * Optional (DEC-028, DEC-038): the address and title of the page the owner was last on in their windows of the account, as the browser reports
   * them; null when the owner has no window. Nothing is read from the page itself (no text, no picture; the only script is a fixed one that asks
   * whether a tab is showing, run in Chrome when the owner has more than one tab). The core strips the address down to what may be shown.
   * `tabs` is set when more than one page is showing and the browser cannot tell which one the owner is on: the core then refuses to guess.
   */
  ownerPage?(account: Account): Promise<OwnerPage | null>
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

/**
 * One thing the platform put in the account's inbox (DEC-039): somebody replied to the account (`reply_to_me`) or named it (`mention`). The comment is the
 * one that was written to or about the account; the discussion is the thread it is in, as far as the inbox says (its post and its other comments are read
 * with `fetchThread`). `discussionExternalId` is the id `fetchThread` takes.
 */
export interface RemoteInboxItem {
  kind: 'reply_to_me' | 'mention'
  discussionExternalId: string
  discussionUrl: string
  discussionTitle: string
  comment: RemoteComment
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
  /** Optional (DEC-028): where channels of the platform are found, and what an address of one looks like. Absent when the connector knows none. */
  channelGuide?(): ChannelGuide
  /** Optional (DEC-029): reads, without changing anything, whether the account has joined the channel. Absent when the platform has no such thing. */
  membership?(ctx: ConnectorContext): Promise<Membership>
  /**
   * Optional (DEC-034): whether this connector can read the channel at all. Absent means it can. The universal connector reads only a site it
   * has a valid site profile for; for any other channel it can neither read nor reply, and the channel is only for the owner's own posts.
   */
  readsChannel?(channel: Channel): boolean
  checkLogin(ctx: ConnectorContext): Promise<LoginState>
  /** Inspects the channel without publishing anything. Only actually verified capabilities may be 'verified'. */
  assess(ctx: ConnectorContext): Promise<Capability[]>
  /** Recent discussions with their comments, newest first. */
  fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch>
  fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null>
  /**
   * Optional (DEC-040): the posts of the channel written since `since`, newest first, at most `max`, each WITHOUT its comments (`comments` is empty): a cheap
   * list the AI triage judges by title. Read-only. Absent means the connector cannot list a channel's posts, so no triage is made for it. A post whose
   * `postedAt` is null is never older than `since` as far as the list can tell and is kept.
   */
  listPosts?(ctx: ConnectorContext, options: { since: IsoTime; max: number }): Promise<RemoteDiscussion[]>
  /**
   * Optional (DEC-039): what is in the account's inbox that belongs to the channel (replies to the account's comments and posts, mentions of it),
   * newest first, at most `limit`. Read-only, through the account's signed-in session; it changes nothing on the platform (nothing is marked as read).
   * Absent means the platform has no inbox the app can read: the channel's `read_inbox` capability says so, and no reply or mention is collected.
   */
  readInbox?(ctx: ConnectorContext, options?: { limit: number }): Promise<RemoteInboxItem[]>
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

/**
 * Makes a smaller copy of a picture, for a site that refuses a picture for its size. The core has no image tools of its own (and no
 * Electron): the main process supplies this with Electron's own image support. The original is never changed.
 */
export interface ImageShrinker {
  /** Writes a copy of the image no larger than `maxBytes` into `outDir` and returns its path; rejects when it cannot be made that small. */
  shrink(source: string, maxBytes: number, outDir: string): Promise<string>
}

/**
 * What the post editor needs from the operating system and cannot get without Electron (DEC-005): the file dialog, a small copy of a
 * picture for the screen and the file manager. The main process supplies this; without it the core still works (no dialog, the whole file
 * is shown as the thumbnail when it is small).
 */
export interface MediaTools {
  /** Opens the system's file dialog for pictures; the absolute paths the owner chose, or an empty list when the dialog was closed. */
  pick(): Promise<string[]>
  /** A copy of the picture whose longest side is at most `side` pixels, as a data address. */
  thumbnail(path: string, side: number): Promise<string>
  /** Shows the file in the system's file manager. */
  reveal(path: string): void
}

