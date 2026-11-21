// Publishing through the AI in the account's browser (B1), with the gate's ticket kept in code.
//
// The owner approves once. When they chose the AI browser, the send flow (not the AI) starts a post mission for that one approved
// publication: the AI opens the page and finds the form; the application types the approved content, presses the control, and then READS
// THE PAGE BACK itself. Everything that makes this safe is here and in the toolbox, none of it in the instructions to the model:
//
//  - A mission exists only for a gate grant (`GateGrant` comes from `SendGate.authorize` and nowhere else) and only for the attempt the
//    flow has reserved. There is no other caller.
//  - The AI never holds a ticket. The authority below asks the gate for a fresh single-use ticket at the moment of the submit (a renewal
//    re-checks the approval, the disclosure, the limits, the owner's hold on the browser...), checks that the ticket is bound to exactly the
//    content the mission will type, this account and this destination, hands it to the one submit step, and revokes it when the step ends.
//    It never gives a second ticket after the press.
//  - `confirmed` is the application's own reading of the site (`Connector.findPublished`), never the AI's report. A press whose result the
//    application cannot find is `unknown`, which blocks a resend exactly as for a connector.
//  - A mission that ends without a press is a definite failure: nothing was submitted, whatever the AI says.
//  - The owner's windows share the account's session with the AI's page (DEC-038). The sign-in is checked before the mission starts; when the owner
//    then used a sign-in or sign-out page of the session (`identityEpoch` moved) the check is out of date: the mission is refused every step that
//    writes, and when it ends without a press the application reads the sign-in again and says what is true. Nothing is submitted.

import { renderForPlatform } from '../../shared/post-format'
import type { Comment, Discussion } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, type Connector, type ConnectorContext, type LoginState, type PublishedRef, type PublishRequest } from '../ports'
import { EXTENSION_BY_MIME } from './attachments'
import { chooseExecutor, sendWays, type Executor } from './send-ways'
import type { ApprovedContent, ApprovedFile, LeaseResult, PostAuthority, PostMissionOutcome, PostMissionRequest, SubmitLease } from '../browser-agent/post-submit'
import type { GateGrant, SendGate } from './gate'
import { contentHash } from './hash'
import type { FlowStore } from './store'
import { errorMessage, normalizeIdentity } from './util'

export const AI_BROWSER_BASIS = "published by the AI in the account's browser"

/** The read-back looks for the publication this many times, this long apart, as the connectors do: a site shows a new comment a moment later. */
export const READ_BACK_TRIES = 4
export const READ_BACK_DELAY_MS = 2000

/** What the mission service refuses with before anything was started: the AI browser cannot be used right now, and nothing happened. */
const NOT_STARTED_CODES = ['agent_running', 'no_engine', 'engine_cannot_drive', 'engine_unavailable', 'no_agent_bridge']

export type { Executor }

/**
 * The answer of a mission, in the shape the send flow settles:
 *  - the three outcomes of a connector;
 *  - `not_started`: the AI browser could not be used and nothing was submitted; the approval stays, the item waits.
 */
export type MissionResult =
  | { status: 'confirmed'; url: string; externalId: string }
  /**
   * `error` is the application's own wording. `note` is what the AI or the site said (a reason, a warning, a description of a human
   * check), bounded: it is for the owner to read next to the error and is never written to the log, because it is free text.
   * `auth`: the application itself saw a signed-out account or a human check, which makes the flow check the session and suspend the account.
   */
  | { status: 'failed'; error: string; note?: string; auth?: 'login' | 'captcha' }
  | { status: 'unknown'; error: string; note?: string }
  | { status: 'not_started'; error: string }

/** What the authority says when the owner used a sign-in or sign-out page of the session after the sign-in was checked. */
const SESSION_DOUBT = 'A sign-in or sign-out page was used in the account\'s browser after the sign-in was checked, so it is not known who is signed in.'

/** Whether the owner did something in the account's session since the sign-in was checked (a number that moved: `BrowserSession.identityEpoch`). */
export interface SessionWatch {
  moved(): boolean
}

/** The longest piece of free text (the AI's reason, a site's warning) that goes next to an error. */
const NOTE_MAX = 300
const bounded = (text: string, max = NOTE_MAX): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** The hosts a mission may work on: the platform of the destination and of the channel, without the decoration of one of its sub-domains. */
export function missionHosts(...urls: string[]): string[] {
  const hosts = new Set<string>()
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^(?:www|old|new|m|mobile|np)\./, '')
      if (host) hosts.add(host)
    } catch {
      // an address that is not one adds no host
    }
  }
  return [...hosts]
}

/** The content a mission was given is not the approved draft as its platform shows it: a programming error, refused before any step. */
export class MissionContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissionContentError'
  }
}

/**
 * The authority one mission is given. It is built for one grant and one attempt, from the content the mission will type, and it is the
 * only holder of a ticket: the toolbox sees a lease on one for the length of one submit step.
 */
export class MissionAuthority implements PostAuthority {
  committed = false
  sealed = false
  readonly content: ApprovedContent
  private readonly typedHash: string
  private readonly watch: SessionWatch

  /**
   * `typed` is what the mission will put into the form. Two things bind it. The ticket the gate gives is bound to the hash of the APPROVED
   * DRAFT (what the owner saw and approved: a post written in the post editor is hashed as its Markdown source, with its markup), so the
   * ticket is checked against that hash, computed here with the same function the gate and the approval use. And what the mission types must
   * be exactly what the application renders from that draft for this platform (the preview, the check and the send use the same function),
   * so a mission that was handed anything else is refused here, before it can press anything.
   */
  constructor(
    private readonly core: Core,
    private readonly gate: Pick<SendGate, 'renewTicket'>,
    private readonly grant: GateGrant,
    content: ApprovedContent,
    typed: { attachments: PublishRequest['attachments'] },
    private readonly automatic: boolean,
    watch: SessionWatch = { moved: () => false }
  ) {
    this.watch = watch
    const shown = renderForPlatform(grant.draft, grant.channel.platform)
    const same = shown.title === content.title && shown.text === content.text && shown.link === content.link && JSON.stringify(shown.attachments) === JSON.stringify(typed.attachments)
    if (!same) throw new MissionContentError('What the mission would type is not what was approved for this platform. Nothing was submitted.')
    // A copy nobody can change afterwards: what the mission types is what was checked above, and the ticket must be bound to the approved draft.
    this.content = Object.freeze({ ...content })
    this.typedHash = contentHash(grant.draft, grant.account, content.destination, grant.channel.platform)
  }

  seal(): void {
    this.sealed = true
  }

  /** The owner used a sign-in or sign-out page of the session since the sign-in was checked. Once seen, it stays seen: the check does not become current again. */
  get sessionMoved(): boolean {
    if (!this.moved && this.watch.moved()) this.moved = true
    return this.moved
  }

  private moved = false

  async lease<T>(use: (lease: SubmitLease) => Promise<T>): Promise<LeaseResult<T>> {
    if (this.sealed) return { ok: false, reason: 'The mission is over; nothing is submitted any more.' }
    if (this.committed) return { ok: false, reason: 'The control was already pressed; nothing more is submitted in this mission.' }
    if (this.sessionMoved) return { ok: false, reason: SESSION_DOUBT }
    // A fresh ticket for the attempt that is running, after the gate has looked at everything that can change meanwhile.
    const renewal = this.gate.renewTicket(this.grant, this.automatic)
    if (!renewal.allowed) return { ok: false, reason: renewal.reasons.join(' ') }
    const ticket = renewal.ticket
    try {
      // The ticket must be for exactly this content, account and destination. One for anything else is thrown away unused.
      this.core.tickets.assertValid(ticket, { accountId: this.grant.account.id, destination: this.content.destination, contentHash: this.typedHash })
    } catch (error) {
      this.core.tickets.revoke(ticket)
      return { ok: false, reason: `The send ticket is not for this content: ${errorMessage(error)}` }
    }
    const lease: SubmitLease = {
      ticket,
      commit: () => {
        // The last word before a press: a mission that was ended meanwhile (Stop, the engine, the time) presses nothing, however far this step got.
        if (this.sealed) throw new Error('The mission is over; nothing is pressed.')
        if (this.committed) throw new Error('The control was already pressed.')
        if (this.sessionMoved) throw new Error(SESSION_DOUBT)
        this.committed = true
      },
      release: () => {
        this.committed = false
      }
    }
    try {
      return { ok: true, value: await use(lease) }
    } finally {
      // Single use: whatever happened, this ticket opens nothing from here on.
      this.core.tickets.revoke(ticket)
    }
  }
}

/**
 * The pictures of the approved post as the mission is given them: each by a name the application chose ("picture-1.png", in the order of the
 * post), never the owner's own file name (that is text of someone else's making, and it would be shown to the AI), with the path the AI never
 * sees and the hash the approval was bound to.
 */
export function approvedFilesOf(attachments: PublishRequest['attachments']): ApprovedFile[] {
  return attachments.map((a, index) => ({ name: `picture-${index + 1}${EXTENSION_BY_MIME[a.mime] ?? ''}`, path: a.path, sha256: a.sha256 }))
}

export class MissionPublisher {
  constructor(
    private readonly core: Core,
    private readonly gate: SendGate,
    private readonly store: FlowStore
  ) {}

  /**
   * Who carries out this send. The AI browser only when the owner chose it, for an approval the owner gave themselves, on a click of
   * theirs (`sendWays`). With pictures it carries only what the connector cannot: a post the connector can send (Reddit's picture by itself)
   * keeps going through it, the way that is known to work. Everything else goes through the connector as before.
   */
  executorFor(grant: GateGrant, automatic: boolean): Executor {
    const ways = sendWays(this.core, { automatic, approvedBy: grant.approval.approvedBy }, grant.channel)
    const executor = chooseExecutor(ways, grant.draft, grant.channel.platform)
    if (ways.aiBrowser && executor === 'connector') this.core.log.info('send', 'This one is sent through the connector, which can carry it.', grant.channel.id)
    return executor
  }

  /** One mission for one reserved attempt, and the application's own reading of the site afterwards. Never throws for what it can name. */
  async publish(pair: { connector: Connector; ctx: ConnectorContext }, grant: GateGrant, attemptedAt: string, automatic: boolean): Promise<MissionResult> {
    const missions = this.core.services.postMissions
    if (!missions) return { status: 'not_started', error: 'The AI browser is not available in this build.' }
    const { connector, ctx } = pair

    // The session first: a signed-out account or a CAPTCHA is a definite failure that suspends the account, as for a connector. What the owner does
    // in the session from here on is counted from before this check, so a sign-out during it is not missed.
    const session = ctx.session
    const checkedAt = session.identityEpoch()
    try {
      const refusal = this.signInProblem(await connector.checkLogin(ctx), grant)
      if (refusal) return refusal
    } catch (error) {
      if (error instanceof TakeoverError) return { status: 'not_started', error: 'The account browser is under your control. Hand it back so the application can send.' }
      // The check itself failed (the site did not answer): the mission looks at the page anyway and the gate re-checks at the submit.
      this.core.log.warn('send', `Could not check the login before the AI browser started: ${errorMessage(error)}`, grant.channel.id)
    }

    const request = grant.request
    const content: ApprovedContent = { kind: request.kind, title: request.title, text: request.text, link: request.link, destination: request.destination, attachments: approvedFilesOf(request.attachments) }
    let authority: MissionAuthority
    try {
      authority = new MissionAuthority(this.core, this.gate, grant, content, { attachments: request.attachments }, automatic, { moved: () => session.identityEpoch() !== checkedAt })
    } catch (error) {
      if (error instanceof MissionContentError) return { status: 'not_started', error: error.message }
      throw error
    }
    let outcome: PostMissionOutcome | null = null
    let crash: string | null = null
    try {
      outcome = await missions.run(this.missionRequest(grant, authority))
    } catch (error) {
      if (!authority.committed && error && typeof error === 'object' && 'code' in error && NOT_STARTED_CODES.includes(String((error as { code: unknown }).code))) {
        return { status: 'not_started', error: `The AI browser could not start: ${errorMessage(error)}` }
      }
      crash = errorMessage(error)
    }

    // The authority's word decides whether the control was pressed. The AI's report is a note and is only ever shown.
    if (!authority.committed) return authority.sessionMoved ? this.afterSessionChange(pair, grant) : this.notSubmitted(outcome, crash)
    return this.readBack(pair, grant, attemptedAt, outcome, crash)
  }

  /**
   * Why the account may not publish now, from the site's own answer about the session (the one the mission starts with, and the one after the
   * owner used a sign-in page); null when it may. `after` is added to the owner's sentence when the answer comes after such a page was used.
   */
  private signInProblem(state: LoginState, grant: GateGrant, after = ''): MissionResult | null {
    const tail = after ? ` ${after}` : ''
    if (state.captcha) return { status: 'failed', auth: 'captcha', error: `CAPTCHA required: the site asks for a human check before the account can publish.${tail}` }
    if (!state.loggedIn) return { status: 'failed', auth: 'login', error: `Sign-in required: the account is signed out on the site.${tail}` }
    const signedInAs = normalizeIdentity(state.identity)
    const approvedFor = normalizeIdentity(grant.account.identity)
    if (signedInAs !== '' && approvedFor !== '' && signedInAs !== approvedFor) {
      return { status: 'failed', error: `The browser is signed in as "${state.identity}", not as the account the owner approved this for ("${grant.account.identity}").${tail || ' Nothing was submitted.'}` }
    }
    return null
  }

  /**
   * The owner used a sign-in or sign-out page of the account's session while the mission worked, and nothing was pressed. Who is signed in is read
   * again now (the mission has ended, so the page is free): a signed-out account, a human check or another identity ends as for a connector (the
   * account is suspended, or the owner is told whose account it is), and the same account ends as "not started", with the approval kept: press
   * Send again.
   */
  private async afterSessionChange(pair: { connector: Connector; ctx: ConnectorContext }, grant: GateGrant): Promise<MissionResult> {
    const why = "A sign-in or sign-out page was used in the account's browser while the AI worked. Nothing was submitted."
    try {
      const refusal = this.signInProblem(await pair.connector.checkLogin(pair.ctx), grant, why)
      if (refusal) return refusal
    } catch (error) {
      return { status: 'not_started', error: `${why} The application could not check who is signed in now (${errorMessage(error)}).` }
    }
    return { status: 'not_started', error: `${why} The account is still signed in as it was, so the approval is kept: press Send to try again.` }
  }

  private missionRequest(grant: GateGrant, authority: MissionAuthority): PostMissionRequest {
    const { account, channel, opportunity } = grant
    const facts = [`This is the owner's own approved ${authority.content.kind} for the product "${this.core.repos.product(opportunity.productId).name}".`]
    if (account.role) facts.push(`The account speaks as "${account.role.name}".`)
    const comment = opportunity.commentId ? this.store.comment(opportunity.commentId) : null
    // A reply to a new post (DEC-039) answers the post: the brief quotes it the way it quotes a comment.
    const post = comment ? null : this.store.postOf(opportunity)
    return {
      accountId: account.id,
      accountLabel: account.label,
      authority,
      hosts: missionHosts(authority.content.destination, channel.url),
      platform: channel.platform,
      facts,
      quoted: comment ? quote(comment) : post ? quotePost(post) : undefined
    }
  }

  /**
   * Nothing was submitted (the authority never saw a press), whatever the AI says. The wording is the application's; what the AI or the
   * site said travels apart, as a bounded `note`, for the owner to read and never for the log. Only what the application itself saw on
   * the page (a human check) makes the flow check the session; the AI's own words are shown and never classified.
   */
  private notSubmitted(outcome: PostMissionOutcome | null, crash: string | null): MissionResult {
    const none = 'Nothing was submitted.'
    if (outcome?.humanCheck) return { status: 'failed', auth: 'captcha', error: `CAPTCHA required: the site showed a human check. ${none}`, note: `The page shows: ${bounded(outcome.humanCheck, 160)}` }
    if (outcome?.warning) return { status: 'failed', error: `The site shows a warning, so nothing was published. ${none}`, note: `The site says: "${bounded(outcome.warning)}"` }
    if (!outcome) return { status: 'failed', error: `The AI browser stopped with an error. ${none} ${crash ?? ''}`.trim() }
    if (outcome.ended === 'stopped') return { status: 'failed', error: `You stopped the AI before it published. ${none}` }
    if (outcome.ended === 'timeout') return { status: 'failed', error: `The AI did not finish in time. ${none}` }
    if (outcome.ended === 'error') return { status: 'failed', error: `The AI stopped because of an error (${outcome.error ?? 'unknown error'}). ${none}` }
    const reason = outcome.reported?.reason
    return reason ? { status: 'failed', error: `The AI could not publish. ${none}`, note: `The AI says: ${bounded(reason)}` } : { status: 'failed', error: `The AI ended without publishing. ${none}` }
  }

  /**
   * The control was pressed, or may have been. Whether the text is on the site is the application's own finding: the connector's list of
   * the account's own publications, matched on destination and text and created after this attempt began, and not one that belongs to
   * another confirmed send. Not found, or a site that cannot be read back: unknown, which blocks a resend.
   */
  private async readBack(pair: { connector: Connector; ctx: ConnectorContext }, grant: GateGrant, attemptedAt: string, outcome: PostMissionOutcome | null, crash: string | null): Promise<MissionResult> {
    const { connector, ctx } = pair
    const pressed = crash ? `The AI browser pressed the control and then stopped with an error (${crash}).` : 'The AI browser pressed the control.'
    const request = { ...grant.request, attemptedAt }
    // A channel the app does not read cannot be read back (DEC-034): say so, and leave the finding to the owner, who looks at the page.
    if (!grant.channel.reads) {
      return {
        status: 'unknown',
        error: `${pressed} The app does not read this channel, so it cannot check that the post is up. Look at the page and tell the app whether it was published.`,
        note: outcome?.reported ? `The AI says: ${bounded(outcome.reported.reason)}` : undefined
      }
    }
    let ref: PublishedRef | null = null
    try {
      for (let attempt = 0; attempt < READ_BACK_TRIES && !ref; attempt++) {
        if (attempt > 0) await this.core.sleep(READ_BACK_DELAY_MS)
        ref = await connector.findPublished(ctx, request)
        // A match that belongs to another confirmed send of this account is that other publication, not this one.
        if (ref?.externalId && this.store.externalIdUsed(ref.externalId, grant.account.id, grant.actionId)) ref = null
      }
    } catch (error) {
      return { status: 'unknown', error: `${pressed} The application could not check that the text is on the site (${errorMessage(error)}), so it is not known whether it was published.` }
    }
    if (ref) return { status: 'confirmed', url: ref.url, externalId: ref.externalId }
    return {
      status: 'unknown',
      error: `${pressed} The application did not find the text on the site afterwards, so it is not known whether it was published.`,
      note: outcome?.reported ? `The AI says: ${bounded(outcome.reported.reason)}` : undefined
    }
  }
}

/** The new post a reply answers, for the brief: who wrote it, its title and how its text begins. Data from the site, fenced as such. */
function quotePost(post: Discussion): string {
  const body = `${post.title} ${post.body}`.replace(/\s+/g, ' ').trim()
  return `${post.author} posted: ${body.length > 600 ? `${body.slice(0, 599)}…` : body}`
}

/** What a reply answers, for the brief: who wrote it and how it begins. It is data from the site and is fenced as such. */
function quote(comment: Comment): string {
  const body = comment.body.replace(/\s+/g, ' ').trim()
  return `${comment.author} wrote: ${body.length > 600 ? `${body.slice(0, 599)}…` : body}`
}
