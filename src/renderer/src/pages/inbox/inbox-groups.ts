// What the Inbox's Decide list shows and how it behaves while the owner works (DEC-037). Pure, so the rules are tested from
// src/main/renderer-logic.test.ts without the interface.

import type { AttentionItem, Channel, Account, Id, IsoTime, OpportunityCard, OpportunityState } from '../../../../shared/types'
import { STATE_TONE } from '../review/labels'

export type InboxGroupId = 'replies' | 'posts' | 'questions' | 'results'

/** The groups of the list in the order they are shown; an empty group is not shown. */
export const INBOX_GROUPS: readonly { id: InboxGroupId; label: string }[] = [
  { id: 'replies', label: 'Replies' },
  { id: 'posts', label: 'Posts' },
  { id: 'questions', label: 'Questions from the AI' },
  { id: 'results', label: 'Results to confirm' }
]

/** The states in which an item waits for the owner: the ones the attention list is made of (core/pipeline/attention.ts). */
const WAITING_STATES: readonly OpportunityState[] = ['awaiting_approval', 'ready', 'draft', 'needs_user', 'unknown_result']

/** The item still needs a decision of the owner: an approval, a send, an answer or the check of an unknown result. */
export function needsDecision(state: OpportunityState): boolean {
  return WAITING_STATES.includes(state)
}

/** Where an item is listed: a question the AI asked, a send whose result is unknown, a post of the owner's, or a reply to a comment. */
export function groupOf(card: Pick<OpportunityCard, 'opportunity'>): InboxGroupId {
  const { state, kind } = card.opportunity
  if (state === 'needs_user') return 'questions'
  if (state === 'unknown_result') return 'results'
  return kind === 'standalone' ? 'posts' : 'replies'
}

/** One row the list has shown, with the group it was first shown in. */
export interface Seen {
  id: Id
  group: InboxGroupId
}

/**
 * The order of the list is frozen while the owner works (the rule of the old Attention page): everything that appeared stays in the order
 * it first appeared, in the group it first appeared in, until it is dismissed, so a row never jumps from under the cursor when its state
 * changes or something newer arrives. `current` is what waits now, newest first; the ones not seen yet are appended in that order.
 */
export function rememberSeen(seen: readonly Seen[], current: readonly Seen[]): Seen[] {
  const known = new Set(seen.map((row) => row.id))
  const fresh = current.filter((row) => !known.has(row.id))
  return fresh.length > 0 ? [...seen, ...fresh] : [...seen]
}

/** The ids of the attention items, newest first (ties by id, so the order is the same on every load). */
export function newestFirst(items: readonly Pick<AttentionItem, 'refId' | 'createdAt'>[]): Id[] {
  const sorted = [...items].sort((a, b) => (a.createdAt === b.createdAt ? (a.refId < b.refId ? -1 : 1) : a.createdAt < b.createdAt ? 1 : -1))
  return [...new Set(sorted.map((item) => item.refId))]
}

export interface InboxSection {
  id: InboxGroupId
  label: string
  ids: Id[]
}

/** The groups of the list, each with its rows in the frozen order; a group with no row is left out. */
export function inboxSections(rows: readonly Seen[]): InboxSection[] {
  return INBOX_GROUPS.map((group) => ({ ...group, ids: rows.filter((row) => row.group === group.id).map((row) => row.id) })).filter((section) => section.ids.length > 0)
}

/** The rows as the list shows them, top to bottom: what the arrow keys walk through. */
export function displayOrder(sections: readonly InboxSection[]): Id[] {
  return sections.flatMap((section) => section.ids)
}

/** The row the arrow keys move to: one step down (+1) or up (-1), stopping at the ends; with nothing selected the first row. */
export function moveSelection(order: readonly Id[], current: Id | null, step: 1 | -1): Id | null {
  if (order.length === 0) return null
  const at = current === null ? -1 : order.indexOf(current)
  if (at < 0) return order[0]
  return order[Math.min(order.length - 1, Math.max(0, at + step))]
}

/**
 * The row to show after the owner acted on `acted` and it no longer needs a decision: the next row that still waits, else the nearest
 * one above, else the acted row itself (its result stays on screen until it is dismissed). `waiting` is every id that still waits.
 */
export function selectionAfterAction(order: readonly Id[], acted: Id, waiting: ReadonlySet<Id>): Id {
  const at = order.indexOf(acted)
  if (at < 0) return acted
  const after = order.slice(at + 1).find((id) => waiting.has(id) && id !== acted)
  if (after !== undefined) return after
  const before = order.slice(0, at).reverse().find((id) => waiting.has(id) && id !== acted)
  return before ?? acted
}

/** The row to show once `dismissed` is gone: the one that took its place, else the one above it, else none. */
export function selectionAfterDismiss(order: readonly Id[], dismissed: Id): Id | null {
  const at = order.indexOf(dismissed)
  const rest = order.filter((id) => id !== dismissed)
  if (at < 0) return rest[0] ?? null
  return rest[Math.min(at, rest.length - 1)] ?? null
}

/** The selection as the screen has it: the chosen row while it is listed, else the first row. */
export function effectiveSelection(order: readonly Id[], chosen: Id | null): Id | null {
  return chosen !== null && order.includes(chosen) ? chosen : (order[0] ?? null)
}

// ───────────── Rows ─────────────

/** The longest excerpt of a row. */
export const ROW_EXCERPT = 60

/** The first `max` characters of a text on one line, with an ellipsis when it was cut. */
export function rowExcerpt(text: string, max: number = ROW_EXCERPT): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** How long ago, in the fewest words: "just now", "5 min ago", "3 h ago", "2 d ago", then the date. A time in the future or unreadable reads "just now". */
export function relativeTime(iso: IsoTime, now: Date = new Date()): string {
  const at = new Date(iso).getTime()
  const seconds = Number.isNaN(at) ? 0 : Math.round((now.getTime() - at) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days} d ago` : new Date(at).toISOString().slice(0, 10)
}

export interface RowSummary {
  channel: string
  /** The author of the comment, or the title of the post. */
  who: string
  excerpt: string
  at: IsoTime
  /** The colour of the state dot; empty is grey. */
  tone: 'good' | 'warn' | 'bad' | ''
}

/** What a row of the list says about an item. */
export function rowSummary(card: OpportunityCard): RowSummary {
  const opp = card.opportunity
  const standalone = opp.kind === 'standalone'
  const who = standalone ? card.draft?.title || 'New post' : (card.comment?.author ?? card.discussion?.author ?? 'Comment')
  // What the item is about: the comment answered, the post written, or what the AI asks.
  const text = opp.state === 'needs_user' ? opp.reason || (card.comment?.body ?? '') : standalone ? (card.draft?.text ?? '') : (card.comment?.body ?? card.discussion?.title ?? '')
  const tone = STATE_TONE[opp.state]
  return { channel: card.channelTarget, who, excerpt: rowExcerpt(text), at: opp.updatedAt, tone: tone === 'good' || tone === 'warn' || tone === 'bad' ? tone : '' }
}

// ───────────── The product's share ─────────────

/** The items of other products that wait, by product: what the Inbox says is waiting elsewhere. */
export function waitingElsewhere(cards: readonly Pick<OpportunityCard, 'opportunity'>[], productId: Id): { productId: Id; count: number }[] {
  const counts = new Map<Id, number>()
  for (const card of cards) {
    const id = card.opportunity.productId
    if (id !== productId) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts].map(([id, count]) => ({ productId: id, count }))
}

/**
 * The problems of the Fix list that concern the current product: a channel's own product's, the product itself. An account belongs to no
 * product (DEC-015), so its problem stays visible unless the account was made for another product and none of this product's channels
 * uses it. A problem about something the lists no longer hold (a channel that is gone) stays visible too: hiding it would hide a real item.
 */
export function fixItemsFor(items: readonly AttentionItem[], productId: Id, lists: { channels: readonly Pick<Channel, 'id' | 'productId' | 'accountId'>[]; accounts: readonly Pick<Account, 'id' | 'productId'>[] }): AttentionItem[] {
  return items.filter((item) => {
    switch (item.refType) {
      case 'channel': {
        const channel = lists.channels.find((c) => c.id === item.refId)
        return channel === undefined || channel.productId === productId
      }
      case 'product':
        return item.refId === productId
      case 'account': {
        const account = lists.accounts.find((a) => a.id === item.refId)
        if (!account || !account.productId || account.productId === productId) return true
        return lists.channels.some((c) => c.productId === productId && c.accountId === account.id)
      }
      default:
        return item.refType !== 'opportunity'
    }
  })
}
