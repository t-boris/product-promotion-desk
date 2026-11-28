// The account's inbox, read once per monitor cycle after the discussion read (DEC-039): replies to the account and mentions of it become Feed items.
//
// This never throws and never touches the discussion read: whatever goes wrong here is written down as the reason on the channel's `read_inbox`
// capability (the Status tab shows it) and the cycle goes on. The only exception it swallows silently is the owner taking the browser.
//
// The rules of the discussion read apply unchanged and are kept by `Ingestor.ingestInbox`: the first read stores and queues nothing (the baseline),
// what any login of the product wrote is its own, one voice per discussion, once per comment.

import type { Account, Channel } from '../../shared/types'
import { inboxReasonOf } from '../channels/capabilities'
import type { Core } from '../core'
import { TakeoverError, type Connector, type ConnectorContext, type RemoteDiscussion, type RemoteInboxItem } from '../ports'
import type { Ingestor } from './ingest'
import type { FlowStore } from './store'
import { errorMessage, normalizeIdentity } from './util'

/** Items of the inbox taken in one cycle, newest first: a long unread inbox is worked off over several cycles, never in one burst. */
export const INBOX_ITEM_LIMIT = 25
/** Threads read to give the AI the post around an item. Each is one more request to the platform, so the count is small and they are spaced. */
export const INBOX_THREAD_LIMIT = 5
/** The gap between two requests to the platform in one cycle, as the connectors keep it. */
export const INBOX_PACING_MS = 400

export const INBOX_READABLE_DETAIL = 'Replies to the account and mentions of it are read from its inbox.'
export const INBOX_NEEDS_IDENTITY = 'The account identity is unknown, so replies and mentions cannot be told from the account\'s own comments: sign in to resume reading the inbox.'

export interface InboxOutcome {
  newOpportunities: number
  /** One line for the cycle's summary; empty when there was nothing to say. */
  note: string
}

const NOTHING: InboxOutcome = { newOpportunities: 0, note: '' }

export async function collectInbox(
  core: Core,
  store: FlowStore,
  ingestor: Ingestor,
  channel: Channel,
  account: Account,
  connector: Connector,
  ctx: ConnectorContext
): Promise<InboxOutcome> {
  try {
    return await read(core, store, ingestor, channel, account, connector, ctx)
  } catch (error) {
    // The owner took the browser: the inbox is read on the next cycle, nothing is wrong.
    if (error instanceof TakeoverError) return NOTHING
    const why = `The inbox could not be read: ${errorMessage(error)}`
    core.log.warn('monitor', why, channel.id)
    try {
      store.noteCapability(channel.id, 'read_inbox', 'needs_check', why)
    } catch {
      // Recording the reason must not turn a failed inbox read into a failed cycle.
    }
    return { newOpportunities: 0, note: 'inbox not read' }
  }
}

async function read(core: Core, store: FlowStore, ingestor: Ingestor, channel: Channel, account: Account, connector: Connector, ctx: ConnectorContext): Promise<InboxOutcome> {
  // A platform with no inbox the app can read stays empty, and says why where the owner looks for it.
  if (typeof connector.readInbox !== 'function') {
    // The reason the connector gave at the assessment stays; a channel that has none yet gets the general one.
    store.noteCapability(channel.id, 'read_inbox', 'unavailable', inboxReasonOf(store.requireChannel(channel.id).capabilities.find((c) => c.key === 'read_inbox')))
    return NOTHING
  }
  // The capability is the switch: the assessment (or an earlier read) found the inbox closed, and its reason stays until the next assessment.
  const current = store.requireChannel(channel.id).capabilities.find((c) => c.key === 'read_inbox')
  if (current && (current.status === 'unavailable' || current.status === 'restricted')) return NOTHING
  if (normalizeIdentity(account.identity) === '') {
    store.noteCapability(channel.id, 'read_inbox', 'needs_user', INBOX_NEEDS_IDENTITY)
    return NOTHING
  }

  const items: RemoteInboxItem[] = (await connector.readInbox(ctx, { limit: INBOX_ITEM_LIMIT })).slice(0, INBOX_ITEM_LIMIT)
  const baseline = !store.inboxBaselineDone(channel.id)
  const threads = baseline ? new Map<string, RemoteDiscussion>() : await readThreads(core, store, channel, connector, ctx, items)

  const result = ingestor.ingestInbox(channel, account, items, { baseline, threads })
  store.noteCapability(channel.id, 'read_inbox', 'verified', INBOX_READABLE_DETAIL)
  if (baseline) return { newOpportunities: 0, note: `inbox baseline stored: ${result.stored} item(s)` }
  const note = result.stored === 0 ? '' : `${result.stored} inbox item(s), ${result.newOpportunities} new opportunity(ies)`
  return { newOpportunities: result.newOpportunities, note }
}

/**
 * The whole discussion of the items that will be stored for the first time, when its post is not stored yet: the AI answers a reply with the post
 * and the comments around it in front of it. Best effort: an item without its thread is stored with what the inbox says, and is still answered.
 * Spaced, and at most a few per cycle.
 */
async function readThreads(
  core: Core,
  store: FlowStore,
  channel: Channel,
  connector: Connector,
  ctx: ConnectorContext,
  items: RemoteInboxItem[]
): Promise<Map<string, RemoteDiscussion>> {
  const threads = new Map<string, RemoteDiscussion>()
  let asked = 0
  for (const item of items) {
    if (threads.has(item.discussionExternalId)) continue
    if (store.commentByExternalId(channel.id, item.comment.externalId)) continue // read before: nothing to store
    if (store.discussionByExternalId(channel.id, item.discussionExternalId)) continue // its post is stored already
    if (asked >= INBOX_THREAD_LIMIT) break
    if (asked > 0) await core.sleep(INBOX_PACING_MS)
    asked++
    try {
      const thread = await connector.fetchThread(ctx, item.discussionExternalId)
      if (thread) threads.set(item.discussionExternalId, thread)
    } catch (error) {
      if (error instanceof TakeoverError) break
      core.log.warn('monitor', `The thread of an inbox item could not be read: ${errorMessage(error)}`, channel.id)
    }
  }
  return threads
}
