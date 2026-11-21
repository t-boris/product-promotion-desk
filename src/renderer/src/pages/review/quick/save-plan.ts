// What pressing "Save as draft" sends for a quick post (REQ-001): one channel ticked saves the post of that channel, several save one post for all of
// them (a group, DEC-032). Both carry the same draft: the caption in `text`, no title, one picture, the card. Pure; the screen only makes the call.

import type { DraftInput } from '../../../../../shared/api'
import type { Id } from '../../../../../shared/types'
import type { SaveIntent } from '../post-group'
import { quickReason, type QuickForm } from './quick-form'

export type SavePlan =
  | { method: 'publications.create'; args: { channelId: Id; draft: DraftInput } }
  | { method: 'postGroups.create'; args: { productId: Id; channelIds: Id[]; draft: DraftInput } }

/** The call a save makes for these ticks, or null when the ticks cannot be saved (nothing chosen, or a channel that cannot be part of a group). */
export function savePlan(intent: SaveIntent, productId: Id, draft: DraftInput): SavePlan | null {
  if (intent.kind === 'single') return { method: 'publications.create', args: { channelId: intent.channelId, draft } }
  if (intent.kind === 'group') return { method: 'postGroups.create', args: { productId, channelIds: intent.channelIds, draft } }
  return null
}

/** The one reason shown beside the button when it is off: what the post lacks first, then what is wrong with the channels. */
export const saveReason = (form: QuickForm, intent: SaveIntent): string | null => quickReason(form) ?? (intent.kind === 'none' ? intent.reason : null)
