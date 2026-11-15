import type { Channel, Id } from '../../../../shared/types'
import { Hint } from '../../ui'
import { channelHref } from '../../route'
import { OWN_POSTS_NO_CHECK } from '../channels/own-posts'
import { readingProblems, unreadChannels, type FeedSourceFilter } from './feed-filter'
import './feed.css'

/** Problems shown before "and n more": the rest are on the Channels screen, where they are fixed. */
const SHOWN = 3

/**
 * Why a source may be empty although the channel is there, said on the Feed where the owner is looking: an ability the source depends on is
 * unavailable or needs the owner (the reason is the channel's own words, from its capability), or the app does not read the channel at
 * all (DEC-034). Where it is fixed is one link away. Nothing is shown while every channel in view reads well.
 */
export function ReadingNotes({ channels, source, channelId }: { channels: readonly Channel[]; source: FeedSourceFilter; channelId: Id | null }) {
  const problems = readingProblems(channels, { source, channelId })
  const unread = unreadChannels(channels, channelId)
  // One channel with a problem is fixed on its own page (Status shows the abilities); several are fixed from the list.
  const problemChannels = new Set(problems.map((problem) => problem.channelId))
  const fixHref = problemChannels.size === 1 ? channelHref([...problemChannels][0]) : '#/channels'
  if (problems.length === 0 && unread.length === 0) return null
  return (
    <div className="feed-notes" data-testid="feed-notes">
      {problems.length > 0 && (
        <div className="note warn" data-testid="feed-reading-problems">
          <div>
            <strong>Not everything is being read</strong>
          </div>
          {problems.slice(0, SHOWN).map((problem) => (
            <div key={`${problem.channelId}-${problem.key}`} data-testid={`feed-problem-${problem.key}`}>
              <strong>{problem.target}</strong> · {problem.ability}: {problem.status.toLowerCase()}. {problem.detail}
            </div>
          ))}
          {problems.length > SHOWN && <div className="muted small">and {problems.length - SHOWN} more.</div>}
          <div>
            Fix it on the{' '}
            <a href={fixHref} data-testid="feed-open-channels">
              {problemChannels.size === 1 ? 'channel’s page' : 'Channels screen'}
            </a>
            .
          </div>
        </div>
      )}
      {unread.length > 0 &&
        (channelId !== null ? (
          <Hint data-testid="own-posts-no-check">{OWN_POSTS_NO_CHECK}</Hint>
        ) : (
          <Hint data-testid="feed-unread">Not read by the app: {unread.map((channel) => channel.target).join(', ')}. They are for your own posts, which are in Posts.</Hint>
        ))}
    </div>
  )
}
