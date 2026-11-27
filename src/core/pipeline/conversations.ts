// Conversations (DEC-063): "a post took off" as its own Inbox item, and how long a comment addressed to the account has waited. Derived from
// what the application read; nothing is stored and the AI has no part.
import { TOOK_OFF_DAYS, tookOff, usualOf, waitedNote } from '../../shared/conversations'
import { likesWord, shortCount, type PostNumbers } from '../../shared/post-numbers'
import type { AttentionItem, Opportunity } from '../../shared/types'
import type { Core } from '../core'

const DAY_MS = 86_400_000
/** The usual is taken from the posts of this long before. */
const USUAL_DAYS = 90

/** One item per post of the last days whose points or comments are far above its channel's own usual. */
export function tookOffItems(core: Core): AttentionItem[] {
  const nowMs = core.clock.now().getTime()
  const items: AttentionItem[] = []
  const since = new Date(nowMs - (USUAL_DAYS + TOOK_OFF_DAYS) * DAY_MS).toISOString()
  for (const channel of core.repos.listChannels()) {
    if (channel.status !== 'active') continue
    // The confirmed posts of the channel whose numbers were read, the oldest first.
    const posts = (
      core.db
        .prepare(
          "SELECT a.id, a.completed_at, a.likes, a.comments, a.views FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.channel_id = ? AND o.kind = 'standalone' AND a.state = 'confirmed' AND a.numbers_read_at IS NOT NULL AND a.completed_at >= ? ORDER BY a.completed_at"
        )
        .all(channel.id, since) as { id: string; completed_at: string; likes: number | null; comments: number | null; views: number | null }[]
    ).map((r) => ({ id: r.id, sentAt: r.completed_at, sentMs: Date.parse(r.completed_at), numbers: { likes: r.likes, comments: r.comments, views: r.views } satisfies PostNumbers }))
    for (const post of posts) {
      if (nowMs - post.sentMs > TOOK_OFF_DAYS * DAY_MS) continue
      const usual = usualOf(posts.filter((p) => p.sentMs < post.sentMs).map((p) => p.numbers))
      const above = tookOff(post.numbers, usual)
      if (!above || !usual) continue
      const parts: string[] = []
      if (above.likes && post.numbers.likes !== null && usual.likes !== null) parts.push(`${shortCount(post.numbers.likes)} ${likesWord(channel.platform, post.numbers.likes)} (usual ${shortCount(Math.round(usual.likes))})`)
      if (above.comments && post.numbers.comments !== null && usual.comments !== null) parts.push(`${shortCount(post.numbers.comments)} comment${post.numbers.comments === 1 ? '' : 's'} (usual ${shortCount(Math.round(usual.comments))})`)
      items.push({
        id: `tookoff:${post.id}`,
        kind: 'question',
        title: `A post took off in ${channel.target}`,
        detail: `${parts.join(', ')}. Answer under it while it is fresh: the first two days matter most. This note goes away ${TOOK_OFF_DAYS} days after the post.`,
        refType: 'channel',
        refId: channel.id,
        createdAt: post.sentAt
      })
    }
  }
  return items
}

const ADDRESSED = new Set(['reply_to_me', 'mention'])

/** For a comment addressed to the account that is not answered yet: how long it has waited, in words; '' otherwise. */
export function waitedNoteFor(core: Core, opp: Opportunity): string {
  if (!ADDRESSED.has(opp.source) || !opp.commentId) return ''
  const row = core.db.prepare('SELECT posted_at, first_seen_at FROM comments WHERE id = ?').get(opp.commentId) as { posted_at: string | null; first_seen_at: string } | undefined
  if (!row) return ''
  return waitedNote(core.clock.now().getTime() - Date.parse(row.posted_at ?? row.first_seen_at))
}
