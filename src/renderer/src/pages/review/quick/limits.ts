// The caption limit of a quick post that goes to one or several channels (REQ-002): the tightest of the platforms ticked, shown while typing.
// Pure; the characters are counted the way the platforms count them (`characterCount`), so the counter and the send never disagree.

import { characterCount, formOf, platformLabel } from '../../../../../shared/post-format'

/** The tightest text limit among the platforms, and the platform that sets it; `limit` is null when none of them has one. The first of equals. */
export function tightestLimit(platforms: readonly string[]): { limit: number | null; platform: string | null } {
  let best: { limit: number; platform: string } | null = null
  for (const platform of platforms) {
    const limit = formOf(platform).textLimit
    if (limit !== null && (best === null || limit < best.limit)) best = { limit, platform }
  }
  return best ? { limit: best.limit, platform: best.platform } : { limit: null, platform: null }
}

export interface CaptionCounter {
  used: number
  limit: number | null
  over: boolean
  /** "412 / 500 characters", with "(12 over)" once the limit is passed (said in words as well as shown in colour), or "412 characters" where there is no limit. */
  label: string
  /** Which platform sets the limit, when several are ticked and it is not the only one: "Threads takes the least: 500." */
  whose: string | null
}

const count = (n: number): string => n.toLocaleString('en-US')

/** The counter beside the caption: what is used against the tightest limit, and whose limit that is when it is not the only channel. */
export function captionCounter(caption: string, platforms: readonly string[]): CaptionCounter {
  const used = characterCount(caption)
  const { limit, platform } = tightestLimit(platforms)
  if (limit === null) return { used, limit: null, over: false, label: `${count(used)} characters`, whose: null }
  const several = new Set(platforms).size > 1
  return {
    used,
    limit,
    over: used > limit,
    label: `${count(used)} / ${count(limit)} characters${used > limit ? ` (${count(used - limit)} over)` : ''}`,
    whose: several && platform ? `${platformLabel(platform)} takes the least of the channels you chose.` : null
  }
}
