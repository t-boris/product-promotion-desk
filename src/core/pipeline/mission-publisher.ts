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

import type { Comment } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, type Connector, type ConnectorContext, type PublishedRef, type PublishRequest } from '../ports'
import type { ApprovedContent, LeaseResult, PostAuthority, PostMissionOutcome, PostMissionRequest, SubmitLease } from '../browser-agent/post-submit'
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

export type Executor = 'connector' | 'ai_browser'

/**
 * The answer of a mission, in the shape the send flow settles:
 *  - the three outcomes of a connector;
 *  - `not_started`: the AI browser could not be used and nothing was submitted; the approval stays, the item waits.
 */
export type MissionResult =
  | { status: 'confirmed'; url: string; externalId: string }
  /** `auth`: the application itself saw a signed-out account or a human check, which makes the flow check the session and suspend the account. */
  | { status: 'failed'; error: string; auth?: 'login' | 'captcha' }
  | { status: 'unknown'; error: string }
  | { status: 'not_started'; error: string }

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

/**
 * The authority one mission is given. It is built for one grant and one attempt, from the content the mission will type, and it is the
 * only holder of a ticket: the toolbox sees a lease on one for the length of one submit step.
 */
export class MissionAuthority implements PostAuthority {
  committed = false
  readonly content: ApprovedContent
  private readonly typedHash: string

  /**
   * `typed` is what the mission will put into the form; the ticket the gate gives must be bound to exactly it. It is hashed here, with the
   * same function the gate and the approval use, from the account as the grant knows it.
   */
  constructor(
    private readonly core: Core,
    private readonly gate: Pick<SendGate, 'renewTicket'>,
    private readonly grant: GateGrant,
    content: ApprovedContent,
    typed: { attachments: PublishRequest['attachments'] },
    private readonly automatic: boolean
  ) {
    // A copy nobody can change afterwards: what the mission types is what was hashed, and what the ticket must be bound to.
    this.content = Object.freeze({ ...content })
    this.typedHash = contentHash({ title: content.title, text: content.text, link: content.link, attachments: typed.attachments }, { id: grant.account.id, identity: grant.account.identity }, content.destination)
  }

  async lease<T>(use: (lease: SubmitLease) => Promise<T>): Promise<LeaseResult<T>> {
    if (this.committed) return { ok: false, reason: 'The control was already pressed; nothing more is submitted in this mission.' }
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
        if (this.committed) throw new Error('The control was already pressed.')
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

export class MissionPublisher {
  constructor(
    private readonly core: Core,
    private readonly gate: SendGate,
    private readonly store: FlowStore
  ) {}

  /**
   * Who carries out this send. The AI browser only when the owner chose it, for an approval the owner gave themselves, on a click of
   * theirs, and for content the AI browser carries (no attachments yet). Everything else goes through the connector as before.
   */
  executorFor(grant: GateGrant, automatic: boolean): Executor {
    if (this.core.settings.app().publishWith !== 'ai_browser') return 'connector'
    if (automatic || grant.approval.approvedBy !== 'user') return 'connector'
    if (!this.core.services.postMissions) return 'connector'
    if (grant.draft.attachments.length > 0) {
      this.core.log.info('send', 'The AI browser does not carry attachments yet: this one is sent through the connector.', grant.channel.id)
      return 'connector'
    }
    return 'ai_browser'
  }

  /** One mission for one reserved attempt, and the application's own reading of the site afterwards. Never throws for what it can name. */
  async publish(pair: { connector: Connector; ctx: ConnectorContext }, grant: GateGrant, attemptedAt: string, automatic: boolean): Promise<MissionResult> {
    const missions = this.core.services.postMissions
    if (!missions) return { status: 'not_started', error: 'The AI browser is not available in this build.' }
    const { connector, ctx } = pair

    // The session first: a signed-out account or a CAPTCHA is a definite failure that suspends the account, as for a connector.
    try {
      const state = await connector.checkLogin(ctx)
      if (state.captcha) return { status: 'failed', auth: 'captcha', error: 'CAPTCHA required: the site asks for a human check before the account can publish.' }
      if (!state.loggedIn) return { status: 'failed', auth: 'login', error: 'Sign-in required: the account is signed out on the site.' }
      const signedInAs = normalizeIdentity(state.identity)
      const approvedFor = normalizeIdentity(grant.account.identity)
      if (signedInAs !== '' && approvedFor !== '' && signedInAs !== approvedFor) {
        return { status: 'failed', error: `The browser is signed in as "${state.identity}", not as the account the owner approved this for ("${grant.account.identity}"). Nothing was submitted.` }
      }
    } catch (error) {
      if (error instanceof TakeoverError) return { status: 'not_started', error: 'The account browser is under your control. Hand it back so the application can send.' }
      // The check itself failed (the site did not answer): the mission looks at the page anyway and the gate re-checks at the submit.
      this.core.log.warn('send', `Could not check the login before the AI browser started: ${errorMessage(error)}`, grant.channel.id)
    }

    const request = grant.request
    const content: ApprovedContent = { kind: request.kind, title: request.title, text: request.text, link: request.link, destination: request.destination }
    const authority = new MissionAuthority(this.core, this.gate, grant, content, { attachments: request.attachments }, automatic)
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
    if (!authority.committed) return this.notSubmitted(outcome, crash)
    return this.readBack(pair, grant, attemptedAt, outcome, crash)
  }

  private missionRequest(grant: GateGrant, authority: MissionAuthority): PostMissionRequest {
    const { account, channel, opportunity } = grant
    const facts = [`This is the owner's own approved ${authority.content.kind} for the product "${this.core.repos.product(opportunity.productId).name}".`]
    if (account.role) facts.push(`The account speaks as "${account.role.name}".`)
    const comment = opportunity.commentId ? this.store.comment(opportunity.commentId) : null
    return {
      accountId: account.id,
      accountLabel: account.label,
      authority,
      hosts: missionHosts(authority.content.destination, channel.url),
      platform: channel.platform,
      facts,
      quoted: comment ? quote(comment) : undefined
    }
  }

  /**
   * Nothing was submitted (the authority never saw a press), whatever the AI says. The wording is the application's. Only what the
   * application itself saw on the page (a human check) makes the flow check the session; the AI's own words are shown and never classified.
   */
  private notSubmitted(outcome: PostMissionOutcome | null, crash: string | null): MissionResult {
    const none = 'Nothing was submitted.'
    if (outcome?.humanCheck) return { status: 'failed', auth: 'captcha', error: `CAPTCHA required: the site showed a human check (${outcome.humanCheck}). ${none}` }
    if (outcome?.warning) return { status: 'failed', error: `The site shows a warning ("${outcome.warning}"), so nothing was published. ${none}` }
    if (!outcome) return { status: 'failed', error: `The AI browser stopped with an error. ${none} ${crash ?? ''}`.trim() }
    if (outcome.ended === 'stopped') return { status: 'failed', error: `You stopped the AI before it published. ${none}` }
    if (outcome.ended === 'timeout') return { status: 'failed', error: `The AI did not finish in time. ${none}` }
    if (outcome.ended === 'error') return { status: 'failed', error: `The AI stopped because of an error (${outcome.error ?? 'unknown error'}). ${none}` }
    const reason = outcome.reported?.reason
    return { status: 'failed', error: reason ? `The AI could not publish: ${reason} ${none}` : `The AI ended without publishing. ${none}` }
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
    const said = outcome?.reported ? ` The AI says: ${outcome.reported.reason}` : ''
    return { status: 'unknown', error: `${pressed} The application did not find the text on the site afterwards, so it is not known whether it was published.${said}` }
  }
}

/** What a reply answers, for the brief: who wrote it and how it begins. It is data from the site and is fenced as such. */
function quote(comment: Comment): string {
  const body = comment.body.replace(/\s+/g, ' ').trim()
  return `${comment.author} wrote: ${body.length > 600 ? `${body.slice(0, 599)}…` : body}`
}
