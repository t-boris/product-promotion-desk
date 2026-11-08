// Aggregates everything that needs the user into one list (SRC-001 screen "Требует внимания").
// Items are derived from the database on demand, never stored, so the list can not drift from the real state.

import type { AttentionItem, ChannelStatus, Id, Opportunity, SendAction } from '../../shared/types'
import type { Core } from '../core'
import type { Db } from '../db/database'
import { mapAction, mapOpportunity } from '../repos'
import type { ScheduleStore } from './scheduler-state'

/** A channel that failed this many cycles in a row is surfaced even though its status is still 'active'. */
export const FAILURE_ATTENTION_THRESHOLD = 3

const SINCE_KEY = 'attention.since'
const EXCERPT = 140

type Row = Record<string, unknown>

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT - 1)}…` : flat
}

function opportunityItems(core: Core, db: Db, targets: Map<Id, string>): AttentionItem[] {
  const rows = db
    .prepare("SELECT * FROM opportunities WHERE state IN ('awaiting_approval', 'ready', 'draft', 'needs_user') ORDER BY updated_at DESC")
    .all() as Row[]
  return rows.map((row): AttentionItem => {
    const opp: Opportunity = mapOpportunity(row)
    const where = targets.get(opp.channelId) ?? 'a channel'
    const what = opp.kind === 'standalone' ? 'publication' : 'reply'
    const draftText = core.repos.latestDraft(opp.id)?.text
    const detail = draftText ? excerpt(draftText) : excerpt(opp.reason)
    const base = { refType: 'opportunity' as const, refId: opp.id, createdAt: opp.updatedAt }
    if (opp.state === 'awaiting_approval') return { id: `approval:${opp.id}`, kind: 'approval', title: `Approve ${what} in ${where}`, detail, ...base }
    // Approved but not sent: normally momentary, but a blocked send (gate, limit, sign-in) would otherwise vanish from
    // every list. Its own id keeps it a separate item from the approval request it grew out of.
    if (opp.state === 'ready') return { id: `ready:${opp.id}`, kind: 'approval', title: 'Approved, not sent yet', detail: excerpt(opp.reason) || `The ${what} to ${where} is approved and waiting to be sent.`, ...base }
    if (opp.state === 'draft') return { id: `draft:${opp.id}`, kind: 'draft', title: `Review draft ${what} in ${where}`, detail, ...base }
    return { id: `question:${opp.id}`, kind: 'question', title: `Needs your input in ${where}`, detail: excerpt(opp.reason) || detail, ...base }
  })
}

/** Uncertain sends are listed against their opportunity, where the user can trigger the reconciliation. */
function unknownResultItems(db: Db, targets: Map<Id, string>): AttentionItem[] {
  const rows = db
    .prepare(
      `SELECT a.*, o.channel_id AS ch FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id
       WHERE a.state = 'unknown' ORDER BY a.attempted_at DESC`
    )
    .all() as Row[]
  return rows.map((row): AttentionItem => {
    const action: SendAction = mapAction(row)
    const where = targets.get(row.ch as string) ?? action.destination
    return {
      id: `unknown_result:${action.id}`,
      kind: 'unknown_result',
      title: `Result unknown in ${where}`,
      detail: 'The message may or may not have been published. It will not be sent again until the outcome is checked.',
      refType: 'opportunity',
      refId: action.opportunityId,
      createdAt: action.attemptedAt
    }
  })
}

function accountItems(core: Core): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const account of core.repos.listAccounts()) {
    const base = { refType: 'account' as const, refId: account.id, createdAt: account.createdAt }
    const who = account.identity ? `${account.label} (${account.identity})` : account.label
    if (account.status === 'login_required') {
      items.push({ id: `login:${account.id}`, kind: 'login', title: `Sign in again to ${who}`, detail: 'The login expired. Work on this account is suspended until you sign in.', ...base })
    } else if (account.status === 'captcha') {
      items.push({ id: `captcha:${account.id}`, kind: 'captcha', title: `Solve the CAPTCHA for ${who}`, detail: 'The platform asks for a human check. Work on this account is suspended until you complete it.', ...base })
    } else if (account.status === 'suspended') {
      items.push({ id: `error:account:${account.id}`, kind: 'error', title: `Account ${who} is suspended`, detail: 'The platform suspended this account; automation on it is stopped.', ...base })
    }
  }
  return items
}

const PROBLEM_STATUSES: ChannelStatus[] = ['needs_user', 'error']

function channelItems(core: Core, store: ScheduleStore): AttentionItem[] {
  const blockedAccounts = new Set(core.repos.listAccounts().filter((a) => a.status !== 'ready').map((a) => a.id))
  const failing = new Map(store.failing(FAILURE_ATTENTION_THRESHOLD).map((s) => [s.channelId, s]))
  const items: AttentionItem[] = []
  for (const channel of core.repos.listChannels()) {
    const base = { refType: 'channel' as const, refId: channel.id, createdAt: channel.lastRunAt ?? channel.createdAt }
    if (PROBLEM_STATUSES.includes(channel.status)) {
      // The account item already explains a login/CAPTCHA problem; a second item for the channel would only duplicate it.
      if (channel.status === 'needs_user' && blockedAccounts.has(channel.accountId)) continue
      const detail = channel.statusDetail || 'The channel needs your attention.'
      if (channel.status === 'needs_user') items.push({ id: `connection:${channel.id}`, kind: 'connection', title: `${channel.target} needs you`, detail, ...base })
      else items.push({ id: `error:${channel.id}`, kind: 'error', title: `Problem with ${channel.target}`, detail, ...base })
    } else if (channel.status === 'active') {
      const state = failing.get(channel.id)
      if (!state) continue
      items.push({
        id: `connection:${channel.id}`,
        kind: 'connection',
        title: `${channel.target} keeps failing`,
        detail: `${state.consecutiveFailures} checks in a row failed (${excerpt(state.lastError)}). Retrying with growing pauses.`,
        ...base
      })
    }
  }
  return items
}

function compare(a: AttentionItem, b: AttentionItem): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
  return a.id < b.id ? -1 : 1
}

/**
 * Builds the list and watches the data it is derived from. `refresh()` is called after every relevant change
 * (opportunities, accounts, channels); it emits 'attention' only when the list really changed and passes the
 * list to `onItems` (the notifier) so each new item is announced once.
 */
export class AttentionWatcher {
  private signature = ''
  private count = 0
  private scheduled = false
  private unsubscribe: (() => void) | null = null
  onItems: ((items: AttentionItem[]) => void) | null = null

  constructor(
    private readonly core: Core,
    private readonly store: ScheduleStore
  ) {}

  /** Number of items in the last computed list (for the menu-bar status without touching the database). */
  get size(): number {
    return this.count
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.core.events.subscribe((event) => {
      if (event.type !== 'changed') return
      if (event.scope === 'opportunities' || event.scope === 'accounts' || event.scope === 'channels') this.schedule()
    })
    this.refresh()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /** Bursts of events (a monitoring cycle creates many opportunities) collapse into one refresh. */
  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.unsubscribe) return
      try {
        this.refresh()
      } catch (error) {
        this.core.log.error('attention', `Could not refresh attention items: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
  }

  list(): AttentionItem[] {
    const targets = this.targets()
    const items = [...opportunityItems(this.core, this.core.db, targets), ...unknownResultItems(this.core.db, targets), ...accountItems(this.core), ...channelItems(this.core, this.store)]
    const sorted = this.withStableTimes(items).sort(compare)
    this.count = sorted.length
    return sorted
  }

  refresh(): AttentionItem[] {
    const items = this.list()
    const signature = items.map((i) => `${i.id}|${i.title}|${i.detail}`).join('\n')
    if (signature !== this.signature) {
      this.signature = signature
      this.core.events.changed('attention')
    }
    this.onItems?.(items)
    return items
  }

  private targets(): Map<Id, string> {
    return new Map(this.core.repos.listChannels().map((c) => [c.id, c.target]))
  }

  /**
   * Accounts and channels carry no "problem started" timestamp, so the moment an item was first seen is remembered
   * (and dropped when the item goes away). Without it a long-standing login problem would sort as brand new.
   */
  private withStableTimes(items: AttentionItem[]): AttentionItem[] {
    const stored = this.core.settings.getRaw<Record<string, string>>(SINCE_KEY, {})
    const now = this.core.clock.now().toISOString()
    const next: Record<string, string> = {}
    const result = items.map((item) => {
      if (item.refType !== 'account' && item.refType !== 'channel') return item
      const since = stored[item.id] ?? now
      next[item.id] = since
      return { ...item, createdAt: since }
    })
    const changed = Object.keys(next).length !== Object.keys(stored).length || Object.entries(next).some(([id, at]) => stored[id] !== at)
    if (changed) this.core.settings.setRaw(SINCE_KEY, next)
    return result
  }
}
