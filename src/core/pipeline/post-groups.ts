// One post for several channels (DEC-032). The owner writes a post once; each channel gets a version of it. A group is a wrapper and nothing
// more: every version is an ordinary standalone opportunity of one channel, with its own drafts, its own approval (bound to its own exact
// content, account and destination), its own send and its own failure. The gate, the hash, the sending flow and the scheduler do not know
// groups exist, so what the owner approved is what is sent, as for a single post, and a version that fails never holds another back.
//
// What a group adds is only convenience, and every step of it is the owner's press or a proposal:
//  - the AI rewrites the master for each platform (`adapt`); a version the owner changed by hand is left alone unless asked to start over;
//  - one press approves every version after the owner has read it (`approve`): each by its own approval, only for the draft the owner was
//    shown (`seen`), and a version that cannot be approved is named with its reason and left out;
//  - one press sends the approved versions one after another (`sendAll`).
// Nothing here approves or sends by itself: this file is not reached from the scheduler.

import { ApiError, type DraftInput } from '../../shared/api'
import { formOf, platformLabel, renderForPlatform, sendProblems, type PostContent } from '../../shared/post-format'
import type {
  Channel,
  Draft,
  GroupChannelOption,
  Id,
  Opportunity,
  PostGroup,
  PostGroupCard,
  PostGroupOutcome,
  PostGroupResult,
  PostMaster,
  PostVersion
} from '../../shared/types'
import { newId, toJson } from '../db/database'
import type { Core } from '../core'
import { buildCard } from './cards'
import { normalizeDraftInput } from './draft-input'
import type { DraftHelp } from './draft-help'
import { SendBlockedError } from './gate'
import type { ReviewFlow } from './review'
import { chooseExecutor, sendWays } from './send-ways'
import type { SendingFlow } from './sending'
import { SEND_LOCKED_STATES, type FlowStore } from './store'
import { errorMessage } from './util'

/** A pause between one send of a group and the next: the sites see a person posting, not a burst. */
export const GROUP_SEND_GAP_MS = 5000

const FINISHED: Opportunity['state'][] = ['sending', 'confirmed', 'unknown_result']
const NOT_PUBLISHABLE = ['unavailable', 'restricted']
const BLOCKS_A_SEND = ['unavailable', 'restricted', 'needs_user']

export interface PostGroupsOptions {
  /** The pause between two sends; tests make it nothing. */
  sleep?: (ms: number) => Promise<void>
  gapMs?: number
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The wish to the AI for one platform, in the words of the platform's own limits (it must stay within the AI helper's length for a wish). */
export function adaptInstruction(platform: string): string {
  const form = formOf(platform)
  const parts = [`Adapt this post for ${platformLabel(platform)}.`, form.format === 'markdown' ? 'Markdown is fine.' : 'Write plain text with no markdown marks.']
  if (form.textLimit !== null && form.textLimit <= 5000) parts.push(`At most ${form.textLimit} characters (aim for ${Math.floor(form.textLimit * 0.9)}).`)
  parts.push('Keep the meaning, every fact and every link; add no new claim.')
  return parts.join(' ')
}

const sameMaster = (draft: Draft, master: PostMaster): boolean =>
  draft.title === master.title &&
  draft.text === master.text &&
  draft.link === master.link &&
  draft.markup === master.markup &&
  JSON.stringify(draft.attachments.map((a) => a.sha256)) === JSON.stringify(master.attachments.map((a) => a.sha256))

/** The owner changed this version by hand: the latest draft is theirs and is not the master any more. */
export const editedByHand = (draft: Draft | null, master: PostMaster): boolean => draft !== null && draft.author === 'user' && !sameMaster(draft, master)

const labelOf = (channel: Channel): string => `${platformLabel(channel.platform)} ${channel.target}`

export class PostGroupsFlow {
  private readonly busy = new Set<Id>()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly review: Pick<ReviewFlow, 'approve' | 'saveDraft' | 'reject'>,
    private readonly sending: Pick<SendingFlow, 'send'>,
    private readonly help: Pick<DraftHelp, 'refine'>,
    private readonly options: PostGroupsOptions = {}
  ) {}

  // ───────────── making a group ─────────────

  async create(productId: Id, channelIds: Id[], input: DraftInput): Promise<PostGroupCard> {
    const channels = this.channelsOf(productId, channelIds, 2)
    const content = await normalizeDraftInput(input, { productId, media: this.core.services.media! })
    if (!content.text && !content.link && content.attachments.length === 0) throw new ApiError('invalid_input', 'A post needs text, a link or a picture.')
    const master: PostMaster = { title: content.title, text: content.text, link: content.link, attachments: content.attachments, markup: content.markup ?? 'legacy' }
    const id = this.core.db.transaction(() => {
      const group = this.insertGroup(productId, master)
      for (const channel of channels) this.addVersion(group, channel)
      return group.id
    })()
    this.core.log.info('pipeline', `A post was written for ${channels.length} channels`, productId)
    this.store.notify()
    return this.get(id)
  }

  /** "Also post to…": the owner's existing post joins a group (made from it if it has none) and gets a version for each of the channels. */
  async extend(opportunityId: Id, channelIds: Id[]): Promise<PostGroupCard> {
    const opp = this.store.requireOpportunity(opportunityId)
    if (opp.kind !== 'standalone') throw new ApiError('invalid_state', 'Only a post of your own can go to more channels.')
    if (opp.state === 'cancelled') throw new ApiError('invalid_state', 'This post was deleted.')
    const draft = this.core.repos.latestDraft(opp.id)
    if (!draft) throw new ApiError('no_draft', 'This post has no text yet.')
    const id = this.core.db.transaction(() => {
      let group: PostGroup
      if (opp.groupId) group = this.requireGroup(opp.groupId)
      else {
        group = this.insertGroup(opp.productId, { title: draft.title, text: draft.text, link: draft.link, attachments: draft.attachments, markup: draft.markup })
        this.store.updateOpportunity(opp.id, { groupId: group.id })
      }
      const taken = new Set(this.liveVersions(group.id).map((v) => v.channelId))
      const channels = this.channelsOf(opp.productId, channelIds.filter((c) => !taken.has(c)), 1)
      for (const channel of channels) this.addVersion(group, channel)
      return group.id
    })()
    this.store.notify()
    return this.get(id)
  }

  // ───────────── reading ─────────────

  get(id: Id): PostGroupCard {
    const group = this.requireGroup(id)
    const ways = sendWays(this.core)
    const versions = this.liveVersions(id).map((opp): PostVersion => {
      const card = buildCard(this.core, this.store, opp)
      const channel = this.store.requireChannel(opp.channelId)
      const draft = card.draft
      const account = this.core.repos.account(channel.accountId)
      const problems: string[] = []
      if (draft && draft.markup === 'markdown') problems.push(...sendProblems(channel.platform, renderForPlatform(draft, channel.platform), ways))
      const unavailable = this.availabilityProblem(channel, account.status)
      if (unavailable) problems.push(unavailable)
      return {
        card,
        problems,
        edited: editedByHand(draft, group.master),
        way: draft ? chooseExecutor(ways, draft, channel.platform) : 'connector'
      }
    })
    return { group, versions }
  }

  list(productId: Id): PostGroupCard[] {
    const rows = this.core.db
      .prepare(
        `SELECT g.id FROM post_groups g WHERE g.product_id = ? AND EXISTS (SELECT 1 FROM opportunities o WHERE o.group_id = g.id AND o.state <> 'cancelled') ORDER BY g.rowid DESC`
      )
      .all(productId) as { id: string }[]
    return rows.map((r) => this.get(r.id))
  }

  /**
   * Every channel of the product that could carry a post, and whether this post fits it as it is. The app suggests those that fit and are not
   * chosen yet; it chooses nothing. A rule, not the AI: the limits of a platform are facts, and a post that does not fit says what is wrong.
   */
  channels(productId: Id, input: DraftInput, chosen: Id[] = []): GroupChannelOption[] {
    const content: PostContent = {
      title: (input.title ?? '').trim() || null,
      text: (input.text ?? '').trim(),
      link: (input.link ?? '').trim() || null,
      attachments: input.attachments ?? [],
      markup: input.markup === 'markdown' ? 'markdown' : 'legacy'
    }
    const ways = sendWays(this.core)
    const options: GroupChannelOption[] = []
    for (const channel of this.core.repos.listChannels().filter((c) => c.productId === productId)) {
      const publish = channel.capabilities.find((c) => c.key === 'publish_post')
      if (publish && NOT_PUBLISHABLE.includes(publish.status)) continue
      const account = this.core.repos.account(channel.accountId)
      const rendered = renderForPlatform(content, channel.platform)
      const problems = sendProblems(channel.platform, rendered, ways)
      const unavailable = this.availabilityProblem(channel, account.status)
      const fits = problems.length === 0 && unavailable === null
      options.push({
        channelId: channel.id,
        platform: channel.platform,
        target: channel.target,
        accountLabel: account.label,
        fits,
        reason: fits ? this.fitReason(channel.platform, rendered.text, content) : (unavailable ?? problems[0] ?? ''),
        suggested: fits && !chosen.includes(channel.id)
      })
    }
    return options.sort((a, b) => Number(b.fits) - Number(a.fits) || a.platform.localeCompare(b.platform) || a.target.localeCompare(b.target))
  }

  // ───────────── the group-wide steps (each is the owner's press) ─────────────

  /** The AI rewrites the master for each version's platform. It stores a new draft by the AI; any approval of the version no longer applies. */
  async adapt(id: Id, opportunityIds: Id[] | undefined, force: boolean): Promise<PostGroupOutcome> {
    const group = this.requireGroup(id)
    this.claim(id)
    try {
      const results: PostGroupResult[] = []
      for (const opp of this.liveVersions(id)) {
        if (opportunityIds && !opportunityIds.includes(opp.id)) continue
        const channel = this.store.requireChannel(opp.channelId)
        const label = labelOf(channel)
        const draft = this.core.repos.latestDraft(opp.id)
        if (SEND_LOCKED_STATES.includes(opp.state)) {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason: 'It was sent already.' })
          continue
        }
        if (editedByHand(draft, group.master) && !force) {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason: 'You changed it by hand, so it was left as it is. Start over to let the AI adapt it again.' })
          continue
        }
        try {
          const written = await this.help.refine({
            field: 'text',
            opportunityId: opp.id,
            form: { title: group.master.title ?? '', text: group.master.text },
            instruction: adaptInstruction(channel.platform)
          })
          const text = (written.text ?? '').trim()
          if (!text) throw new ApiError('suggest_failed', 'The AI gave back no text.')
          await this.review.saveDraft(opp.id, { ...group.master, text }, { author: 'ai' })
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'done', reason: 'Adapted. Read it, then approve.' })
        } catch (error) {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'failed', reason: errorMessage(error) })
        }
      }
      return { card: this.get(id), results }
    } finally {
      this.busy.delete(id)
    }
  }

  /**
   * The owner's one press, after reading every version. Each version is approved by the same call as a single post (its own checks, its own
   * hash), and only if its latest draft is the one the owner was shown: a version that changed since is left for the owner to read again.
   */
  async approve(id: Id, seen: Record<Id, Id>): Promise<PostGroupOutcome> {
    this.requireGroup(id)
    const results: PostGroupResult[] = []
    for (const opp of this.liveVersions(id)) {
      const label = labelOf(this.store.requireChannel(opp.channelId))
      if (FINISHED.includes(opp.state)) {
        results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason: 'It was sent already.' })
        continue
      }
      const draft = this.core.repos.latestDraft(opp.id)
      if (!draft || seen[opp.id] !== draft.id) {
        results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason: draft ? 'It changed after you looked at it: read it again, then approve.' : 'It has no text yet.' })
        continue
      }
      // The approval is the single post's: its checks, its hash, its refusals (the platform's limits, the disclosure, a picture that is gone).
      try {
        await this.review.approve(opp.id)
        results.push({ opportunityId: opp.id, channelLabel: label, status: 'done', reason: 'Approved.' })
      } catch (error) {
        results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason: errorMessage(error) })
      }
    }
    return { card: this.get(id), results }
  }

  /** The owner's one press: the approved versions go out one after another, a pause between; one that fails or is held stops nothing else. */
  async sendAll(id: Id): Promise<PostGroupOutcome> {
    this.requireGroup(id)
    this.claim(id)
    try {
      const results: PostGroupResult[] = []
      let first = true
      for (const opp of this.liveVersions(id)) {
        const label = labelOf(this.store.requireChannel(opp.channelId))
        if (FINISHED.includes(opp.state)) {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason: 'It was sent already.' })
          continue
        }
        if (this.store.requireOpportunity(opp.id).state !== 'ready') {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason: 'It is not approved yet.' })
          continue
        }
        if (!first) await (this.options.sleep ?? realSleep)(this.options.gapMs ?? GROUP_SEND_GAP_MS)
        first = false
        try {
          const action = await this.sending.send(opp.id)
          if (action.state === 'confirmed') results.push({ opportunityId: opp.id, channelLabel: label, status: 'done', reason: 'Published.' })
          else if (action.state === 'unknown') results.push({ opportunityId: opp.id, channelLabel: label, status: 'failed', reason: 'The result is unknown: check the page, then say whether it was published.' })
          else results.push({ opportunityId: opp.id, channelLabel: label, status: 'failed', reason: action.error ?? 'It was not published.' })
        } catch (error) {
          const reason = error instanceof SendBlockedError ? error.message : errorMessage(error)
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason })
        }
      }
      return { card: this.get(id), results }
    } finally {
      this.busy.delete(id)
    }
  }

  /** Deletes the versions that were not sent. A version that was sent stays, as an ordinary post. */
  remove(id: Id): PostGroupCard {
    this.requireGroup(id)
    for (const opp of this.liveVersions(id)) {
      if (SEND_LOCKED_STATES.includes(opp.state)) continue
      this.review.reject(opp.id, 'Deleted with its post for several channels.')
    }
    return this.get(id)
  }

  // ───────────── parts ─────────────

  private claim(id: Id): void {
    if (this.busy.has(id)) throw new ApiError('busy', 'This post is being worked on right now. Wait until it is done.')
    this.busy.add(id)
  }

  private requireGroup(id: Id): PostGroup {
    const row = this.core.db.prepare('SELECT id, product_id, master_json, created_at FROM post_groups WHERE id = ?').get(id) as
      | { id: string; product_id: string; master_json: string; created_at: string }
      | undefined
    if (!row) throw new ApiError('not_found', 'This post for several channels does not exist.')
    return { id: row.id, productId: row.product_id, master: JSON.parse(row.master_json) as PostMaster, createdAt: row.created_at }
  }

  private insertGroup(productId: Id, master: PostMaster): PostGroup {
    const id = newId()
    const createdAt = this.store.now()
    this.core.db.prepare('INSERT INTO post_groups (id, product_id, master_json, created_at) VALUES (?, ?, ?, ?)').run(id, productId, toJson(master), createdAt)
    return { id, productId, master, createdAt }
  }

  /** A version is an ordinary standalone post of one channel, written from the master. */
  private addVersion(group: PostGroup, channel: Channel): void {
    const opp = this.store.createStandalone(channel, 'draft', 'Written by you, for several channels', group.id)
    this.store.insertDraft(opp.id, group.master, { knowledgeVersionId: null, usedClaimLineageIds: [], rationale: '', author: 'user' })
  }

  /** The versions in the order they were made (the order the owner chose the channels in). */
  private liveVersions(groupId: Id): Opportunity[] {
    const rows = this.core.db.prepare("SELECT id FROM opportunities WHERE group_id = ? AND state <> 'cancelled' ORDER BY rowid").all(groupId) as { id: string }[]
    return rows.map((r) => this.store.requireOpportunity(r.id))
  }

  /** The channels for a group: of this product, each once, each able to publish (what is only held for now is shown, not refused). */
  private channelsOf(productId: Id, channelIds: Id[], atLeast: number): Channel[] {
    const unique = [...new Set(channelIds)]
    if (unique.length < atLeast) throw new ApiError('invalid_input', atLeast > 1 ? 'Choose two or more channels for one post.' : 'Choose the channels the post should also go to.')
    return unique.map((channelId) => {
      const channel = this.store.requireChannel(channelId)
      if (channel.productId !== productId) throw new ApiError('invalid_input', 'A post for several channels stays within one product.')
      const publish = channel.capabilities.find((c) => c.key === 'publish_post')
      if (publish && NOT_PUBLISHABLE.includes(publish.status)) throw new ApiError('channel_cannot_publish', `${labelOf(channel)} cannot publish posts (${publish.status}).`)
      return channel
    })
  }

  private availabilityProblem(channel: Channel, accountStatus: string): string | null {
    if (channel.status === 'paused') return 'The channel is paused.'
    if (channel.status === 'setup') return 'The channel is not set up yet.'
    if (accountStatus !== 'ready') return 'The account is not signed in.'
    const publish = channel.capabilities.find((c) => c.key === 'publish_post')
    if (publish && BLOCKS_A_SEND.includes(publish.status)) return `Posting is ${publish.status} here${publish.detail ? `: ${publish.detail}` : ''}.`
    return null
  }

  private fitReason(platform: string, text: string, content: PostContent): string {
    const form = formOf(platform)
    const label = platformLabel(platform)
    if (form.pictures === 'required') return `${label} needs a picture, and this post has ${content.attachments.length === 1 ? 'one' : content.attachments.length}.`
    if (form.textLimit !== null && form.textLimit <= 5000) return `${text.length} of ${form.textLimit} characters.`
    return `${label} takes it as written.`
  }
}
