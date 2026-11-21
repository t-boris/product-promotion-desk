// The owner's own comment under a post of the Feed (owner, 2026-11-21: "Why can I not post the comment for you? The right post opens, in the right place, the
// plus is pressed and the comment is made. That is all. I have already checked the text. It is my text.").
//
// The owner reads the post and its thread, writes the comment (or has the AI help write it) and presses Send. That press is the approval. Nothing here is
// a new way to publish: it makes the opportunity, the draft and the approval a reply has always had and then asks the one send flow to carry it out, so the
// gate, the limits, the single-login rule, the owner's hold on the browser and the rule that an unknown result blocks a second attempt all hold. The text
// that is typed is the owner's text, exactly (only the spaces around it are trimmed): the AI types it, it never writes it.
//
// What is different is only what cannot be asked. The channel of such a post is one the application does not read, so the live thread is not read before
// the send (see `SendGate`) and what happened afterwards is not read back: the result is "unknown" until the owner looks at the page and says (the same
// way as for a post to Instagram).

import { ApiError, type FindingPlace, type FindingReplies, type FindingSendResult } from '../../shared/api'
import { COMMENT_SCHEDULE_MAX_DAYS } from '../../shared/finding-reply'
import { noConnectorProblem } from '../../shared/post-format'
import type { Channel, Finding, FindingComment, Id, Opportunity } from '../../shared/types'
import type { Core } from '../core'
import { CHANNEL_RESTRICTED_CODE, communityRulesReason, SendBlockedError } from './gate'
import type { FindingStore } from './findings'
import { missionHosts } from './mission-publisher'
import type { ReviewFlow } from './review'
import { sendWays } from './send-ways'
import type { FlowStore } from './store'
import { KeyedMutex, normalizeIdentity, sha256 } from './util'

/** The longest comment the Send button takes: the application's own limit for any text, so the platform's rules (checked at the approval) say the rest. */
const TEXT_MAX = 10_000

/** How far ahead a comment can be scheduled. */
const SCHEDULE_MAX_MS = COMMENT_SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000

/** A comment of a thread is the same comment when its author and its text are the same: positions move every time the post is read again. */
export function commentFingerprint(author: string, text: string): string {
  const flat = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase()
  return sha256(`${flat(author)}\n${flat(text)}`).slice(0, 24)
}

const isHttp = (value: string): boolean => {
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

const refused = (message: string): FindingSendResult => ({ state: 'refused', message, opportunityId: null, url: '' })

export class FindingSend {
  private readonly locks = new KeyedMutex()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly findings: FindingStore,
    private readonly review: ReviewFlow
  ) {}

  /** Why an answer cannot be sent from this post at all (the channel, the account, the AI), or an empty text when nothing stops it. */
  blocked(finding: Finding, channel: Channel): string {
    if (finding.about.trim() === '' && finding.readAt === null) return 'The AI has not read this post yet. Press Check with AI first, so the comment is written under what the post and its thread say.'
    if (channel.reads) return 'The application reads this channel itself, so its replies are prepared and sent from the Inbox, not from here.'
    if (channel.status === 'paused') return 'The channel is paused.'
    if (channel.status === 'setup') return 'The channel has not been activated yet.'
    const account = this.core.repos.account(channel.accountId)
    if (account.status !== 'ready') return `Account "${account.label}" is not available (${account.status.replace('_', ' ')}).`
    const ways = sendWays(this.core, undefined, channel)
    if (!ways.aiBrowser) return noConnectorProblem(ways) ?? "The AI browser is not available in this build, and it is what puts the comment under the post."
    return ''
  }

  /** What was sent from this post before, place by place, and whether a send is possible now. */
  replies(id: Id): FindingReplies {
    const finding = this.findings.get(id)
    const channel = this.store.requireChannel(finding.channelId)
    const account = this.core.repos.account(channel.accountId)
    const thread = this.findings.thread(id)
    const rows = this.core.db.prepare('SELECT * FROM opportunities WHERE finding_id = ? ORDER BY created_at, rowid').all(id) as Record<string, unknown>[]
    const places = rows.map((row) => {
      const opp = this.store.requireOpportunity(row.id as string)
      const comment = opp.commentId ? this.store.comment(opp.commentId) : null
      let position: number | null = null
      if (comment) {
        const found = thread.find((c) => `${finding.externalId}#c:${commentFingerprint(c.author, c.text)}` === comment.externalId)
        // A comment that is not in the thread any more cannot be shown under anything; its state is still told (it was sent or it was not).
        position = found ? found.position : -1
      }
      const sent = this.core.db.prepare("SELECT result_url AS url FROM send_actions WHERE opportunity_id = ? ORDER BY attempted_at DESC, rowid DESC LIMIT 1").get(opp.id) as { url: string | null } | undefined
      // The time is told only while the answer is approved and waiting for it: an item that went back to review is not "scheduled".
      return { position, opportunityId: opp.id, state: opp.state, reason: opp.reason, text: this.core.repos.latestDraft(opp.id)?.text ?? '', url: sent?.url ?? '', scheduledAt: opp.state === 'ready' ? opp.scheduledAt : null }
    })
    return { accountLabel: account.label, blocked: this.blocked(finding, channel), places: places.filter((p) => p.position !== -1) }
  }

  /**
   * The owner's press: put this text under the post (`place` null) or under one comment of its thread, as the account of the channel. Resolves when the send is
   * over. `anyway`: the owner knowingly lets the community's own rules through with this approval ("Send anyway"); it is kept on the approval only.
   */
  async send(args: { id: Id; place: FindingPlace | null; text: string; anyway?: boolean }): Promise<FindingSendResult> {
    const finding = this.findings.get(args.id)
    return this.locks.run(finding.id, () => this.sendLocked(finding, args.place, args.text, args.anyway === true))
  }

  /**
   * The owner's press made ahead of time: approve exactly this text for this place and put it on a schedule. The scheduler sends it when its time comes
   * (`Sending.sendDuePublications`), by the AI browser, with everything a press has: the gate, the limits, the rule about an unknown result. Pressing it again
   * with another time moves it.
   */
  async schedule(args: { id: Id; place: FindingPlace | null; text: string; at: string; anyway?: boolean }): Promise<FindingSendResult> {
    const finding = this.findings.get(args.id)
    return this.locks.run(finding.id, () => this.scheduleLocked(finding, args.place, args.text, args.at, args.anyway === true))
  }

  /** Takes an answer off its schedule and withdraws its approval: it is a draft of the reply window again. */
  unschedule(opportunityId: Id): void {
    const opp = this.store.requireOpportunity(opportunityId)
    if (opp.findingId === null) throw new ApiError('invalid_state', 'This item is not an answer from the Feed.')
    if (opp.state !== 'ready') throw new ApiError('invalid_state', `This answer is "${opp.state.replace('_', ' ')}", so it is not waiting for a time.`)
    this.core.db.transaction(() => {
      this.store.invalidateApprovals(opp.id, 'Taken off the schedule by the owner')
      this.store.updateOpportunity(opp.id, { state: 'draft', reason: '', scheduledAt: null })
    })()
    this.store.notify()
  }

  /** "Edit in full": keeps this text as the draft of this place, without approving or sending it, and says which item holds it. */
  async saveDraft(args: { id: Id; place: FindingPlace | null; text: string }): Promise<{ opportunityId: Id }> {
    const finding = this.findings.get(args.id)
    return this.locks.run(finding.id, async () => {
      const prepared = await this.prepare(finding, args.place, args.text, { approve: false, anyway: false })
      if ('stop' in prepared) throw new ApiError('invalid_state', prepared.stop.message)
      return { opportunityId: prepared.opp.id }
    })
  }

  private async sendLocked(finding: Finding, place: FindingPlace | null, rawText: string, anyway: boolean): Promise<FindingSendResult> {
    const prepared = await this.prepare(finding, place, rawText, { approve: true, anyway })
    if ('stop' in prepared) return prepared.stop
    const { opp } = prepared
    // Send now replaces a schedule: if this press is held, the answer must not go out by itself later behind the owner's back.
    if (this.store.requireOpportunity(opp.id).scheduledAt !== null) this.store.updateOpportunity(opp.id, { scheduledAt: null })

    const sending = this.core.services.sending
    if (!sending) return { state: 'refused', message: 'Sending is not available in this build.', opportunityId: opp.id, url: '' }
    try {
      const action = await sending.send(opp.id)
      this.store.notify()
      if (action.state === 'confirmed') return { state: 'sent', message: 'The comment was posted.', opportunityId: opp.id, url: action.resultUrl ?? '' }
      if (action.state === 'unknown') {
        return { state: 'unknown', message: action.error ?? 'It is not known whether the comment was posted. Look at the post and say whether it is there.', opportunityId: opp.id, url: '' }
      }
      return { state: 'failed', message: action.error ?? 'The comment was not posted.', opportunityId: opp.id, url: '' }
    } catch (error) {
      if (error instanceof SendBlockedError) {
        const message = error.block.reasons.join(' ')
        // `hold`: nothing changes and the approval stays, the owner may press Send again. The others took the approval away or ended the item.
        const code = error.block.code === CHANNEL_RESTRICTED_CODE ? { code: 'channel_restricted' as const } : {}
        return { state: error.block.effect === 'hold' ? 'held' : 'refused', message, opportunityId: opp.id, url: '', ...code }
      }
      throw error
    }
  }

  private async scheduleLocked(finding: Finding, place: FindingPlace | null, rawText: string, rawAt: string, anyway: boolean): Promise<FindingSendResult> {
    const at = this.plannedTime(rawAt)
    // The community's own rules are told now, not when the time comes: a comment that would be held then is refused here, with the same way out as a press of Send now.
    const restriction = this.communityRestriction(this.store.requireChannel(finding.channelId))
    if (restriction !== null && !anyway) return { state: 'refused', message: restriction, opportunityId: null, url: '', code: 'channel_restricted' }
    const prepared = await this.prepare(finding, place, rawText, { approve: true, anyway })
    if ('stop' in prepared) return prepared.stop
    this.store.updateOpportunity(prepared.opp.id, { scheduledAt: at })
    this.store.notify()
    return { state: 'scheduled', message: 'The comment is scheduled.', opportunityId: prepared.opp.id, url: '', at }
  }

  /** The community's own words when its rules forbid a reply (the owner may let that through knowingly); null when they do not. */
  private communityRestriction(channel: Channel): string | null {
    const capability = channel.capabilities.find((c) => c.key === 'publish_reply')
    return capability?.status === 'restricted' ? communityRulesReason(capability.detail) : null
  }

  /** The planned time as an ISO string: a real time, after now, and not more than 30 days away. */
  private plannedTime(raw: string): string {
    const ms = typeof raw === 'string' ? Date.parse(raw) : Number.NaN
    if (Number.isNaN(ms)) throw new ApiError('invalid_input', 'Say when the comment should go out.')
    const now = this.core.clock.now().getTime()
    if (ms <= now) throw new ApiError('invalid_input', 'That time has already passed. Pick a time in the future.')
    if (ms - now > SCHEDULE_MAX_MS) throw new ApiError('invalid_input', `A comment can be scheduled up to ${COMMENT_SCHEDULE_MAX_DAYS} days ahead.`)
    return new Date(ms).toISOString()
  }

  /**
   * What every press needs before anything is sent or planned: the text, the checks of the post, the place and the channel, the item of this place, and the
   * draft and the owner's approval of exactly this text (unless `approve` is off: "Edit in full" only keeps the draft). Either a sentence that says why not,
   * as a result, or the item.
   */
  private async prepare(finding: Finding, place: FindingPlace | null, rawText: string, options: { approve: boolean; anyway: boolean }): Promise<{ opp: Opportunity } | { stop: FindingSendResult }> {
    if (typeof rawText !== 'string') throw new ApiError('invalid_input', 'The comment must be text.')
    const text = rawText.trim()
    if (text === '') throw new ApiError('invalid_input', 'The comment is empty.')
    if (text.length > TEXT_MAX) throw new ApiError('invalid_input', `The comment is longer than ${TEXT_MAX} characters.`)
    const fresh = this.findings.get(finding.id)
    const channel = this.store.requireChannel(fresh.channelId)

    const stopped = this.blocked(fresh, channel)
    if (stopped) return { stop: refused(stopped) }
    const target = this.target(fresh, channel, place)
    if (typeof target === 'string') return { stop: refused(target) }
    if (options.approve && this.alreadySent(fresh.id, text)) return { stop: refused('Exactly this text was already sent under this post, so it is not sent a second time.') }

    // From here something is written: the stored post, its comment and the opportunity of this place.
    const discussion = this.store.findingDiscussion(fresh)
    const comment = target.comment ? this.store.findingComment(fresh, discussion, target.comment, target.fingerprint) : null
    const existing = comment ? this.store.opportunityForComment(comment.id) : this.store.opportunityForPost(discussion.id)
    const early = existing ? this.settledEarlier(existing) : null
    if (early) return { stop: early }
    const opp = existing ?? this.store.createFindingReply(channel, fresh, discussion, comment, target.destination)
    const created = existing === null

    try {
      const latest = this.core.repos.latestDraft(opp.id)
      if (!latest || latest.text.trim() !== text) await this.review.saveDraft(opp.id, { text }, { author: 'user' })
      // The owner's press is the approval of exactly this text, for this account and this place.
      if (options.approve) await this.review.approve(opp.id, { acknowledge: options.anyway ? ['community_rules'] : [] })
    } catch (error) {
      if (created) this.core.db.prepare('DELETE FROM opportunities WHERE id = ?').run(opp.id)
      if (error instanceof ApiError) return { stop: refused(error.message) }
      throw error
    }
    return { opp: this.store.requireOpportunity(opp.id) }
  }

  /** The place to answer, checked against the thread as it is stored now; a sentence when it cannot be answered. */
  private target(
    finding: Finding,
    channel: Channel,
    place: FindingPlace | null
  ): string | { comment: { author: string; text: string; url: string } | null; fingerprint: string; destination: string } {
    if (place === null) return this.destinationProblem(finding.url, channel) ?? { comment: null, fingerprint: '', destination: finding.url }
    if (typeof place.author !== 'string' || typeof place.text !== 'string') throw new ApiError('invalid_input', 'Say which comment to answer.')
    const thread = this.findings.thread(finding.id)
    const fingerprint = commentFingerprint(place.author, place.text)
    const same = thread.filter((c) => commentFingerprint(c.author, c.text) === fingerprint)
    if (same.length === 0) return 'The AI has read this post again and that comment is not in the thread any more. Close this window and pick the comment again.'
    if (same.length > 1) return 'Two comments of the thread read the same, so the application cannot tell which one you mean. Open the post and answer there.'
    const found: FindingComment = same[0]
    const account = this.core.repos.account(channel.accountId)
    const identity = normalizeIdentity(account.identity)
    if (identity !== '' && normalizeIdentity(found.author) === identity) return 'That comment is by your own account: it is not answered from here.'
    if (found.url.trim() === '') {
      return 'This comment has no address of its own that the AI could open. Press Check again with AI to look for it, or answer it on the post yourself.'
    }
    return this.destinationProblem(found.url, channel) ?? { comment: { author: found.author, text: found.text, url: found.url }, fingerprint, destination: found.url }
  }

  /** The AI opens only this channel's own site: the address of the post or of the comment must be a web address on it. */
  private destinationProblem(url: string, channel: Channel): string | null {
    if (!isHttp(url)) return 'The address of the place to answer is not a web address.'
    const hosts = missionHosts(channel.url)
    const here = missionHosts(url)
    if (here.length === 0 || !here.every((host) => hosts.includes(host))) return 'The post is not on this channel\'s site, so the AI is not sent to it.'
    return null
  }

  /** Whether exactly this text went out (or may have) under this post: a second press must not post it again. */
  private alreadySent(findingId: Id, text: string): boolean {
    const row = this.core.db
      .prepare(
        `SELECT 1 AS found FROM send_actions a
           JOIN opportunities o ON o.id = a.opportunity_id
           JOIN drafts d ON d.id = a.draft_id
          WHERE o.finding_id = ? AND a.state IN ('confirmed', 'unknown', 'sending') AND TRIM(d.text) = ? LIMIT 1`
      )
      .get(findingId, text)
    return row !== undefined
  }

  /** What an earlier opportunity of this place says when it cannot be sent again; null when it can be taken up. */
  private settledEarlier(opp: Opportunity): FindingSendResult | null {
    switch (opp.state) {
      case 'confirmed':
        return { state: 'sent', message: 'A comment was already posted here.', opportunityId: opp.id, url: '' }
      case 'sending':
        return { state: 'held', message: 'A comment is being posted here right now.', opportunityId: opp.id, url: '' }
      case 'unknown_result':
        return { state: 'unknown', message: 'An earlier comment to this place has a result nobody knows. Look at the post and say whether it is there; until then nothing more is sent here.', opportunityId: opp.id, url: '' }
      case 'cancelled':
        return { state: 'refused', message: `An earlier attempt here was stopped for good: ${opp.reason || 'it was cancelled'}.`, opportunityId: opp.id, url: '' }
      default:
        return null
    }
  }
}
