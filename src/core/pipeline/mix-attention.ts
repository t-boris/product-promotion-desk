// "What is new?" (DEC-033): an own update is written only from a note of the owner's, so when one is due and there is no note to write it from,
// the AI asks. The ask is an item of the attention list, derived on demand like every item there: it is gone as soon as a note exists, the kind is
// switched off, or the channel cannot work. It asks for words; it posts and approves nothing.

import type { AttentionItem } from '../../shared/types'
import type { Core } from '../core'
import { dueAtMs, MIX_WAITING_CAP, mixBlocker, usableNotes, waitingCount } from './mix'

export function noteRequestItems(core: Core): AttentionItem[] {
  const now = core.clock.now().getTime()
  const items: AttentionItem[] = []
  for (const channel of core.repos.listChannels()) {
    const entry = channel.settings.mix.find((e) => e.kind === 'own_update' && e.enabled)
    if (!entry || channel.status !== 'active' || mixBlocker(channel) !== null) continue
    if (waitingCount(core, channel.id) >= MIX_WAITING_CAP || usableNotes(core, channel.productId).length > 0) continue
    const state = core.db.prepare("SELECT last_draft_at FROM mix_state WHERE channel_id = ? AND kind = 'own_update'").get(channel.id) as { last_draft_at: string | null } | undefined
    if (now < dueAtMs(channel.id, 'own_update', entry.everyDays, state?.last_draft_at ?? null, now)) continue
    items.push({
      id: `note:${channel.id}`,
      kind: 'question',
      title: `Tell what is new for ${channel.target}`,
      detail: 'Your own updates are written from a note: say in a line what you did lately. Nothing is posted without your Approve.',
      refType: 'channel',
      refId: channel.id,
      createdAt: channel.createdAt
    })
  }
  return items
}
