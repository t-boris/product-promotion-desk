import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { localDay } from '../../../shared/local-day'
import type { Channel, Id, Product } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { useCurrentProduct } from '../product-context'
import { postsHref } from '../route'
import { Button, EmptyState, ErrorNote, Hint, Loading, OpenFormsScope, Page, SegmentedControl } from '../ui'
import { connectChannelHref } from './attention-links'
import { OpenChannelBrowser } from './channels/OpenChannelBrowser'
import { ChannelAction } from './feed/ChannelAction'
import { FeedDetail } from './feed/FeedDetail'
import { FeedList } from './feed/FeedList'
import { ReadingNotes } from './feed/ReadingNotes'
import { FEED_SOURCES, FEED_STATES, buildFeedRows, emptyKind, groupByDay, readableChannels, sourceCounts, stateCounts, visibleRows, widestFilter, type FeedSourceFilter, type FeedState } from './feed/feed-filter'
import { useFeedCards } from './feed/useFeedCards'
import { selectionAfterDismiss } from './inbox/inbox-groups'
import { SELECTION_KEYS, selectionAfterKey, type SelectionKey } from '../list-selection'
import { useListSelection } from '../use-list-selection'
import { NoProduct } from './ProductScreen'
import { useMainActionOwner } from './review/main-action'
import { OlderDiscussions } from './review/OlderDiscussions'
import './review/review.css'
import './feed/feed.css'

const NO_CHANNELS: Channel[] = []

/** True while the key goes to a field the owner is typing in: the arrow keys then belong to the caret. */
function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element !== null && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

/** The viewer's offset from UTC in minutes, east positive: an item is listed under the day the owner lives it on. */
const localOffsetMinutes = (): number => -new Date().getTimezoneOffset()

export function FeedPage() {
  const { current, loading, error } = useCurrentProduct()
  return (
    // One scope for the page: a form opened on an item owns the screen's filled button while it is open.
    <OpenFormsScope>
      {current ? (
        <Fragment key={current.id}>
          <FeedScreen product={current} />
        </Fragment>
      ) : (
        <Page title="Feed" subtitle="What happens in your channels, and what the AI proposes">
          <NoProduct loading={loading} error={error} />
        </Page>
      )}
    </OpenFormsScope>
  )
}

/**
 * What happens in the current product's channels (DEC-037 phase E, DEC-039): new posts that match the channel's topics, comments, replies
 * to the account and mentions, each with what the AI proposes. Chips choose the source, the segments the list (To decide, Sent, Skipped), a
 * pop-up the channel; the items are listed under the day they were found, with the selected one in full beside the list and its buttons
 * pinned under it, as in the Inbox. An item that needs a decision is the same object in the Inbox. "Check now" and the older discussions
 * of a channel stay in the header; the screen's one filled button is the selected item's main action.
 */
function FeedScreen({ product }: { product: Product }) {
  const channelsQuery = useQuery('channels.list', { productId: product.id }, ['channels', 'products'])
  const channels = channelsQuery.data ?? NO_CHANNELS
  const feed = useFeedCards(product.id)
  const rows = useMemo(() => buildFeedRows(feed.cards), [feed.cards])
  const rowsById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])

  const [source, setSource] = useState<FeedSourceFilter>('all')
  const [state, setState] = useState<FeedState>('decide')
  const [chosenChannel, setChosenChannel] = useState<Id | ''>('')
  const [olderFor, setOlderFor] = useState<Id | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(null)

  // A channel that left the product is no filter any more.
  const channelId: Id | null = chosenChannel !== '' && channels.some((c) => c.id === chosenChannel) ? chosenChannel : null
  const visible = useMemo(() => visibleRows(rows, { source, state, channelId }), [rows, source, state, channelId])
  const sources = useMemo(() => sourceCounts(rows, { state, channelId }), [rows, state, channelId])
  const states = useMemo(() => stateCounts(rows, { source, channelId }), [rows, source, channelId])

  const offset = localOffsetMinutes()
  const today = localDay(new Date(), offset)
  const days = useMemo(() => groupByDay(visible, today, offset), [visible, today, offset])

  // The row shown: the chosen one while it is listed; when it leaves the list (sent, rejected) the one that took its place.
  const order = useMemo(() => visible.map((row) => row.id), [visible])
  const [selectedId, setChosen] = useListSelection(order, selectionAfterDismiss)
  const selected = selectedId !== null ? rowsById.get(selectedId) : undefined

  // The one filled button belongs to the selected item while it offers a main action.
  const main = useMainActionOwner(selectedId ? [selectedId] : [])

  const readable = readableChannels(channels, channelId)
  const olderChannel = olderFor !== null ? readableChannels(channels, null).find((c) => c.id === olderFor) : undefined
  const viewingOlder = olderChannel !== undefined

  // The arrow keys walk the list; a focused field, button or link of the item keeps its own keys.
  const latest = useRef({ visible, selectedId })
  latest.current = { visible, selectedId }
  const listing = !viewingOlder
  useEffect(() => {
    if (!listing) return
    const onKey = (event: KeyboardEvent): void => {
      if (!SELECTION_KEYS.includes(event.key) || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditable(event.target)) return
      const target = event.target as HTMLElement
      if (target !== document.body && !target.closest('.feed-list')) return
      const next = selectionAfterKey(latest.current.visible.map((row) => row.id), latest.current.selectedId, event.key as SelectionKey)
      if (next === null) return
      event.preventDefault()
      setChosen(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listing])

  const [checkNow, checking] = useAction(async (id: Id) => call('channels.checkNow', { channelId: id }))
  const check = (id: Id): void => {
    void checkNow(id).then((run) => {
      if (run) setLastRun(`${run.status}: ${run.summary}`)
    })
  }
  const showAll = (): void => {
    const widest = widestFilter(rows)
    setSource(widest.source)
    setState(widest.state)
    setChosenChannel('')
  }

  const loading = (channelsQuery.loading && channelsQuery.data === undefined) || feed.loading
  const empty = loading || channelsQuery.data === undefined ? null : emptyKind(channels, rows, visible)
  const error = channelsQuery.error ?? feed.error

  return (
    <Page
      title="Feed"
      subtitle={`${product.name} · What happens in your channels, and what the AI proposes`}
      fill
      actions={
        viewingOlder ? (
          <Button onClick={() => setOlderFor(null)} data-testid="feed-back">
            Back to the Feed
          </Button>
        ) : (
          <>
            <ChannelAction label={checking.busy ? 'Checking…' : 'Check now'} channels={readable} onPick={check} disabled={checking.busy} testId="check-now" />
            <ChannelAction label="Older discussions" variant="quiet" channels={readable} onPick={setOlderFor} testId="feed-older" />
          </>
        )
      }
    >
      <ErrorNote error={error ?? checking.error} />

      {viewingOlder && (
        <div className="feed-scroll">
          <OlderDiscussions channel={olderChannel} defaultOpen />
        </div>
      )}

      {!viewingOlder && (
        <>
          {lastRun && (
            <Hint data-testid="check-result">
              Last check: {lastRun}
            </Hint>
          )}

          {channelsQuery.data !== undefined && channels.length > 0 && (
            <div className="feed-controls" data-testid="feed-controls">
              <SegmentedControl<FeedSourceFilter>
                label="Source"
                name="feed-source"
                testIdPrefix="feed-source-"
                value={source}
                onChange={setSource}
                options={FEED_SOURCES.map((s) => ({ value: s.id, label: `${s.label} ${sources[s.id]}` }))}
              />
              <SegmentedControl<FeedState>
                label="State"
                name="feed-state"
                testIdPrefix="feed-state-"
                value={state}
                onChange={setState}
                options={FEED_STATES.map((s) => ({ value: s.id, label: `${s.label} ${states[s.id]}` }))}
              />
              <select className="input feed-channel" aria-label="Channel" value={channelId ?? ''} onChange={(e) => setChosenChannel(e.target.value)} data-testid="channel-filter">
                <option value="">All channels</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.target}
                    {c.reads ? '' : ' (not read)'}
                  </option>
                ))}
              </select>
              {/* The chosen channel's page in the browser of its account, to look around signed in as it (DEC-028). It sits in this row, which wraps: a sentence of it takes a line. */}
              {channelId !== null && <OpenChannelBrowser channelId={channelId} testId="opportunities-browse" />}
            </div>
          )}

          {channelsQuery.data !== undefined && <ReadingNotes channels={channels} source={source} channelId={channelId} />}

          {feed.capped && <Hint data-testid="feed-capped">Only the newest 300 items of each list are shown.</Hint>}

          {loading && <Loading what="Loading" />}

          {empty === 'no_channels' && (
            <EmptyState
              fill
              art="channel"
              title="No channels yet"
              action={
                <a className="btn btn-primary" href={connectChannelHref(product.id)} data-testid="opportunities-connect-channel">
                  Connect a channel
                </a>
              }
            >
              The Feed shows what happens in your channels: new posts that match your topics, comments, replies to you and mentions. This product has no channel yet.
            </EmptyState>
          )}

          {empty === 'nothing_read' && (
            <EmptyState
              fill
              art="channel"
              title="Nothing to read here"
              action={
                <a className="btn" href={postsHref(product.id)} data-testid="feed-open-posts">
                  Open Posts
                </a>
              }
            >
              The app does not read any channel of this product: they are for your own posts, so there are no comments to check. Your posts are in Posts.
            </EmptyState>
          )}

          {empty === 'nothing_found' && (
            <EmptyState fill art="inbox" title="Nothing found yet">
              New posts that match your topics, new comments, replies to you and mentions show up here. A new channel starts with a first look that only records what already exists, so only what happens after it is listed. Press Check now to look again.
            </EmptyState>
          )}

          {empty === 'no_match' && (
            <EmptyState
              fill
              art="inbox"
              title="Nothing matches"
              action={
                <Button onClick={showAll} data-testid="feed-clear-filters">
                  Show all
                </Button>
              }
            >
              Nothing fits the source, the channel and the list you chose.
            </EmptyState>
          )}

          {empty === null && !loading && visible.length > 0 && (
            <div className="feed-split">
              <FeedList days={days} rows={rowsById} selectedId={selectedId} onSelect={setChosen} />
              <div className="inbox-detail-pane">
                {selected && <FeedDetail key={selected.id} card={selected.card} primaryAction={main.isOwner(selected.id)} onMainAction={main.offer} />}
              </div>
            </div>
          )}
        </>
      )}
    </Page>
  )
}
