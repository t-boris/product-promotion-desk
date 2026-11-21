import type { Id } from '../../shared/types'
import { useQuery } from './hooks'
import { feedCountLabel, statesOf } from './pages/feed/feed-filter'

const DECIDE = statesOf('decide')

/**
 * The neutral count beside "Feed" in the sidebar (DEC-037, A2): how many replies of the current product wait for a decision. It is neutral
 * (no amber, no red) because the Inbox's count already says what needs the owner; this one says how much there is to look through.
 * Nothing is drawn for none. The core returns at most 300 items, so a longer list is shown as "300+".
 */
export function FeedCount({ productId }: { productId: Id }) {
  const waiting = useQuery('opportunities.list', { productId, kind: 'reply', states: DECIDE, withoutFeedAnswers: true }, ['opportunities'])
  const label = feedCountLabel(waiting.data?.length ?? 0)
  if (label === null) return null
  return (
    <span className="count neutral" data-testid="feed-count">
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{`${label} to decide`}</span>
    </span>
  )
}
