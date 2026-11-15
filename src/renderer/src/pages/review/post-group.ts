// One post for several channels (DEC-032): what the screens say and decide about a group of versions. Pure, so every rule is tested without
// the interface. A group is a wrapper: each version is an ordinary post of one channel, so the words and rules of a single post still apply
// to it; what is decided here is only what the group as a whole offers (which main action, what is off and why, what a step reported).

import type { DraftInput } from '../../../../shared/api'
import { platformLabel } from '../../../../shared/post-format'
import type { Draft, GroupChannelOption, Id, OpportunityCard, OpportunityState, PostGroup, PostGroupResult, PostVersion, SendWay } from '../../../../shared/types'
import type { Tone } from '../../tone'
import { LOCKED_STATES } from './labels'

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

// ───────────── the group card ─────────────

const TITLE_WORDS = 8
const TITLE_CHARS = 80

/** The master's title, else its first words: what the group is called on the screen. */
export function groupTitle(group: PostGroup): string {
  const title = group.master.title?.trim()
  if (title) return title
  const words = group.master.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length === 0) return 'Post for several channels'
  const head = words.slice(0, TITLE_WORDS).join(' ')
  return words.length > TITLE_WORDS || head.length > TITLE_CHARS ? `${head.slice(0, TITLE_CHARS).trimEnd()}…` : head
}

export const channelCount = (count: number): string => plural(count, 'channel')

/** The channel of a version the way the core names it in its results: the platform and where on it. */
export const versionLabel = (card: Pick<OpportunityCard, 'channelPlatform' | 'channelTarget'>): string => `${platformLabel(card.channelPlatform)} ${card.channelTarget}`

/** How a version goes out when the owner presses Send. */
export function wayLine(way: SendWay): string {
  return way === 'ai_browser' ? "Goes out by: the AI in the account's browser: you press Send" : 'Goes out by: connector'
}

// ───────────── which version is in which state ─────────────

const finished = (state: OpportunityState): boolean => LOCKED_STATES.includes(state)

/** A version that can still be approved: it is not out, in flight or waiting for a result. */
export const isOpenVersion = (version: PostVersion): boolean => !finished(version.card.opportunity.state)

/** Approved and unchanged since: the card carries its active approval and is ready to send. */
export const isApprovedVersion = (version: PostVersion): boolean => version.card.opportunity.state === 'ready' && version.card.approval !== null

export const openVersions = (versions: readonly PostVersion[]): PostVersion[] => versions.filter(isOpenVersion)
export const approvedVersions = (versions: readonly PostVersion[]): PostVersion[] => versions.filter(isApprovedVersion)

/**
 * The draft of each version the owner is looking at, for the approval of the whole group: the core approves a version only if its latest
 * draft is still the one it is given here, so a version that changed after the screen was drawn is left for the owner to read again.
 */
export function seenOf(versions: readonly PostVersion[]): Record<Id, Id> {
  const seen: Record<Id, Id> = {}
  for (const version of versions) if (version.card.draft) seen[version.card.opportunity.id] = version.card.draft.id
  return seen
}

/** What a step reported is about the group as it was after the step: the stamp changes when any version's state or draft does. */
export const groupStamp = (versions: readonly PostVersion[]): string => JSON.stringify(versions.map((v) => [v.card.opportunity.id, v.card.opportunity.state, v.card.draft?.id ?? null]))

// ───────────── the group's actions ─────────────

export type GroupMain = 'send' | 'approve'

/**
 * The group's main action, the one that may own the screen's filled button: sending once every version that can still go is approved,
 * approving otherwise, nothing when there is nothing left to do (every version is out).
 */
export function groupMain(versions: readonly PostVersion[]): GroupMain | null {
  const open = openVersions(versions)
  if (open.length === 0) return null
  return open.every(isApprovedVersion) ? 'send' : 'approve'
}

export const approveAllLabel = (versions: readonly PostVersion[]): string => `Approve all ${openVersions(versions).length}`
export const sendAllLabel = (versions: readonly PostVersion[]): string => `Send all now (${approvedVersions(versions).length})`

export interface GroupState {
  /** A step of the group is running. */
  working: boolean
  /** The labels of the versions with changes that are not saved. */
  unsaved: readonly string[]
}

const listOf = (words: readonly string[]): string => (words.length <= 2 ? words.join(' and ') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)

/**
 * Why a step that works on what is saved ("Approve all", "Adapt with AI") is off, or null. What is typed and not saved would be approved
 * without being read or replaced by a new draft, so it must be saved first.
 */
export function stepBlocker(state: GroupState): string | null {
  if (state.working) return 'Wait until the step that is running is done.'
  if (state.unsaved.length > 0) return `Save your changes to ${listOf(state.unsaved)} first.`
  return null
}

export const NOT_APPROVED_YET = 'Approve the versions first.'

/** Why "Send all now" is off, or null: nothing is approved yet, or what would go is not what is on the screen. */
export function sendBlocker(versions: readonly PostVersion[], state: GroupState): string | null {
  if (state.working) return 'Wait until the step that is running is done.'
  if (approvedVersions(versions).length === 0) return NOT_APPROVED_YET
  if (state.unsaved.length > 0) return `Save your changes to ${listOf(state.unsaved)} first.`
  return null
}

/** The one reason shown beside the buttons: what holds back the first button that is off. */
export const reasonBeside = (approve: string | null, send: string | null): string | null => approve ?? send

export type GroupStep = 'adapt' | 'approve' | 'send' | 'remove'

/** On which step the group is, in words, while a slow call runs (an adaptation or a send takes minutes). */
export function stepLabel(step: GroupStep, versions: readonly PostVersion[]): string {
  switch (step) {
    case 'adapt':
      return `Adapting for ${channelCount(openVersions(versions).length)}…`
    case 'approve':
      return `Approving ${plural(openVersions(versions).length, 'version')}…`
    case 'send':
      return `Sending to ${channelCount(approvedVersions(versions).length)}… one after another, with a pause between`
    case 'remove':
      return 'Deleting the versions that were not sent…'
  }
}

/** The word on the pressed button while its step runs. */
export const BUSY_WORD: Record<GroupStep, string> = { adapt: 'Adapting…', approve: 'Approving…', send: 'Sending…', remove: 'Deleting…' }

export const groupRemovalQuestion = 'Deletes every version that was not sent, in every channel. Nothing of them was sent, so nothing changes on any site. A version that was sent stays as an ordinary post. It cannot be brought back.'

export const startOverQuestion = 'The AI writes this version again from the post and replaces your changes.'

// ───────────── what a step reported ─────────────

export type ReportedStep = 'adapt' | 'approve' | 'send'

export const RESULT_LABEL: Record<PostGroupResult['status'], string> = { done: 'Done', skipped: 'Skipped', failed: 'Failed' }

/** Skipped and failed are warnings, never hidden. */
export const RESULT_TONE: Record<PostGroupResult['status'], Tone> = { done: 'good', skipped: 'warn', failed: 'warn' }

export function resultsHeadline(step: ReportedStep, results: readonly PostGroupResult[]): string {
  const done = results.filter((r) => r.status === 'done').length
  const of = `${done} of ${plural(results.length, 'version')}`
  if (results.length === 0) return step === 'send' ? 'Nothing was sent.' : step === 'approve' ? 'Nothing was approved.' : 'Nothing was adapted.'
  return step === 'adapt' ? `Adapted ${of}.` : step === 'approve' ? `Approved ${of}.` : `Sent ${of}.`
}

/** True when anything in the report needs the owner's attention. */
export const hasWarnings = (results: readonly PostGroupResult[]): boolean => results.some((r) => r.status !== 'done')

// ───────────── where to post ─────────────

/** One channel in the "Where to post" list. `listed` is false for the screen's own channel when the core does not offer it (posting is off there). */
export interface WhereRow {
  channelId: Id
  platform: string
  target: string
  accountLabel: string
  fits: boolean
  reason: string
  suggested: boolean
  listed: boolean
}

export interface OwnChannel {
  channelId: Id
  platform: string
  target: string
  accountLabel: string
}

export const CANNOT_POST_REASON = 'Posting is not available in this channel now. It can only be saved as a draft here.'

/**
 * The channels the owner can tick, in the order the core ranked them. The app suggests a channel that fits and is not ticked, and ticks
 * nothing. The screen's own channel is always shown: when the core does not list it (posting is off there) it is a row of its own that
 * says so, because it is ticked from the start and the owner must see it. `exclude` leaves out channels the post is already in.
 */
export function whereRows(options: readonly GroupChannelOption[] | undefined, chosen: readonly Id[], own?: OwnChannel, exclude: readonly Id[] = []): WhereRow[] | undefined {
  if (options === undefined) return undefined
  const rows: WhereRow[] = options
    .filter((o) => !exclude.includes(o.channelId))
    .map((o) => ({ channelId: o.channelId, platform: o.platform, target: o.target, accountLabel: o.accountLabel, fits: o.fits, reason: o.reason, suggested: o.suggested && !chosen.includes(o.channelId), listed: true }))
  if (own && !exclude.includes(own.channelId) && !options.some((o) => o.channelId === own.channelId)) {
    rows.unshift({ ...own, fits: false, reason: CANNOT_POST_REASON, suggested: false, listed: false })
  }
  return rows
}

export const rowName = (row: Pick<WhereRow, 'platform' | 'target'>): string => `${platformLabel(row.platform)} ${row.target}`

/** What "Save" does with the ticks. */
export type SaveIntent = { kind: 'single'; channelId: Id } | { kind: 'group'; channelIds: Id[] } | { kind: 'none'; reason: string }

export const CHOOSE_A_CHANNEL = 'Choose where to post.'

/**
 * One channel ticked: the post of a single channel, as before. Two or more: one post for several channels. A channel that cannot post now
 * cannot be part of a group, so with two or more ticks it must be unticked (the reason says which); never dropped silently.
 */
export function saveIntent(chosen: readonly Id[], rows: readonly WhereRow[] | undefined): SaveIntent {
  const known = rows ? chosen.filter((id) => rows.some((r) => r.channelId === id)) : [...chosen]
  const ticked = [...new Set(known)]
  if (ticked.length === 0) return { kind: 'none', reason: CHOOSE_A_CHANNEL }
  if (ticked.length === 1) return { kind: 'single', channelId: ticked[0] }
  const blocked = rows?.filter((r) => ticked.includes(r.channelId) && !r.listed) ?? []
  if (blocked.length > 0) return { kind: 'none', reason: `${listOf(blocked.map(rowName))} cannot be part of a post for several channels now. Untick it.` }
  return { kind: 'group', channelIds: ticked }
}

/** The button of the new-post form: the same slot and the same size, only the words change with the number of channels. */
export const saveLabel = (intent: SaveIntent): string => (intent.kind === 'group' ? `Save for ${intent.channelIds.length} channels` : 'Save as draft')

/** The button of "Also post to…" once channels are ticked. */
export const extendLabel = (count: number): string => (count === 0 ? 'Save for more channels' : `Save for ${count} more ${count === 1 ? 'channel' : 'channels'}`)

/** A tick added or removed; the order of the ticks is the order of the versions. */
export const toggled = (chosen: readonly Id[], id: Id): Id[] => (chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id])

// ───────────── "Also post to…" ─────────────

/** Where a post of the owner's can still go to more channels: not a reply, not in a group yet, not in flight, not deleted; it must have a text. */
const ALSO_POST_STATES: OpportunityState[] = ['draft', 'awaiting_approval', 'ready', 'deferred', 'needs_user', 'error', 'confirmed']

export const alsoPostAllowed = (card: Pick<OpportunityCard, 'opportunity' | 'draft'>): boolean =>
  card.opportunity.kind === 'standalone' && !card.opportunity.groupId && card.draft !== null && ALSO_POST_STATES.includes(card.opportunity.state)

/** The post's own text as the draft the channel list is asked about. */
export function draftInputOf(draft: Draft): DraftInput {
  return { title: draft.title, text: draft.text, link: draft.link, attachments: draft.attachments, markup: draft.markup ?? 'legacy' }
}
