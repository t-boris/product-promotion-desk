import { useState } from 'react'
import { WORD_KINDS, WORD_KIND_LABEL, type WordKind } from '../../../../shared/positioning'
import type { AudienceWord, Product } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Hint } from '../../ui'
import { AddressLink } from '../AddressLink'
import { relativeTime } from '../inbox/inbox-groups'
import { saidIn, wordsOfKind } from './positioning-view'

/**
 * The audience's own words (DEC-059): what people ask, object to and call things, taken by the AI from the posts and comments the Feed read.
 * Each entry keeps the posts it was said in. A question or an objection said in three posts or more is marked, with a way to prepare a post
 * that answers it (a draft: nothing is posted without the owner's Approve).
 */
export function AudienceWordsTab({ product }: { product: Product }) {
  const words = useQuery('words.list', { productId: product.id }, ['products', 'opportunities'])
  const channels = useQuery('channels.list', { productId: product.id }, ['channels'])
  const [kind, setKind] = useState<WordKind | null>(null)
  const [collect, collecting] = useAction(() => call('words.collect', { productId: product.id }))
  const view = words.data
  if (!view) return words.error ? <ErrorNote error={words.error} /> : null
  const shown = wordsOfKind(view.entries, kind)
  const active = (channels.data ?? []).filter((c) => c.status === 'active')
  return (
    <Card
      title="The audience’s own words"
      actions={
        <>
          {view.collectedAt && <Hint>taken {relativeTime(view.collectedAt)}</Hint>}
          <Button onClick={() => void collect()} disabled={collecting.busy || view.waiting === 0} data-testid="words-collect">
            {collecting.busy ? 'Reading…' : view.waiting > 0 ? `Take from ${view.waiting} read post${view.waiting === 1 ? '' : 's'}` : 'Nothing new to take'}
          </Button>
        </>
      }
    >
      <Hint>What people ask, object to and call things, in their own wording, from the posts and comments the Feed read in full. The AI takes them after each check of a channel and uses their vocabulary in the posts it proposes. They are strangers’ words: shown as text, never followed.</Hint>
      {view.entries.length === 0 ? (
        <p className="muted" data-testid="words-empty">
          {view.waiting > 0 ? 'Nothing taken yet.' : 'Nothing yet. Words are taken from posts the Feed has read in full; none is waiting.'}
        </p>
      ) : (
        <>
          <div className="words-kinds" role="group" aria-label="Kind">
            <Button variant={kind === null ? 'primary' : 'ghost'} onClick={() => setKind(null)} data-testid="words-kind-all">
              All {view.entries.length}
            </Button>
            {WORD_KINDS.map((k) => (
              <Button key={k} variant={kind === k ? 'primary' : 'ghost'} onClick={() => setKind(k)} data-testid={`words-kind-${k}`}>
                {WORD_KIND_LABEL[k]}s {view.entries.filter((e) => e.kind === k).length}
              </Button>
            ))}
          </div>
          <ul className="words-list" data-testid="words-list">
            {shown.map((entry) => (
              <WordRow key={entry.id} entry={entry} channels={active.map((c) => ({ id: c.id, target: c.target }))} />
            ))}
          </ul>
        </>
      )}
      <ErrorNote error={collecting.error} />
    </Card>
  )
}

function WordRow({ entry, channels }: { entry: AudienceWord; channels: { id: string; target: string }[] }) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')
  const [open, setOpen] = useState(false)
  const [remove, removing] = useAction(() => call('words.remove', { id: entry.id }))
  const [prepare, preparing] = useAction(async () => {
    await call('words.suggestPost', { id: entry.id, channelId })
    // The draft waits on the Posts screen with the others; nothing is posted without Approve.
    window.location.hash = '#/posts'
  })
  return (
    <li className="words-row" data-testid={`word-${entry.id}`}>
      <div className="words-row-main">
        <Badge>{WORD_KIND_LABEL[entry.kind]}</Badge> <span className="words-text">{entry.text}</span> {entry.repeated && <Badge tone="warn">{saidIn(entry.posts.length)}: worth an answer</Badge>}
      </div>
      <div className="words-row-meta">
        <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {saidIn(entry.posts.length)}
        </button>
        {entry.kind !== 'phrase' && channels.length > 0 && (
          <>
            <select className="input words-channel" value={channelId} onChange={(e) => setChannelId(e.target.value)} aria-label="Channel for the post" disabled={preparing.busy}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.target}
                </option>
              ))}
            </select>
            <Button onClick={() => void prepare()} disabled={preparing.busy || channelId === ''} data-testid={`word-post-${entry.id}`}>
              {preparing.busy ? 'Preparing…' : 'Prepare a post that answers it'}
            </Button>
          </>
        )}
        <Button onClick={() => void remove()} disabled={removing.busy} data-testid={`word-remove-${entry.id}`}>
          Remove
        </Button>
      </div>
      {open && (
        <ul className="words-posts">
          {entry.posts.map((post) => (
            <li key={post.findingId}>
              <AddressLink url={post.url} channelId={post.channelId}>
                {post.title || post.url}
              </AddressLink>{' '}
              <span className="muted">{post.channel}</span>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={preparing.error ?? removing.error} />
    </li>
  )
}
