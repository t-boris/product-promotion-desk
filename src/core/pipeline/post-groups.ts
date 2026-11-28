// One post for several channels (DEC-032). The owner writes a post once; each channel gets a version of it. A group is a wrapper and nothing
// more: every version is an ordinary standalone opportunity of one channel, with its own drafts, its own approval (bound to its own exact
// content, account and destination), its own send and its own failure. The gate, the hash, the sending flow and the scheduler do not know
// groups exist, so what the owner approved is what is sent, as for a single post, and a version that fails never holds another back.
//
// What a group adds is only convenience, and every step of it is the owner's press or a proposal:
//  - the AI rewrites the master for each platform (`adapt`); a version the owner changed by hand, or approved, is left alone unless the owner
//    points at it, and the AI's text never replaces what the owner wrote while it was being written;
//  - one press approves every version after the owner has read it (`approve`): each by its own approval, only for the draft the owner was
//    shown (`seen`), and a version that cannot be approved is named with its reason and left out;
//  - one press sends the versions that were approved at that moment, one after another (`sendAll`): a version approved, changed or edited
//    after the press is not sent by it.
// Nothing here approves or sends by itself: this file is not reached from the scheduler.

import { ApiError, type DraftInput } from '../../shared/api'
import { hasTopicField } from '../../shared/topic-tag'
import { characterCount, formOf, judgedForFit, kindsOf, platformLabel, renderForPlatform, siteLinkFor, type PostContent, type SendWays } from '../../shared/post-format'
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
import { chooseExecutor, sendFitProblems, sendWays } from './send-ways'
import type { SendingFlow } from './sending'
import { SEND_LOCKED_STATES, type FlowStore } from './store'
import { errorMessage } from './util'

/** A pause between one send of a group and the next: the sites see a person posting, not a burst. */
export const GROUP_SEND_GAP_MS = 5000

const FINISHED: Opportunity['state'][] = ['sending', 'confirmed', 'unknown_result']
const NOT_PUBLISHABLE = ['unavailable', 'restricted']
const BLOCKS_A_SEND = ['unavailable', 'restricted', 'needs_user']
/** A platform with a limit above this has none worth telling the AI (Reddit's 40,000 is not a limit a post is shortened for). */
const WISH_LIMIT_MAX = 5000

export interface PostGroupsOptions {
  /** The pause between two sends; tests make it nothing. */
  sleep?: (ms: number) => Promise<void>
  gapMs?: number
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** The wish to the AI for one platform, in the words of the platform's own limits (it must stay within the AI helper's length for a wish). */
export function adaptInstruction(platform: string, link: string | null = null): string {
  const form = formOf(platform)
  const parts = [`Adapt this post for ${platformLabel(platform)}.`, form.format === 'markdown' ? 'Markdown is fine.' : 'Write plain text with no markdown marks.']
  if (form.textLimit !== null && form.textLimit <= WISH_LIMIT_MAX) {
    // Where the link goes at the end of the text (DEC-036) it takes room of the limit: the words get what is left.
    const taken = form.link === 'in_text' && link?.trim() ? characterCount(link.trim()) + 2 : 0
    const room = form.textLimit - taken > 20 ? form.textLimit - taken : form.textLimit
    parts.push(room < form.textLimit ? `At most ${room} characters, because the link is added after the text (aim for ${Math.floor(room * 0.9)}).` : `At most ${form.textLimit} characters (aim for ${Math.floor(form.textLimit * 0.9)}).`)
  }
  parts.push('Keep the meaning, every fact and every link; add no new claim.')
  return parts.join(' ')
}

/** `siteLink`: the site's address the core put at the end of this version's first draft (DEC-044): it is not a change the owner made. */
const sameMaster = (draft: Draft, master: PostMaster, siteLink: string | null): boolean =>
  draft.title === master.title &&
  draft.text === master.text &&
  (draft.link === master.link || (master.link === null && siteLink !== null && draft.link === siteLink)) &&
  draft.markup === master.markup &&
  draft.postType === (master.postType ?? 'article') &&
  JSON.stringify(draft.attachments.map((a) => a.sha256)) === JSON.stringify(master.attachments.map((a) => a.sha256))

/** The owner changed this version by hand: the latest draft is theirs and is not the master any more. */
export const editedByHand = (draft: Draft | null, master: PostMaster, siteLink: string | null = null): boolean => draft !== null && draft.author === 'user' && !sameMaster(draft, master, siteLink)

const labelOf = (channel: Channel): string => `${platformLabel(channel.platform)} ${channel.target}`

/**
 * Where the master came from, copied into every version made from it: a post the AI proposed from approved facts keeps the facts it stands on,
 * so a fact that is withdrawn later returns every copy of it to review, not only the first.
 */
interface Provenance {
  knowledgeVersionId: Id | null
  usedClaimLineageIds: Id[]
  rationale: string
  author: 'ai' | 'user'
}

const OWN_WORDS: Provenance = { knowledgeVersionId: null, usedClaimLineageIds: [], rationale: '', author: 'user' }

type StoredGroup = PostGroup & { provenance: Provenance }

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
    // A quick post's group carries its type and card, so every version is a quick post with the same picture (DEC-046).
    if (content.postType === 'quick') {
      master.postType = 'quick'
      master.card = content.card ?? null
    }
    const id = this.core.db.transaction(() => {
      const group = this.insertGroup(productId, master, OWN_WORDS)
      // The topic the owner typed is no part of the master (it is not words): it goes to the versions of the platforms that have a field for it.
      for (const channel of channels) this.addVersion(group, channel, content.topicTag ?? null)
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
      let group: StoredGroup
      if (opp.groupId) group = this.requireGroup(opp.groupId)
      else {
        const master: PostMaster = { title: draft.title, text: draft.text, link: draft.link, attachments: draft.attachments, markup: draft.markup }
        if (draft.postType === 'quick') {
          master.postType = 'quick'
          master.card = draft.card
        }
        const provenance: Provenance = { knowledgeVersionId: draft.knowledgeVersionId, usedClaimLineageIds: draft.usedClaimLineageIds, rationale: draft.rationale, author: draft.author }
        group = this.insertGroup(opp.productId, master, provenance)
        this.store.updateOpportunity(opp.id, { groupId: group.id })
      }
      const taken = new Set(this.liveVersions(group.id).map((v) => v.channelId))
      const channels = this.channelsOf(opp.productId, channelIds.filter((c) => !taken.has(c)), 1)
      for (const channel of channels) this.addVersion(group, channel, draft.topicTag)
      return group.id
    })()
    this.store.notify()
    return this.get(id)
  }

  // ───────────── reading ─────────────

  get(id: Id): PostGroupCard {
    const { provenance: _provenance, ...group } = this.requireGroup(id)
    const versions = this.liveVersions(id).map((opp): PostVersion => {
      const card = buildCard(this.core, this.store, opp)
      const channel = this.store.requireChannel(opp.channelId)
      const ways = sendWays(this.core, undefined, channel)
      const draft = card.draft
      const account = this.core.repos.account(channel.accountId)
      const problems: string[] = []
      if (draft) {
        problems.push(...this.fitProblems(channel.platform, draft, ways))
      }
      const unavailable = this.availabilityProblem(channel, account.status)
      if (unavailable) problems.push(unavailable)
      return {
        card,
        problems,
        edited: editedByHand(draft, group.master, this.siteLinkOf(group.productId, channel)),
        // A channel no connector can post to goes out by the AI browser or not at all: the line names that way, and the problems say what stops it now.
        way: ways.noConnector ? 'ai_browser' : draft ? chooseExecutor(ways, draft, channel.platform) : 'connector'
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
   * It judges what the approval judges (the platform's limits and pictures).
   */
  channels(productId: Id, input: DraftInput, chosen: Id[] = []): GroupChannelOption[] {
    const content: PostContent = {
      title: (input.title ?? '').trim() || null,
      text: (input.text ?? '').trim(),
      link: (input.link ?? '').trim() || null,
      attachments: input.attachments ?? [],
      markup: input.markup === 'markdown' ? 'markdown' : 'legacy',
      ...(input.postType === 'quick' ? { postType: 'quick' as const } : {})
    }
    const options: GroupChannelOption[] = []
    for (const channel of this.core.repos.listChannels().filter((c) => c.productId === productId)) {
      const publish = channel.capabilities.find((c) => c.key === 'publish_post')
      if (publish && NOT_PUBLISHABLE.includes(publish.status)) continue
      const account = this.core.repos.account(channel.accountId)
      const rendered = renderForPlatform(content, channel.platform)
      const problems = this.fitProblems(channel.platform, content, sendWays(this.core, undefined, channel))
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

  /**
   * The AI rewrites the master for each version's platform. It stores a new draft by the AI; any approval of the version no longer applies.
   * Without `opportunityIds` it leaves alone what the owner has a claim on: a version they changed by hand, one they approved, one they put
   * off, one that was sent. Naming a version asks for it (an edited one also needs `force`). If the owner changes a version while the AI is
   * writing, the AI's text is dropped and the owner's stays.
   */
  async adapt(id: Id, opportunityIds: Id[] | undefined, force: boolean): Promise<PostGroupOutcome> {
    const group = this.requireGroup(id)
    if (opportunityIds && opportunityIds.some((one) => !this.liveVersions(id).some((v) => v.id === one))) {
      throw new ApiError('invalid_input', 'That is not a version of this post.')
    }
    this.claim(id)
    try {
      const results: PostGroupResult[] = []
      for (const opp of this.liveVersions(id)) {
        const picked = opportunityIds !== undefined
        if (picked && !opportunityIds.includes(opp.id)) continue
        const channel = this.store.requireChannel(opp.channelId)
        const label = labelOf(channel)
        const skip = (reason: string): void => {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason })
        }
        const draft = this.core.repos.latestDraft(opp.id)
        if (!draft) skip('It has no text yet.')
        else if (SEND_LOCKED_STATES.includes(opp.state)) skip('It was sent already.')
        else if (group.master.text.trim() === '') skip('The post has no words to adapt (only a picture or a link).')
        else if (editedByHand(draft, group.master, this.siteLinkOf(group.productId, channel)) && !force) skip('You changed it by hand, so it was left as it is. Start over to let the AI adapt it again.')
        else if (!picked && opp.state === 'deferred') skip('You put it off, so it was left as it is. Choose it to adapt it.')
        else if (!picked && this.core.repos.activeApproval(draft.id)) skip('You approved it, so it was left as it is. Choose it to adapt it again (that cancels its approval).')
        else {
          try {
            const written = await this.help.refine({
              field: 'text',
              opportunityId: opp.id,
              form: { title: group.master.title ?? '', text: group.master.text },
              instruction: adaptInstruction(channel.platform, group.master.link)
            })
            const text = (written.text ?? '').trim()
            if (!text) throw new ApiError('suggest_failed', 'The AI gave back no text.')
            // Only if the version is still the draft that was adapted: a hand edit made while the AI wrote is not replaced.
            // The version stands on the master, with the site's address its first draft was given (DEC-044), so the rewrite does not lose it.
            await this.review.saveDraft(opp.id, { ...group.master, text, link: group.master.link ?? this.siteLinkOf(group.productId, channel) }, { author: 'ai', expectDraftId: draft.id })
            const saved = this.core.repos.latestDraft(opp.id)
            const problems = saved ? this.fitProblems(channel.platform, saved, sendWays(this.core, undefined, channel)) : []
            results.push({ opportunityId: opp.id, channelLabel: label, status: 'done', reason: problems.length > 0 ? `Adapted, but ${problems[0]}` : 'Adapted. Read it, then approve.' })
          } catch (error) {
            if (error instanceof ApiError && error.code === 'conflict') skip('You changed it while the AI was writing, so the AI\'s text was dropped.')
            else results.push({ opportunityId: opp.id, channelLabel: label, status: 'failed', reason: errorMessage(error) })
          }
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
    if (typeof seen !== 'object' || seen === null || Array.isArray(seen)) throw new ApiError('invalid_input', 'Say which text of each version you were shown.')
    this.claim(id)
    try {
      const results: PostGroupResult[] = []
      for (const opp of this.liveVersions(id)) {
        const label = labelOf(this.store.requireChannel(opp.channelId))
        const skip = (reason: string): void => {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason })
        }
        if (FINISHED.includes(opp.state)) {
          skip('It was sent already.')
          continue
        }
        const draft = this.core.repos.latestDraft(opp.id)
        if (!draft) skip('It has no text yet.')
        else if (seen[opp.id] === undefined) skip('It was not shown to you: read it, then approve.')
        else if (seen[opp.id] !== draft.id) skip('It changed after you looked at it: read it again, then approve.')
        else {
          // The approval is the single post's: its checks, its hash, its refusals (the platform's limits, a picture that is gone).
          try {
            await this.review.approve(opp.id)
            results.push({ opportunityId: opp.id, channelLabel: label, status: 'done', reason: 'Approved.' })
          } catch (error) {
            skip(errorMessage(error))
          }
        }
      }
      return { card: this.get(id), results }
    } finally {
      this.busy.delete(id)
    }
  }

  /**
   * The owner's one press. It sends the versions that were approved AT THAT MOMENT, as they were approved (the approval of each is
   * noted at the press): one approved, changed or edited afterwards is not sent by it. They go out one after another with a pause; one that
   * fails or is held stops nothing else.
   */
  async sendAll(id: Id): Promise<PostGroupOutcome> {
    this.requireGroup(id)
    this.claim(id)
    try {
      // version -> the approval it had at the press (an approval is of one exact draft, so this says both)
      const pressed = new Map<Id, Id>()
      for (const opp of this.liveVersions(id)) {
        if (opp.state !== 'ready') continue
        const draft = this.core.repos.latestDraft(opp.id)
        const approval = draft ? this.core.repos.activeApproval(draft.id) : null
        if (approval) pressed.set(opp.id, approval.id)
      }
      const results: PostGroupResult[] = []
      let first = true
      for (const opp of this.liveVersions(id)) {
        const label = labelOf(this.store.requireChannel(opp.channelId))
        const skip = (reason: string): void => {
          results.push({ opportunityId: opp.id, channelLabel: label, status: 'skipped', reason })
        }
        const mark = pressed.get(opp.id)
        if (FINISHED.includes(opp.state)) skip('It was sent already.')
        else if (opp.scheduledAt && opp.scheduledAt > this.store.now()) skip(`It is scheduled for ${opp.scheduledAt}: it goes out then, or press Send on it.`)
        else if (!mark) skip('It was not approved when you pressed Send all.')
        else {
          // An approval is of one exact draft and ends with any edit, deferral or withdrawal: the same approval still active is the same post.
          const draft = this.core.repos.latestDraft(opp.id)
          const approval = draft ? this.core.repos.activeApproval(draft.id) : null
          if (approval?.id !== mark) {
            skip('It changed after you pressed Send all, so it was not sent.')
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
            skip(error instanceof SendBlockedError ? error.message : errorMessage(error))
          }
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

  private requireGroup(id: Id): StoredGroup {
    const row = this.core.db.prepare('SELECT id, product_id, master_json, created_at FROM post_groups WHERE id = ?').get(id) as
      | { id: string; product_id: string; master_json: string; created_at: string }
      | undefined
    if (!row) throw new ApiError('not_found', 'This post for several channels does not exist.')
    const { provenance, ...master } = JSON.parse(row.master_json) as PostMaster & { provenance?: Provenance }
    return { id: row.id, productId: row.product_id, master, createdAt: row.created_at, provenance: provenance ?? OWN_WORDS }
  }

  private insertGroup(productId: Id, master: PostMaster, provenance: Provenance): StoredGroup {
    const id = newId()
    const createdAt = this.store.now()
    this.core.db.prepare('INSERT INTO post_groups (id, product_id, master_json, created_at) VALUES (?, ?, ?, ?)').run(id, productId, toJson({ ...master, provenance }), createdAt)
    return { id, productId, master, createdAt, provenance }
  }

  /** The site's address that ends a new post on this channel (DEC-044), or null: what the first draft of a version was given besides the master. */
  private siteLinkOf(productId: Id, channel: Channel): string | null {
    return siteLinkFor(channel.platform, this.core.repos.product(productId), channel.target)
  }

  /** A version is an ordinary standalone post of one channel, written from the master and standing on the same facts. */
  private addVersion(group: StoredGroup, channel: Channel, topicTag: string | null = null): void {
    const opp = this.store.createStandalone(channel, 'draft', 'Written by you, for several channels', group.id)
    this.store.insertDraft(opp.id, topicTag && hasTopicField(channel.platform) ? { ...group.master, topicTag } : group.master, group.provenance)
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

  /**
   * What the platform will refuse about this post as it is: for a post written in the editor, what the approval refuses (limits, pictures, the
   * ways to carry them); for an older one the approval checks nothing, but a text longer than the platform takes is still said.
   */
  private fitProblems(platform: string, content: PostContent, ways: SendWays): string[] {
    if (judgedForFit(content)) return sendFitProblems(this.core, content, platform, ways)
    const rendered = renderForPlatform(content, platform)
    const limit = formOf(platform).textLimit
    return limit !== null && rendered.text.length > limit ? [`the text is longer than ${platformLabel(platform)} takes (${rendered.text.length} of ${limit} characters).`] : []
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
    const { pictures, videos } = kindsOf(content.attachments)
    if (form.videos === 'required') return `${label} needs a video, and this post has ${videos === 1 ? 'one' : videos === 0 ? 'none' : videos}.`
    if (form.pictures === 'required') return videos > 0 && form.videos !== 'none' ? `${label} takes it with its video.` : `${label} needs a picture, and this post has ${pictures === 1 ? 'one' : pictures}.`
    if (form.textLimit !== null && form.textLimit <= WISH_LIMIT_MAX) return `${text.length} of ${form.textLimit} characters.`
    return `${label} takes it as written.`
  }
}
