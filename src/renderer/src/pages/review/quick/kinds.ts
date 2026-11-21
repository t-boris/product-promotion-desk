// Which kind of post a set of ticked channels makes, and which channels cannot be ticked now (REQ-001, DEC-038, DEC-041). Pure, so the
// rules of the channel picker are tested without the screen. The words of the two refusals are `mixedKindReason` in the shared contract; this
// file only asks it for each row of the picker.

import { mixedKindReason, postTypeOfPlatform, type PostType } from '../../../../../shared/quick-post'
import type { Id } from '../../../../../shared/types'

/** A channel as the picker knows it: its id and the platform that decides its kind. */
export interface KindRow {
  channelId: Id
  platform: string
}

/**
 * The platform of each ticked channel, in the order of the ticks. A tick whose channel is not in the list (the screen's own channel before the
 * core has answered) is named by `own`, so the kind is known from the first frame; a tick that is neither is left out.
 */
export function chosenPlatforms(rows: readonly KindRow[] | undefined, chosen: readonly Id[], own?: KindRow): string[] {
  const platforms: string[] = []
  for (const id of chosen) {
    const platform = rows?.find((r) => r.channelId === id)?.platform ?? (own && own.channelId === id ? own.platform : undefined)
    if (platform !== undefined) platforms.push(platform)
  }
  return platforms
}

/**
 * The kind the ticked channels make. With nothing ticked it is the article: the form that was there before is shown again, and every channel is
 * offered. Channels of both kinds are never ticked together, so the first tick decides; a mixed set (it cannot be made by the picker) is read as
 * the kind of the first channel, the same way the picker blocks the rest.
 */
export function kindOfChannels(platforms: readonly string[]): PostType {
  return platforms.length === 0 ? 'article' : postTypeOfPlatform(platforms[0])
}

/**
 * Why a channel cannot be ticked now, by channel id: only for a channel that is not ticked and is of the other kind than the ticked ones. A
 * ticked channel is never blocked (it must be possible to untick it), and with nothing ticked nothing is.
 */
export function blockedChannels(rows: readonly KindRow[] | undefined, chosen: readonly Id[], own?: KindRow): Record<Id, string> {
  const blocked: Record<Id, string> = {}
  if (!rows) return blocked
  const ticked = chosenPlatforms(rows, chosen, own)
  for (const row of rows) {
    if (chosen.includes(row.channelId)) continue
    const reason = mixedKindReason(row.platform, ticked)
    if (reason) blocked[row.channelId] = reason
  }
  return blocked
}

/** The platforms the preview can show, once each, in the order of the ticks: the owner looks at the post as any channel it goes to. */
export const distinctPlatforms = (platforms: readonly string[]): string[] => [...new Set(platforms)]
