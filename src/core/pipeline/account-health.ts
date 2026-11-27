// Account health (DEC-064): counted by the application from what the account sent and what was read under its posts. Nothing is stored.
import { HEALTH_DAYS, carriesOwnLink, reachOf } from '../../shared/account-health'
import type { AccountHealthView, Id } from '../../shared/types'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'

const DAY_MS = 86_400_000
/** The reach of a channel is taken from the posts of this long. */
const REACH_DAYS = 120

export function accountHealth(core: Core, args: { accountId: Id }): AccountHealthView {
  const account = found(() => core.repos.account(requireText(args.accountId, 'The account')), 'The account')
  const nowMs = core.clock.now().getTime()
  const sends = core.db
    .prepare(
      `SELECT o.kind, o.product_id, d.text, d.link FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id JOIN drafts d ON d.id = a.draft_id
       WHERE a.account_id = ? AND a.state = 'confirmed' AND a.completed_at >= ?`
    )
    .all(account.id, new Date(nowMs - HEALTH_DAYS * DAY_MS).toISOString()) as { kind: string; product_id: Id; text: string; link: string | null }[]
  const sites = new Map<Id, string | null>()
  const siteOf = (productId: Id): string | null => {
    if (!sites.has(productId)) {
      // A product deleted since has no site to look for.
      const row = core.db.prepare('SELECT website_url FROM products WHERE id = ?').get(productId) as { website_url: string | null } | undefined
      sites.set(productId, row?.website_url ?? null)
    }
    return sites.get(productId) ?? null
  }
  const count = (kind: 'post' | 'reply') => {
    const of = sends.filter((s) => (s.kind === 'standalone') === (kind === 'post'))
    return { sent: of.length, withLink: of.filter((s) => carriesOwnLink(s.text, s.link, siteOf(s.product_id))).length }
  }
  const channels = core.repos.listChannels().filter((c) => c.accountId === account.id)
  const since = new Date(nowMs - REACH_DAYS * DAY_MS).toISOString()
  return {
    accountId: account.id,
    days: HEALTH_DAYS,
    posts: count('post'),
    replies: count('reply'),
    reach: channels.map((channel) => {
      const numbers = (
        core.db
          .prepare(
            "SELECT a.likes, a.comments, a.views FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id WHERE o.channel_id = ? AND o.kind = 'standalone' AND a.state = 'confirmed' AND a.numbers_read_at IS NOT NULL AND a.completed_at >= ? ORDER BY a.completed_at"
          )
          .all(channel.id, since) as { likes: number | null; comments: number | null; views: number | null }[]
      ).map((r) => ({ likes: r.likes, comments: r.comments, views: r.views }))
      return { channelId: channel.id, target: channel.target, platform: channel.platform, posts: numbers.length, ...reachOf(numbers) }
    })
  }
}
