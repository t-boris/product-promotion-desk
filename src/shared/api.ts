// The single contract between the UI and the core (DEC-006).
// The UI only ever calls `Transport.invoke` / `Transport.subscribe`; whether that travels over
// Electron IPC or over the loopback HTTP server is invisible to it.

import type {
  AgentAsk,
  AiTaskState,
  AgentLesson,
  AgentReadiness,
  AgentRun,
  AgentTaskKind,
  Account,
  Profile,
  AccountRole,
  ProfileFields,
  BrowserChoice,
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
  GroupChannelOption,
  MixCard,
  MixSetting,
  PostGroupCard,
  ProductUpdate,
  PostGroupOutcome,
  ChannelMode,
  ChannelSettings,
  ChannelSuggestion,
  GoalIdea,
  AssistField,
  DraftCheckResult,
  DraftHelpField,
  DraftHelpResult,
  Claim,
  ClaimKind,
  ClaimSourceRef,
  ClaimStatus,
  Attachment,
  Discussion,
  MediaItem,
  MediaOrigin,
  MediaShape,
  PostMarkup,
  EngineId,
  EngineModel,
  EngineStatus,
  HistoryEntry,
  Id,
  IsoTime,
  LogEvent,
  LogLevel,
  OpportunityCard,
  FindingCard,
  FindingComment,
  FindingCounts,
  FindingLabel,
  OpportunityKind,
  OpportunitySource,
  OpportunityState,
  PassportSection,
  PassportVersion,
  PassportView,
  PlatformInfo,
  Product,
  ProductSource,
  PromotionGoalInput,
  ResultsHistory,
  ResultsView,
  RoleSuggestion,
  MetricSnapshot,
  Run,
  SavedSiteProfile,
  SiteProfileDraft,
  SourceKind,
  SourceScope,
  AnalysisStage,
  OverviewView
} from './types'
import type { PostType, QuickCard } from './quick-post'
import type { QuickAssessArgs, QuickAssessment, QuickCaptionArgs, QuickCaptionResult, QuickPictureArgs, QuickPictureResult, QuickTrendsArgs, QuickTrendsResult } from './quick-ai'

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
  /** `markdown` for a post written in the post editor; left out, the draft is `legacy` (the text is sent as it is written). */
  markup?: PostMarkup
  /**
   * `quick` for a post written in the quick-post composer (one picture, a caption in `text`, no title; DEC-046), `article` for the long form. Left out on
   * a draft that replaces an earlier one, it keeps that draft's type (editing never changes the type); on a first draft it is `article`.
   */
  postType?: PostType
  /** The template card parameters of a quick post whose picture is a card; null when it is not. Left out on a replacing draft, the earlier draft's card stays. */
  card?: QuickCard | null
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
  /** The models the engine offers (the engine's own list, kept until the next re-check). */
  'engines.models': [{ id: EngineId }, EngineModel[]]
  /** The model an engine is asked for: empty for the engine's own default, otherwise one the engine offers. */
  'engines.setModel': [{ id: EngineId; model: string }, AppSettings]

  // products and passports (REQ-001)
  'products.list': [void, Product[]]
  'products.create': [{ name: string; websiteUrl?: string; description?: string }, Product]
  'products.update': [{ id: Id; name?: string; websiteUrl?: string | null; description?: string | null; addSiteLink?: boolean }, Product]
  'products.delete': [{ id: Id }, void]
  'products.saveGoal': [{ id: Id; goal: PromotionGoalInput }, Product]
  'products.removeGoal': [{ id: Id; goalId: Id }, Product]
  'sources.add': [{ productId: Id; kind: SourceKind; ref: string; label?: string; scope?: SourceScope | null }, ProductSource]
  /**
   * Corrects a source in place (BUG-034): the same checks as sources.add, the kind stays, and the id and the date it was
   * added are kept, so the statements that cite it keep their source. Refuses a source that mirrors the product's website
   * or description (`invalid_state`: those change with products.update) and a copy of another source (`conflict`).
   */
  'sources.update': [{ id: Id; ref: string; label?: string; scope?: SourceScope | null }, ProductSource]
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
  'accounts.create': [{ productId?: Id; platform: string; label: string; role?: AccountRole | null; email?: string | null; mailboxId?: Id | null; profileId?: Id | null; signsInVia?: Id | null }, Account]
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
  /**
   * Any address a screen links to, opened in the app's own browser, never in the system's. The account: the one named, else the channel's, else one whose
   * platform owns the address, else any; refused only when there is no account at all.
   */
  'accounts.openAddress': [{ url: string; accountId?: Id; channelId?: Id }, { tabId: string }]
  /** Opens the account's own browser where channels of its platform are found: on `address` when a connector reads it as a channel, else on the platform's browse page (DEC-028). */
  'accounts.browseChannels': [{ accountId: Id; address?: string }, { tabId: string }]
  /** The address (no query, no fragment, no credentials) and title of the page open in the owner's window of the account; `trimmed` says that something was cut from the address. Null when no window is open. Refused with a sentence when several tabs are open or the page is not a web page. Nothing else is read. */
  'accounts.currentPage': [{ accountId: Id }, { url: string; title: string; trimmed: boolean } | null]
  /** Who holds the account's browser and whether the person's window is open: the screen shows it instead of failing later. */
  'accounts.browser': [{ accountId: Id }, BrowserState]
  /** Brings the person's open window for the account to the front, without changing the page. `shown` is false when no window is open. */
  'accounts.showBrowser': [{ accountId: Id }, { shown: boolean }]
  /**
   * What the account's page shows and did (DEC-016): its alerts, readable text, a screenshot, the requests it made and the errors
   * of its console. Only when asked. `null` when the account has no page open. A form field's value is never read.
   */
  'accounts.pageReport': [{ accountId: Id }, PageReport | null]
  /** `channelId` names the channel of a `join` task (required for it, refused for the other kinds). */
  'agent.canStart': [{ accountId: Id; kind: AgentTaskKind | 'watch'; channelId?: Id }, AgentReadiness]
  'agent.start': [{ accountId: Id; kind: AgentTaskKind; channelId?: Id }, AgentRun]
  'agent.state': [{ accountId: Id }, AgentRun | null]
  'agent.stop': [{ accountId: Id }, AgentRun | null]
  /** The owner answers the AI's question (the pop-up): a text, or "done" for "I did it". */
  /** Brings the browser the AI works in to the front, for the owner to act in the page the AI waits on (a CAPTCHA). */
  'agent.showBrowser': [{ accountId: Id }, { shown: boolean }]
  /** The profiles (DEC-019): people made once for a purpose; their accounts are the logins on platforms. */
  'profiles.list': [void, Profile[]]
  'profiles.get': [{ id: Id }, Profile]
  /** A new empty profile: the owner names it, says what it is for and may name accounts the person already has (they are taken into the profile); the AI proposes the person afterwards, fitting those accounts. */
  'profiles.create': [{ label: string; productId?: Id | null; platforms?: string[]; purpose?: string; accountIds?: Id[] }, Profile]
  /** The AI proposes the whole person as a strategy for a purpose (a proposal only; the owner approves). */
  'profiles.propose': [{ id: Id; purpose?: string }, Profile]
  'profiles.save': [{ id: Id; profile: ProfileFields; label?: string; purpose?: string; role?: AccountRole | null; platforms?: string[]; productId?: Id | null }, Profile]
  'profiles.approve': [{ id: Id }, Profile]
  'profiles.remove': [{ id: Id }, void]
  'profiles.makePicture': [{ id: Id }, Profile]
  'profiles.setPicture': [{ id: Id; path: string }, Profile]
  'profiles.picture': [{ id: Id }, { dataUrl: string } | null]
  /** What the AI learned from the owner's answers (and the rules the owner wrote): one list, for every platform or one. */
  'lessons.list': [void, AgentLesson[]]
  'lessons.add': [{ rule: string; platform?: string | null }, AgentLesson]
  'lessons.save': [{ id: Id; rule?: string; platform?: string | null; enabled?: boolean }, AgentLesson]
  'lessons.remove': [{ id: Id }, void]
  'accounts.setProfile': [{ accountId: Id; profileId: Id | null }, Account]
  /** Renames an account: the name the owner sees in lists and headers. Same rules as at creation. */
  'accounts.rename': [{ accountId: Id; label: string }, Account]
  /** Chooses the browser the account works in (DEC-026). Refused while the AI works on it or the owner holds its browser, and for Chrome when Chrome is not installed. */
  'accounts.setBrowser': [{ accountId: Id; browser: BrowserChoice }, Account]
  /** Changes the account this one signs in through (DEC-027): a Threads account through an Instagram account. */
  'accounts.setSignInVia': [{ accountId: Id; viaAccountId: Id }, Account]
  'agent.answer': [{ accountId: Id; answer: string }, AgentRun | null]
  /** Every question an AI is waiting on now, for the pop-up that appears on any screen. */
  'agent.questions': [void, AgentAsk[]]
  /** The AI runs now and those that ended in the last minute, for the progress panel. */
  'ai.activity': [void, AiTaskState[]]
  /** Stops one AI run (the engine process is ended). */
  'ai.stop': [{ id: Id }, void]
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
   * One AI idea for a promotion goal of this product, from its approved passport; null when the AI had no new safe idea.
   * `avoid` holds the ideas the owner has already seen, `hint` is the owner's own one-line preference. Nothing is saved.
   */
  'goals.suggest': [{ productId: Id; hint?: string; avoid?: string[] }, GoalIdea | null]
  /**
   * Reads the front page of the site at `url` (and a few related pages) and has the AI propose the product's name and a short description.
   * Null when the site says nothing usable about a product. Nothing is saved: the owner reads the proposal and creates the product.
   * Refused with site_unreadable when the site cannot be read, with engine_unavailable when no engine is ready or the engine can use tools
   * on this computer (such an engine is never shown a website), and like every AI help otherwise.
   */
  'products.draftFromSite': [{ url: string }, { name: string; description: string; websiteUrl: string } | null]
  /**
   * The AI writes the text of one field (`current` empty) or improves it (`current` filled, steered by the owner's `instruction`).
   * A product field takes `productId`; a channel field takes `channelId` (the product is the channel's). `around` is what the owner already
   * wrote in the other fields of the same form. Nothing is saved: the owner reads the text and
   * saves it with the form. Refused like every AI help: engine_unavailable, and not_found or invalid_input for a bad product or field.
   */
  'assist.refine': [{ field: AssistField; productId?: Id; channelId?: Id; current: string; instruction?: string; around?: { label: string; text: string }[] }, { text: string }]
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
  /**
   * Opportunities, newest first, at most 300. `productId` keeps those of one product; `source` those of one source (DEC-039): the Feed's chips are
   * `source: 'new_post'`, `'comment'`, `'reply_to_me'` and `'mention'`. Every filter is optional and they combine.
   */
  'opportunities.list': [{ channelId?: Id; productId?: Id; kind?: OpportunityKind; source?: OpportunitySource; states?: OpportunityState[] }, OpportunityCard[]]
  /**
   * What the AI judged of a channel's posts (DEC-040), newest first, at most `limit` (default 100, at most 300). `labels` keeps the given labels (all when
   * absent; a pending finding has no label and is listed only when `labels` is absent). Read-only.
   */
  'findings.list': [{ productId: Id; channelId?: Id; labels?: FindingLabel[]; limit?: number }, FindingCard[]]
  'findings.counts': [{ productId: Id; /** Only the findings of this channel; every channel of the product when absent. */ channelId?: Id }, FindingCounts]
  /** The owner looked at these findings: they stop counting as unseen. */
  'findings.markSeen': [{ ids: Id[] }, void]
  'findings.setStarred': [{ id: Id; starred: boolean }, void]
  /** The comments under a post the AI read and judged worth a reply, in reading order (at most 25); empty for a post nobody read. Read-only. */
  'findings.thread': [{ id: Id }, FindingComment[]]
  /**
   * The AI writes (or, with `current` and `instruction`, rewrites) the comment to leave at ONE place of a thread it read: `place` is the position of a
   * comment (see findings.thread) or null for the post itself. Checked like every AI draft; nothing is stored or sent. Refused for a post the AI has not read.
   */
  'findings.writeReply': [{ id: Id; place: number | null; current?: string; instruction?: string }, { text: string }]
  'opportunities.get': [{ id: Id }, OpportunityCard]
  'opportunities.prepareDraft': [{ id: Id }, OpportunityCard]
  'opportunities.saveDraft': [{ id: Id; draft: DraftInput }, OpportunityCard]
  'opportunities.approve': [{ id: Id }, OpportunityCard]
  'opportunities.reject': [{ id: Id; reason?: string }, OpportunityCard]
  /** Deletes a deleted post of the owner's for good, with its drafts and approvals; only one that never went out. */
  'opportunities.purge': [{ id: Id }, { id: Id }]
  'opportunities.defer': [{ id: Id }, OpportunityCard]
  'opportunities.send': [{ id: Id }, OpportunityCard]
  /** Re-checks an 'unknown' send with the platform; only then may a new attempt happen. */
  'opportunities.reconcile': [{ id: Id }, OpportunityCard]
  /**
   * The owner settles an 'unknown' send by checking the platform themselves: it was published (optionally with its
   * link) or it was not. Without this an unreachable platform check would lock the item forever.
   */
  'opportunities.resolveUnknown': [{ id: Id; outcome: 'published' | 'not_published'; url?: string }, OpportunityCard]
  // The rules an AI draft passes, read against the owner's own text before it is approved. Local: no engine, nothing stored.
  'drafts.check': [{ opportunityId: Id; form?: { title: string; text: string; link: string; markup?: PostMarkup } }, DraftCheckResult]
  /**
   * The AI writes (the field is empty, or `post`) or improves (the field is filled, steered by the owner's `instruction`) the title or the
   * text of a reply or of a post. A card is named by `opportunityId`; a new publication that has no card yet, by `channelId`. `form` is
   * the editor as it is; `about` is what a new post is about. The text passes the checks every AI draft passes (approved facts, nothing
   * prohibited, no price or promotion without a claim, links only to the product's own addresses, the connection disclosed) and is
   * handed back once to be fixed, then refused as suggest_failed with the reasons. Nothing is saved: the owner reads the text and saves the
   * draft. Refused like every AI help: engine_unavailable; no_knowledge for a post written from nothing when no fact is approved yet; invalid_input for
   * a malformed call or a draft too long to be read whole (never cut). If the product knowledge changes while the AI writes, the text is refused
   * (suggest_failed). Like the AI drafts, it works with any ready engine.
   */
  'drafts.refine': [{ field: DraftHelpField; opportunityId?: Id; channelId?: Id; form: { title: string; text: string }; instruction?: string; about?: string }, DraftHelpResult]
  /**
   * The AI in the quick-post composer (REQ-004). Four helps, each the owner's own press, none of them stores or changes anything: the owner reads the
   * answer and presses to use it. All of them stand on the approved product knowledge; with none approved, no_knowledge. engine_unavailable like every AI
   * help; invalid_input for a malformed call, a platform that is not one of the quick ones, or a caption too long to be read whole (never cut);
   * suggest_failed when the AI's answer is blocked by the safety checks after one repair, or when the product knowledge changed while it worked.
   * `quick.caption` writes (empty caption) or improves the caption for the platform's form; `quick.picture` proposes a card's headline, style and colour or
   * an illustration's description; `quick.assess` is the marketer, which judges the caption and the picture against the goal the approved knowledge states.
   */
  'quick.caption': [QuickCaptionArgs, QuickCaptionResult]
  'quick.picture': [QuickPictureArgs, QuickPictureResult]
  'quick.assess': [QuickAssessArgs, QuickAssessment]
  /**
   * The trend analyst: only when the owner asks. The AI looks at the platform's own search pages for the channel's topics in the channel's account's
   * browser (the AI browser, read-only: it opens pages and reads them, and clicks, types, replies, follows and posts nothing) and proposes an angle from
   * what it saw. The progress is the run of the AI browser (`ai.activity`, subject `quickTrendsSubject(channelId)`). A search that cannot run or finds
   * nothing is a state with a message, never an error: the owner can write and make the picture all the same. engine_unavailable and no_knowledge as for
   * every help; invalid_input for a channel that is not a quick one or is not the product's.
   */
  'quick.trends': [QuickTrendsArgs, QuickTrendsResult]
  'publications.suggest': [{ channelId: Id }, OpportunityCard]
  'publications.create': [{ channelId: Id; draft: DraftInput }, OpportunityCard]

  // content mix and the owner's own updates (DEC-033). The mix itself is saved with channels.updateSettings({ mix }).
  /** The mix of a channel as the owner sees it: each kind, when it last gave a draft and when the next is due, what waits, what is unused. */
  'mix.get': [{ channelId: Id }, MixCard]
  /**
   * The AI's proposal for the mix, from the steps of the channel's plan (asks the AI for a plan first when it has none with a rhythm).
   * Nothing is saved or switched on: the owner edits it and saves it.
   */
  'mix.propose': [{ channelId: Id }, MixSetting[]]
  /** Adds a note ("What's new") the AI may write one own-update post from. A note says what the owner did, in a line or two. */
  'updates.add': [{ productId: Id; text: string }, ProductUpdate]
  'updates.list': [{ productId: Id }, ProductUpdate[]]
  /** Removes a note that was not used. */
  'updates.remove': [{ id: Id }, void]

  // one post for several channels (DEC-032): a group is a wrapper, each version is an ordinary post of one channel
  /** Writes the post once for two or more channels of one product. Nothing is approved or sent. */
  'postGroups.create': [{ productId: Id; channelIds: Id[]; draft: DraftInput }, PostGroupCard]
  /** "Also post to…": an existing post of the owner joins a group (made if it has none) and gets a version for each channel. */
  'postGroups.extend': [{ opportunityId: Id; channelIds: Id[] }, PostGroupCard]
  'postGroups.get': [{ id: Id }, PostGroupCard]
  /** Groups of a product that still have a version, newest first. */
  'postGroups.list': [{ productId: Id }, PostGroupCard[]]
  /** The product's channels with whether this post fits each as it is; the app suggests those that fit. Nothing is chosen for the owner. */
  'postGroups.channels': [{ productId: Id; draft: DraftInput; chosen?: Id[] }, GroupChannelOption[]]
  /** The AI rewrites the master for each version's platform (the limits, plain text). A version the owner edited by hand stays unless `force`. */
  'postGroups.adapt': [{ id: Id; opportunityIds?: Id[]; force?: boolean }, PostGroupOutcome]
  /** The owner's one press after reading every version: approves each version, each by its own exact content. `seen` is the draft of each version the owner was shown. */
  'postGroups.approve': [{ id: Id; seen: Record<Id, Id> }, PostGroupOutcome]
  /** The owner's one press: sends the approved versions one after another; one that fails stops nothing else. */
  'postGroups.sendAll': [{ id: Id }, PostGroupOutcome]
  /** Deletes the versions that were not sent; a sent one stays. */
  'postGroups.remove': [{ id: Id }, PostGroupCard]

  // pictures (DEC-030): the library of a product, ingestion (a dialog, a paste, a drop) and the AI's image tool
  /**
   * What can be done here: the system dialog and the file manager (not in the loopback web mode) and, when `checkEngine` is set, whether an
   * engine with an image tool is installed and ready (and why not). Checking an engine starts a process, so only a screen that is about to
   * make a picture asks for it.
   */
  'media.status': [{ checkEngine?: boolean }, { canPick: boolean; canReveal: boolean; canMake: boolean | null; makeReason: string | null }]
  /** Opens the system's file dialog (main process) and adds what the owner chose; an empty list when the dialog was closed. */
  'media.pick': [{ productId: Id }, MediaItem[]]
  /** Adds a picture from bytes: pasted from the clipboard or dropped on the editor. The file is checked like any attachment. */
  'media.add': [{ productId: Id; name: string; base64: string; origin: Exclude<MediaOrigin, 'generated'>; description?: string }, MediaItem]
  'media.list': [{ productId: Id }, MediaItem[]]
  /** A small copy for the screen as a data address (the CSP allows nothing else), or null when the file is gone. */
  'media.thumb': [{ id: Id; side?: number }, { dataUrl: string } | null]
  'media.describe': [{ id: Id; description: string }, MediaItem]
  /** Takes a picture out of the library; refused while a draft uses it. */
  'media.remove': [{ id: Id }, void]
  /** The AI makes a picture from the description the owner wrote or edited (Codex's image tool); the result is a new item of the library. */
  'media.make': [{ productId: Id; description: string; shape: MediaShape }, MediaItem]
  /** Shows the picture's file in the system's file manager (for a post the owner publishes by hand). */
  'media.reveal': [{ id: Id }, void]
  'publications.schedule': [{ id: Id; at: IsoTime | null }, OpportunityCard]

  // results and logs (REQ-005, REQ-006)
  'results.get': [{ productId?: Id }, ResultsView]
  'results.refresh': [{ channelId: Id }, MetricSnapshot[]]
  /** Every kept reading of the product's channels over the last `days` days (1-365). Readings the platform did not give stay null. */
  'results.history': [{ productId: Id; days: number }, ResultsHistory]
  /** The funnel, the channels, the attention items and the sends per day of one product over the last `days` days (1-365); `utcOffsetMinutes` is `-new Date().getTimezoneOffset()`. */
  'overview.get': [{ productId: Id; days: number; utcOffsetMinutes?: number }, OverviewView]
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
  | 'ai'
  | 'media'

/**
 * Pushed from the core to every connected UI. `navigate` is the exception: the main process sends it straight to its own windows
 * (the "Settings…" menu item, BUG-048), never through the core's events, so the loopback web mode is not driven by the desktop menu.
 */
export type ApiEvent =
  | { type: 'automation'; state: AutomationState }
  | { type: 'changed'; scope: ChangeScope }
  | { type: 'analysis'; productId: Id; stage: AnalysisStage }
  | { type: 'run'; run: Run }
  | { type: 'navigate'; hash: string }

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
