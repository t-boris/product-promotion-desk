import { useState } from 'react'
import { numbersLine } from '../../../shared/post-numbers'
import type { Product, WeeklyReviewView } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { Badge, Button, Card, ErrorNote, Hint, Loading } from '../ui'
import { AddressLink } from './AddressLink'
import { ProductScreen } from './ProductScreen'
import { relativeTime } from './inbox/inbox-groups'
import { shortTime } from './posts/short-time'
import { channelCell, channelColumns, followedText, knownNote, likesHeading, totals } from './weekly/weekly-view'
import './weekly/weekly.css'

/**
 * The weekly review of the current product (DEC-057): what went out in a week and what the sites showed under it, against the product's own
 * usual; what worked and what did not, in the AI's words; and one change for the next week, which the owner accepts, declines or writes
 * themselves. Every number is counted by the application. Nothing here posts, approves or schedules anything.
 */
export function ReviewPage() {
  return (
    <ProductScreen title="Review" subtitle="One week at a time" nextStage={false}>
      {(product) => <ReviewBody product={product} />}
    </ProductScreen>
  )
}

function ReviewBody({ product }: { product: Product }) {
  const [week, setWeek] = useState<string | null>(null)
  const review = useQuery('weekly.get', { productId: product.id, week }, ['results', 'opportunities'])
  const view = review.data
  if (!view) return review.error ? <ErrorNote error={review.error} /> : <Loading what="Loading the review" />
  return (
    <div className="weekly" data-testid="weekly-review">
      <div className="weekly-head">
        <div>
          <h2 className="weekly-title" data-testid="weekly-title">
            Week of {view.label}
          </h2>
          <Hint>{view.ended ? 'Counted by the application from what it sent and what it read on the sites.' : 'This week is still running: the numbers so far. Its review is prepared on Monday at 9:00.'}</Hint>
        </div>
        <div className="weekly-nav">
          <Button onClick={() => setWeek(view.previousWeek)} data-testid="weekly-previous">
            Earlier week
          </Button>
          <Button onClick={() => setWeek(view.nextWeek)} disabled={view.nextWeek === null} data-testid="weekly-next">
            Later week
          </Button>
        </div>
      </div>
      <Totals view={view} />
      <Channels view={view} />
      <Words view={view} productId={product.id} />
      <Change view={view} productId={product.id} />
      <PostsOfWeek view={view} />
      <Earlier view={view} onOpen={setWeek} />
    </div>
  )
}

function Totals({ view }: { view: WeeklyReviewView }) {
  const note = knownNote(view.numbers.week)
  return (
    <Card>
      <dl className="weekly-totals" data-testid="weekly-totals">
        {totals(view).map((figure) => (
          <div key={figure.label}>
            <dt>{figure.label}</dt>
            <dd>{figure.value}</dd>
            {figure.beside && <span className={`weekly-beside${figure.tone ? ` ${figure.tone}` : ''}`}>{figure.beside}</span>}
          </div>
        ))}
      </dl>
      <Hint>“Usual” is this product’s own average week of the four weeks before.{note ? ` ${note}` : ''}</Hint>
    </Card>
  )
}

function Channels({ view }: { view: WeeklyReviewView }) {
  if (view.numbers.channels.length === 0) return null
  const columns = channelColumns(view)
  const heading = (key: 'views' | 'likes' | 'comments'): string => (key === 'views' ? 'Views' : key === 'comments' ? 'Comments' : likesHeading(Object.values(view.channels).map((c) => c.platform)))
  return (
    <Card title="Each channel against its own usual">
      <table className="table weekly-table" data-testid="weekly-channels">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">Posts</th>
            <th className="num">Replies</th>
            {columns.map((key) => (
              <th key={key} className="num">
                {heading(key)}
              </th>
            ))}
            <th>Taken down</th>
          </tr>
        </thead>
        <tbody>
          {view.numbers.channels.map((c) => (
            <tr key={c.channelId}>
              <td>
                <a href={`#/channels/${c.channelId}/results`}>{view.channels[c.channelId]?.target ?? 'A channel'}</a>
              </td>
              <td className="num">{c.week.posts}</td>
              <td className="num">{c.week.replies}</td>
              {columns.map((key) => {
                const cell = channelCell(c.week[key], c.usual[key])
                return (
                  <td key={key} className="num">
                    {cell.value} {cell.beside && <span className={`weekly-beside${cell.tone ? ` ${cell.tone}` : ''}`}>{cell.beside}</span>}
                  </td>
                )
              })}
              <td>{c.week.removed > 0 ? <Badge tone="bad">{c.week.removed} taken down</Badge> : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function Words({ view, productId }: { view: WeeklyReviewView; productId: string }) {
  const [prepare, preparing] = useAction(() => call('weekly.prepare', { productId, week: view.week }))
  if (!view.ended) return null
  if (view.tooFew && !view.words) {
    return (
      <Card title="What worked, what did not">
        <p className="muted" data-testid="weekly-too-few">
          Too little went out in this week to review it: the AI is not asked. A week with at least two posts or replies gets a review.
        </p>
      </Card>
    )
  }
  const button = (
    <Button onClick={() => void prepare()} disabled={preparing.busy} variant={view.words ? 'ghost' : 'primary'} data-testid="weekly-prepare">
      {preparing.busy ? 'Preparing…' : view.words ? 'Prepare again' : 'Prepare the review'}
    </Button>
  )
  if (!view.words) {
    return (
      <Card title="What worked, what did not" actions={button}>
        <p className="muted" data-testid="weekly-not-prepared">
          Not prepared yet. The AI reads the numbers above and the titles of the week’s posts, and writes what worked, what did not and one change to try. It opens no site and posts nothing.
        </p>
        <ErrorNote error={preparing.error} />
      </Card>
    )
  }
  return (
    <Card
      title="What worked, what did not"
      actions={
        <>
          <Hint>written by the AI {relativeTime(view.words.preparedAt)}</Hint>
          {button}
        </>
      }
    >
      <div className="weekly-two" data-testid="weekly-words">
        <div>
          <h3>What worked</h3>
          {view.words.worked.length > 0 ? <ul>{view.words.worked.map((point) => <li key={point}>{point}</li>)}</ul> : <p className="muted">Nothing stood out.</p>}
        </div>
        <div>
          <h3>What did not</h3>
          {view.words.didNot.length > 0 ? <ul>{view.words.didNot.map((point) => <li key={point}>{point}</li>)}</ul> : <p className="muted">Nothing stood out.</p>}
        </div>
      </div>
      <ErrorNote error={preparing.error} />
    </Card>
  )
}

function Change({ view, productId }: { view: WeeklyReviewView; productId: string }) {
  const [writing, setWriting] = useState(false)
  const [text, setText] = useState('')
  const [decide, deciding] = useAction(async (decision: 'accept' | 'decline' | 'own') => {
    await call('weekly.decide', { productId, week: view.week, decision, ...(decision === 'own' ? { text } : {}) })
    setWriting(false)
    setText('')
  })
  if (!view.ended) return null
  const change = view.change
  const state = change?.state
  return (
    <Card title="One change for the next week" className="weekly-change">
      {change ? (
        <>
          <p className="weekly-change-text" data-testid="weekly-change">
            {change.text} {state === 'accepted' && <Badge tone="good">Accepted</Badge>}
            {state === 'declined' && <Badge>Declined</Badge>}
          </p>
          {change.why && <p className="muted">Why: {change.why}</p>}
          <Hint>{change.byOwner ? 'Written by you.' : 'Proposed by the AI from the numbers above; you decide.'}</Hint>
        </>
      ) : (
        <p className="muted" data-testid="weekly-no-change">
          No change yet. Prepare the review to get a proposal, or write your own.
        </p>
      )}
      {writing ? (
        <div className="weekly-own">
          <textarea className="input short" value={text} onChange={(e) => setText(e.target.value)} placeholder="What will you do differently next week? One sentence." autoFocus data-testid="weekly-own-text" />
          <div className="weekly-actions">
            <Button variant="primary" onClick={() => void decide('own')} disabled={deciding.busy || text.trim() === ''} data-testid="weekly-own-save">
              Use this change
            </Button>
            <Button onClick={() => setWriting(false)} disabled={deciding.busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="weekly-actions">
          {change && state !== 'accepted' && (
            <Button variant={state === 'proposed' ? 'primary' : 'ghost'} onClick={() => void decide('accept')} disabled={deciding.busy} data-testid="weekly-accept">
              Accept for the next week
            </Button>
          )}
          {change && state !== 'declined' && (
            <Button onClick={() => void decide('decline')} disabled={deciding.busy} data-testid="weekly-decline">
              Not this one
            </Button>
          )}
          <Button onClick={() => setWriting(true)} disabled={deciding.busy} data-testid="weekly-own">
            Write my own
          </Button>
        </div>
      )}
      <Hint>An accepted change is given to the AI as your direction when it proposes posts for this product, for the two weeks after this one. It changes no schedule and no content mix, and nothing is posted because of it.</Hint>
      <ErrorNote error={deciding.error} />
    </Card>
  )
}

function PostsOfWeek({ view }: { view: WeeklyReviewView }) {
  if (view.posts.length === 0) return null
  return (
    <Card title="The posts of the week, the best first">
      <table className="table weekly-table" data-testid="weekly-posts">
        <thead>
          <tr>
            <th>Post</th>
            <th>Channel</th>
            <th>Sent</th>
            <th>What the site shows</th>
          </tr>
        </thead>
        <tbody>
          {view.posts.map((post) => {
            const platform = view.channels[post.channelId]?.platform ?? ''
            const line = post.numbers ? numbersLine(platform, post.numbers) : null
            return (
              <tr key={post.actionId}>
                <td>
                  {post.url ? (
                    <AddressLink url={post.url} channelId={post.channelId}>
                      {post.title || 'Untitled post'}
                    </AddressLink>
                  ) : (
                    post.title || 'Untitled post'
                  )}{' '}
                  {post.removed && <Badge tone="bad">Removed</Badge>}
                </td>
                <td className="muted">{view.channels[post.channelId]?.target ?? ''}</td>
                <td className="muted">{shortTime(post.sentAt)}</td>
                <td>{line ?? <span className="muted">not read</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

function Earlier({ view, onOpen }: { view: WeeklyReviewView; onOpen: (week: string) => void }) {
  if (view.earlier.length === 0) return null
  return (
    <Card title="Earlier weeks">
      <table className="table weekly-table" data-testid="weekly-earlier">
        <thead>
          <tr>
            <th>Week</th>
            <th>The change</th>
            <th>What followed</th>
          </tr>
        </thead>
        <tbody>
          {view.earlier.map((row) => (
            <tr key={row.week}>
              <td>
                <button type="button" className="link-btn" onClick={() => onOpen(row.week)}>
                  {row.label}
                </button>
              </td>
              <td>
                {row.change ?? <span className="muted">No change</span>} {row.change && row.state === 'declined' && <Badge>Declined</Badge>}
                {row.change && row.state === 'proposed' && <Badge>Not answered</Badge>}
              </td>
              <td className="muted">{row.change ? followedText(row.followed, row.state) || '—' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
