import { numbersLine, shortCount } from '../../../../shared/post-numbers'
import type { Channel } from '../../../../shared/types'
import { Sparkline } from '../../charts/Sparkline'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Hint } from '../../ui'
import { AddressLink } from '../AddressLink'
import { relativeTime } from '../inbox/inbox-groups'
import { shortTime } from '../posts/short-time'
import { columnLabel, emptyReason, lineOf, shownColumns, totalOf } from './post-results'

/**
 * The Results tab of a channel: every post the owner sent there with what the site shows under it (views, likes or points, comments), how
 * that grew, and the totals. The application reads the numbers itself as each post ages; "Read now" reads them at once.
 */
export function PostResultsCard({ channel }: { channel: Channel }) {
  const results = useQuery('results.posts', { channelId: channel.id }, ['results', 'opportunities'])
  const [read, reading] = useAction(() => call('results.readPosts', { channelId: channel.id }))
  const view = results.data
  if (!view) return <Card title="Your posts here">{results.error ? <ErrorNote error={results.error} /> : <p className="muted">Loading…</p>}</Card>
  const empty = emptyReason(view)
  const columns = shownColumns(view.posts)
  const lastRead = view.posts.map((p) => p.numbers?.readAt).filter((at): at is string => Boolean(at)).sort().at(-1)

  return (
    <Card
      title="Your posts here"
      className="post-results-card"
      actions={
        view.readable && view.posts.length > 0 ? (
          <>
            {lastRead && <Hint data-testid="post-results-read-at">read {relativeTime(lastRead)}</Hint>}
            <Button onClick={() => void read()} disabled={reading.busy} data-testid="post-results-read">
              {reading.busy ? 'Reading…' : 'Read now'}
            </Button>
          </>
        ) : undefined
      }
    >
      {empty ? (
        <p className="muted" data-testid="post-results-empty">
          {empty}
        </p>
      ) : (
        <>
          {columns.length > 0 && (
            <dl className="post-results-totals" data-testid="post-results-totals">
              <div>
                <dt>Posts</dt>
                <dd>{view.posts.length}</dd>
              </div>
              {columns.map((key) => {
                const total = totalOf(view.posts, key)
                return (
                  <div key={key}>
                    <dt>{columnLabel(key, view.platform)}</dt>
                    <dd>{shortCount(total.sum)}</dd>
                    {total.known < view.posts.length && <span className="muted small">known for {total.known} of {view.posts.length}</span>}
                  </div>
                )
              })}
            </dl>
          )}
          <table className="table post-results-table" data-testid="post-results-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Sent</th>
                {columns.map((key) => (
                  <th key={key} className="num">
                    {columnLabel(key, view.platform)}
                  </th>
                ))}
                {columns.length > 0 && <th>Over time</th>}
              </tr>
            </thead>
            <tbody>
              {view.posts.map((post) => (
                <tr key={post.actionId} data-testid={`post-result-${post.actionId}`}>
                  <td>
                    {post.url ? <AddressLink url={post.url} channelId={channel.id}>{post.title || 'Untitled post'}</AddressLink> : post.title || 'Untitled post'} {post.removed && <Badge tone="bad">Removed</Badge>}
                  </td>
                  <td className="muted">{shortTime(post.sentAt)}</td>
                  {columns.map((key) => (
                    <td key={key} className="num">
                      {typeof post.numbers?.[key] === 'number' ? shortCount(post.numbers[key] as number) : <span className="muted">—</span>}
                    </td>
                  ))}
                  {columns.length > 0 && <td>{columns[0] && <Sparkline values={lineOf(post, columns[0])} label={`${columnLabel(columns[0], view.platform)} of this post over time: ${post.numbers ? (numbersLine(view.platform, post.numbers) ?? 'not read yet') : 'not read yet'}`} />}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {columns.length === 0 && (
            <p className="muted small" data-testid="post-results-waiting">
              {view.posts.every((post) => post.removed)
                ? 'Nothing was read: the posts here were taken down, and a post that is not up has no numbers to read.'
                : 'Not read yet. The first reading comes about fifteen minutes after a post goes out, then every hour in its first day.'}
            </p>
          )}
        </>
      )}
      <ErrorNote error={reading.error} />
    </Card>
  )
}
