// Notification policy for attention items (SRC-001 "Требует внимания", REQ-005). The core never imports Electron:
// it decides WHAT to notify and hands it to a NotificationSink supplied by the main process.

import type { AttentionItem, Id } from '../../shared/types'
import type { Core } from '../core'

export interface AppNotification {
  /** Stable key, e.g. the attention item id or "digest:<channel>:<day>". */
  id: string
  kind: 'attention' | 'digest'
  title: string
  body: string
}

export interface NotificationSink {
  notify(notification: AppNotification): void
}

export const silentSink: NotificationSink = { notify: () => undefined }

/** More fresh items than this collapse into a single "N items need attention" notification. */
const MAX_INDIVIDUAL = 3
const SEEN_KEY = 'notifications.seen'

/** Channels an attention item belongs to; used to honor each channel's own notifications flag. */
export function channelIdsForItem(core: Core, item: AttentionItem): Id[] {
  try {
    switch (item.refType) {
      case 'channel':
        return [item.refId]
      case 'opportunity':
        return [core.repos.opportunity(item.refId).channelId]
      case 'action':
        return [core.repos.opportunity(core.repos.action(item.refId).opportunityId).channelId]
      case 'account':
        return core.repos
          .listChannels()
          .filter((c) => c.accountId === item.refId)
          .map((c) => c.id)
      case 'product':
        return core.repos
          .listChannels()
          .filter((c) => c.productId === item.refId)
          .map((c) => c.id)
    }
  } catch {
    return []
  }
}

/** True when the application-wide switch is on and (if the item belongs to channels) at least one of them wants notifications. */
export function mayNotify(core: Core, item: AttentionItem): boolean {
  if (!core.settings.app().notifications) return false
  const channelIds = channelIdsForItem(core, item)
  if (channelIds.length === 0) return true
  return channelIds.some((id) => {
    try {
      return core.repos.channel(id).settings.notifications
    } catch {
      return false
    }
  })
}

/**
 * Turns the current attention list into notifications, once per new item (never on every refresh).
 * The set of already-announced item ids survives restarts; an item that goes away and comes back counts as new.
 */
export class AttentionNotifier {
  constructor(
    private readonly core: Core,
    private readonly sink: NotificationSink
  ) {}

  consider(items: AttentionItem[]): number {
    const seen = new Set(this.core.settings.getRaw<string[]>(SEEN_KEY, []))
    const fresh = items.filter((item) => !seen.has(item.id))
    // Remember everything currently present, including muted items, so enabling notifications later is not a flood.
    this.core.settings.setRaw(SEEN_KEY, items.map((i) => i.id))
    const eligible = fresh.filter((item) => mayNotify(this.core, item))
    if (eligible.length === 0) return 0
    if (eligible.length <= MAX_INDIVIDUAL) {
      for (const item of eligible) this.sink.notify({ id: item.id, kind: 'attention', title: item.title, body: item.detail })
      return eligible.length
    }
    this.sink.notify({
      id: `attention-summary:${eligible.map((i) => i.id).join(',')}`.slice(0, 200),
      kind: 'attention',
      title: `${eligible.length} items need your attention`,
      body: eligible
        .slice(0, 3)
        .map((i) => i.title)
        .join('; ')
    })
    return 1
  }
}
