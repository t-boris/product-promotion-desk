import { shareLine, type ReachStanding } from '../../../../shared/account-health'
import { likesWord } from '../../../../shared/post-numbers'
import { useQuery } from '../../hooks'
import { Card, ErrorNote, Hint } from '../../ui'

const STANDING: Record<ReachStanding, string> = { fell: 'lower than before', rose: 'higher than before', usual: 'about as before', unknown: 'not enough posts with numbers yet' }
const round = (value: number): string => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10))

/** "average 5 points on the latest 3 posts, 20 on the ones before: lower than before" */
export function reachLine(reach: { platform: string; recent: number | null; usual: number | null; standing: ReachStanding }): string {
  if (reach.recent === null || reach.usual === null) return STANDING.unknown
  return `average ${round(reach.recent)} ${likesWord(reach.platform, 2)} on the latest 3 posts, ${round(reach.usual)} on the ones before: ${STANDING[reach.standing]}`
}

/**
 * What the application counts about an account (DEC-064): how much of what it sent carries the product's own site address, and whether its
 * channels' latest posts get what the earlier ones got. Numbers only: the application attaches no rule to them.
 */
export function AccountHealth({ accountId }: { accountId: string }) {
  const health = useQuery('accounts.health', { accountId }, ['opportunities', 'results', 'channels'])
  const view = health.data
  if (!view) return health.error ? <ErrorNote error={health.error} /> : null
  return (
    <Card title="Health">
      <dl className="account-health" data-testid={`account-health-${accountId}`}>
        <div>
          <dt>Posts with your site’s address, last {view.days} days</dt>
          <dd data-testid="health-posts">{shareLine(view.posts)}</dd>
        </div>
        <div>
          <dt>Replies with your site’s address, last {view.days} days</dt>
          <dd data-testid="health-replies">{shareLine(view.replies)}</dd>
        </div>
        {view.reach.map((reach) => (
          <div key={reach.channelId}>
            <dt>Reach in {reach.target}</dt>
            <dd className={reach.standing === 'fell' ? 'health-fell' : undefined}>{reachLine(reach)}</dd>
          </div>
        ))}
      </dl>
      <Hint>Counted by the application from what this account sent and from the numbers it read under its posts. A number, not a rule: each community decides for itself how much of your own link it takes.</Hint>
    </Card>
  )
}
