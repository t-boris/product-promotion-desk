import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { FEED_SOURCES, buildFeedRows, channelOptionLabel, emptyKind, groupByDay, nothingFoundWords, readableChannels, sourceCounts, stateCounts, visibleRows, watchedChannels, widestFilter, type FeedRow, type FeedSourceFilter } from './feed/feed-filter'
import { FEED_TABS, isFindingRow, judgedLine, notedCount, notedEmptyKind, opportunityListOf, unseenNoticeCount, visibleFindings, type FeedTab, type ListedRow, type NotedEmpty } from './feed/finding-rows'
import { STREAM_SORTS, filterStream, searchStream, sortStream, streamCounts, visibleFilters, type StreamFilter, type StreamSort } from './feed/stream-filter'
import { FindingStream } from './feed/FindingStream'
import { FeedAnalysisCard, type FeedFocus } from './feed/FeedAnalysisCard'
import { focusLine, rowsOfFocus } from './feed/analysis-card'
import { usePaging } from '../list-paging'
import { ShowMore } from './ShowMore'
import { FindingDetail } from './feed/FindingDetail'
import { useFeedCards } from './feed/useFeedCards'
import { useFindings, useMarkSeenOnShow } from './feed/useFindings'
import { useWatchingContext } from './feed/useWatching'
import { productWatching } from './feed/watching-line'
import { selectionAfterDismiss } from './inbox/inbox-groups'
import { SELECTION_KEYS, selectionAfterKey, type SelectionKey } from '../list-selection'
import { useListSelection } from '../use-list-selection'
import { NoProduct } from './ProductScreen'
import { useMainActionOwner } from './review/main-action'
import { OlderDiscussions } from './review/OlderDiscussions'
import './review/review.css'
import './feed/feed.css'

const NO_CHANNELS: Channel[] = []
const NO_ROWS: FeedRow[] = []
const NO_LISTED: ListedRow[] = []

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
 * What happens in the current product's channels (DEC-037 phase E, DEC-039, DEC-040): new posts, comments, replies to the account and
 * mentions, each with what the AI proposes, and what the AI noticed in the posts it judged. A line under the header says how the channels
 * are watched (how often, when last, when next, or why not). The segments choose the list (To decide, Noted, Sent, Skipped); beside them
 * the number of posts judged not relevant opens them, read-only, to check the AI. Chips choose the source (of the opportunity lists), a
 * pop-up the channel; the items are listed under the day they were found, with the selected one in full beside the list and its buttons
 * pinned under it, as in the Inbox. An item that needs a decision is the same object in the Inbox. A notice (Noted) is not an item to
 * decide: it has nothing to approve or send, and selecting it marks it seen. "Check now" and the older discussions of a channel stay in
 * the header; the screen's one filled button is the selected item's main action.
 */
function FeedScreen({ product }: { product: Product }) {
  const channelsQuery = useQuery('channels.list', { productId: product.id }, ['channels', 'products'])
  const channels = channelsQuery.data ?? NO_CHANNELS
  const feed = useFeedCards(product.id)
  const rows = useMemo(() => buildFeedRows(feed.cards), [feed.cards])

  const [source, setSource] = useState<FeedSourceFilter>('all')
  // The tab the owner chose; until they choose one, the Feed opens on "To decide", or on Noted when nothing waits to be decided and posts were noted.
  const [picked, setTab] = useState<FeedTab | null>(null)
  const [search, setSearch] = useState('')
  const [starFilter, setStarFilter] = useState<StreamFilter>('all')
  const [sort, setSort] = useState<StreamSort>('newest')
  const [chosenChannel, setChosenChannel] = useState<Id | ''>('')
  // The posts of a theme (or the one post of a question) of the analysis card: the stream below shows only them until the owner shows all again.
  const [focus, setFocus] = useState<FeedFocus | null>(null)
  const [olderFor, setOlderFor] = useState<Id | null>(null)
  // The posts the AI judged not relevant, listed read-only in place of the Feed's lists (asked for only now).
  const [auditing, setAuditing] = useState(false)
  const watching = useWatchingContext()

  // A channel that left the product is no filter any more.
  const channelId: Id | null = chosenChannel !== '' && channels.some((c) => c.id === chosenChannel) ? chosenChannel : null
  const findings = useFindings(product.id, { skipped: auditing, channelId })
  const states = useMemo(() => stateCounts(rows, { source, channelId }), [rows, source, channelId])
  const notices = useMemo(() => visibleFindings(findings.notices, channelId), [findings.notices, channelId])
  const defaultTab: FeedTab = states.decide === 0 && notices.length > 0 ? 'noted' : 'decide'
  const tab: FeedTab = picked ?? defaultTab
  // A theme of the analysis is about the channel it was opened in: another channel or another list starts from every post again.
  useEffect(() => setFocus(null), [channelId, tab])
  // Noted lists findings, not opportunities: the three lists of opportunities (and the source chips, which are theirs) do not apply to it.
  const filterCounts = useMemo(() => streamCounts(notices), [notices])
  const list = opportunityListOf(tab)
  const visible = useMemo(() => (list === null ? NO_ROWS : visibleRows(rows, { source, state: list, channelId })), [rows, source, list, channelId])
  const sources = useMemo(() => sourceCounts(rows, { state: list ?? 'decide', channelId }), [rows, list, channelId])
  const noted = notedCount(findings.counts, findings.notices, channelId)
  const unseen = unseenNoticeCount(findings.counts, findings.notices, channelId)

  // The findings of the tab, searched and sorted as the owner asked, a page at a time; the opportunity lists are paged too. A new tab, channel, search or
  // sort starts again from the top.
  const findingRows = useMemo(() => rowsOfFocus(sortStream(searchStream(filterStream(notices, starFilter), search), sort), focus), [notices, starFilter, search, sort, focus])
  const pagedFindings = usePaging(findingRows, `${tab}|${channelId}|${starFilter}|${search}|${sort}|${focus?.label ?? ''}`)
  const pagedOpportunities = usePaging(visible, `${tab}|${source}|${channelId}`)

  // What the list shows: the posts judged not relevant while the owner checks them (a list with a pane), else the opportunities of the list. The Noted posts
  // are a stream of cards, each with its thread, and have no selected row.
  const listed: readonly ListedRow[] = auditing ? findings.skipped : list === null ? NO_LISTED : pagedOpportunities.visible
  const listedById = useMemo(() => new Map<string, ListedRow>(listed.map((row) => [row.id, row])), [listed])

  const offset = localOffsetMinutes()
  const today = localDay(new Date(), offset)
  const days = useMemo(() => groupByDay(listed, today, offset), [listed, today, offset])

  // The row shown: the chosen one while it is listed; when it leaves the list (sent, rejected) the one that took its place. A finding and an
  // opportunity are told apart by the row, not by the selection: the same hook and keys walk either list.
  const order = useMemo(() => listed.map((row) => row.id), [listed])
  const [selectedId, setChosen] = useListSelection(order, selectionAfterDismiss)
  const selected = selectedId !== null ? listedById.get(selectedId) : undefined
  // A notice that is shown is a notice the owner has seen: asked of the core once.
  useMarkSeenOnShow(selected !== undefined && isFindingRow(selected) ? selected : undefined, findings.markSeen)

  // The one filled button belongs to the selected item while it offers a main action.
  const main = useMainActionOwner(selectedId ? [selectedId] : [])

  // A check is for every channel the app looks at, in the browser too (DEC-042); the older discussions are read through a connector only.
  const checkable = watchedChannels(channels, channelId)
  const readable = readableChannels(channels, channelId)
  const olderChannel = olderFor !== null ? readableChannels(channels, null).find((c) => c.id === olderFor) : undefined
  const viewingOlder = olderChannel !== undefined

  // The arrow keys walk the list; a focused field, button or link of the item keeps its own keys.
  const latest = useRef({ listed, selectedId })
  latest.current = { listed, selectedId }
  const listing = !viewingOlder
  useEffect(() => {
    if (!listing) return
    const onKey = (event: KeyboardEvent): void => {
      if (!SELECTION_KEYS.includes(event.key) || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditable(event.target)) return
      const target = event.target as HTMLElement
      if (target !== document.body && !target.closest('.feed-list')) return
      const next = selectionAfterKey(latest.current.listed.map((row) => row.id), latest.current.selectedId, event.key as SelectionKey)
      if (next === null) return
      event.preventDefault()
      setChosen(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listing])

  // The result of a check is the line under the header: it says when the channel was last looked at and when it is next.
  const [checkNow, checking] = useAction(async (id: Id) => call('channels.checkNow', { channelId: id }))
  const check = (id: Id): void => void checkNow(id)
  const showAll = (): void => {
    setChosenChannel('')
    setFocus(null)
    if (list === null) {
      setSearch('')
      setStarFilter('all')
      return
    }
    const widest = widestFilter(rows)
    setSource(widest.source)
    setTab(widest.state)
  }
  const backToFeed = (): void => {
    setOlderFor(null)
    setAuditing(false)
  }

  const waiting = auditing ? findings.loadingSkipped : list === null ? findings.loading : feed.loading
  const loading = (channelsQuery.loading && channelsQuery.data === undefined) || waiting
  const ready = !loading && channelsQuery.data !== undefined
  const empty: NotedEmpty | null = !ready || auditing ? null : list === null ? notedEmptyKind(channels, findings.notices, findingRows) : emptyKind(channels, rows, visible)
  const error = channelsQuery.error ?? feed.error ?? findings.error
  const summary = watching !== null && channelsQuery.data !== undefined ? productWatching(channels, watching) : null
  const judged = judgedLine(findings.counts)
  const tabLabel = (id: FeedTab, label: string): ReactNode => {
    if (id !== 'noted') return `${label} ${states[id]}`
    return (
      <>
        {label} {noted}
        {unseen > 0 && (
          <span className="count neutral" title={`${unseen} not seen yet`} data-testid="feed-noted-unseen">
            <span aria-hidden="true">{unseen}</span>
            <span className="sr-only">{`${unseen} not seen yet`}</span>
          </span>
        )}
      </>
    )
  }

  return (
    <Page
      title="Feed"
      subtitle={`${product.name} · What happens in your channels, and what the AI proposes`}
      fill
      actions={
        viewingOlder || auditing ? (
          <Button onClick={backToFeed} data-testid="feed-back">
            Back to the Feed
          </Button>
        ) : (
          <>
            <ChannelAction label={checking.busy ? 'Checking…' : 'Check now'} channels={checkable} onPick={check} disabled={checking.busy} testId="check-now" />
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
          {/* How the channels are watched: how often, when last, when next, or why not (DEC-040). It stays under the header whatever list is open. */}
          {summary && (
            <Hint data-testid="feed-watching" data-watching={summary.watching}>
              {summary.text}
            </Hint>
          )}

          {auditing && (
            <Hint data-testid="feed-judged-note">Posts the AI judged not relevant to your goals, with its reason, so you can check its judgement. Nothing here is sent.</Hint>
          )}

          {!auditing && channelsQuery.data !== undefined && channels.length > 0 && (
            <>
              <div className="feed-lists" data-testid="feed-lists">
                <SegmentedControl<FeedTab>
                  label="State"
                  name="feed-state"
                  testIdPrefix="feed-state-"
                  value={tab}
                  onChange={setTab}
                  options={FEED_TABS.map((t) => ({ value: t.id, label: tabLabel(t.id, t.label) }))}
                />
                {judged && (
                  <span className="feed-judged" data-testid="feed-judged">
                    <span data-testid="feed-judged-count">{judged.text}</span>
                    {judged.waiting !== null && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span title="The AI judges posts when its engine is ready (Settings); a post waits until then" data-testid="feed-judged-waiting">
                          {judged.waiting}
                        </span>
                      </>
                    )}
                    {judged.canShow && (
                      <>
                        <span aria-hidden="true">·</span>
                        <Button variant="quiet" className="accent" onClick={() => setAuditing(true)} aria-label="Show the posts judged not relevant" data-testid="feed-judged-show">
                          Show
                        </Button>
                      </>
                    )}
                  </span>
                )}
              </div>
              <div className="feed-controls" data-testid="feed-controls">
                {list !== null && (
                  <SegmentedControl<FeedSourceFilter>
                    label="Source"
                    name="feed-source"
                    testIdPrefix="feed-source-"
                    value={source}
                    onChange={setSource}
                    options={FEED_SOURCES.map((s) => ({ value: s.id, label: `${s.label} ${sources[s.id]}` }))}
                  />
                )}
                {list === null && (
                  <>
                    <SegmentedControl<StreamFilter>
                      label="Show"
                      name="feed-filter"
                      testIdPrefix="feed-filter-"
                      value={starFilter}
                      onChange={setStarFilter}
                      options={visibleFilters(filterCounts, starFilter).map((f) => ({ value: f.id, label: `${f.label} ${filterCounts[f.id]}` }))}
                    />
                    <input
                      className="input feed-search"
                      type="search"
                      value={search}
                      placeholder="Search posts"
                      aria-label="Search posts"
                      onChange={(e) => setSearch(e.target.value)}
                      data-testid="feed-search"
                    />
                    <select className="input feed-sort" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as StreamSort)} data-testid="feed-sort">
                      {STREAM_SORTS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {`Sort: ${s.label}`}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <select className="input feed-channel" aria-label="Channel" value={channelId ?? ''} onChange={(e) => setChosenChannel(e.target.value)} data-testid="channel-filter">
                  <option value="">All channels</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {channelOptionLabel(c)}
                    </option>
                  ))}
                </select>
                {/* The chosen channel's page in the browser of its account, to look around signed in as it (DEC-028). It sits in this row, which wraps: a sentence of it takes a line. */}
                {channelId !== null && <OpenChannelBrowser channelId={channelId} testId="opportunities-browse" />}
              </div>
            </>
          )}

          {!auditing && channelsQuery.data !== undefined && <ReadingNotes channels={channels} source={list === null ? 'new_post' : source} channelId={channelId} watching={watching} />}

          {(feed.capped || findings.capped) && <Hint data-testid="feed-capped">Only the newest 300 items of each list are shown.</Hint>}

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
              {nothingFoundWords(channels)}
            </EmptyState>
          )}

          {empty === 'nothing_noted' && (
            <EmptyState fill art="inbox" title="Nothing noted yet">
              The AI looks at every post of your channels when it checks them. A post that is worth knowing about, or worth a reply, is listed here with what is said under it. Press Check now to look again.
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
              {list === null ? 'Nothing was noted in the channel you chose.' : 'Nothing fits the source, the channel and the list you chose.'}
            </EmptyState>
          )}

          {auditing && ready && listed.length === 0 && (
            <EmptyState fill art="inbox" title="Nothing judged not relevant">
              Posts the AI judges not relevant to your goals are counted and listed here. There are none now.
            </EmptyState>
          )}

          {!auditing && list === null && empty === null && ready && findingRows.length > 0 && (
            <div className="feed-scroll" data-testid="feed-noted-scroll">
              <FeedAnalysisCard productId={product.id} channelId={channelId} onFocus={setFocus} />
              {focus !== null && (
                <div className="feed-focus" data-testid="feed-focus">
                  <span className="muted small">{focusLine(focus.label, findingRows.length, focus.ids.size)}</span>
                  <Button variant="secondary" onClick={() => setFocus(null)} data-testid="feed-focus-clear">
                    Show all posts
                  </Button>
                </div>
              )}
              <h3 className="feed-stream-title" data-testid="feed-stream-title">
                Posts <span className="muted">{findingRows.length}</span>
              </h3>
              <FindingStream
                rows={pagedFindings.visible}
                markSeen={findings.markSeen}
                setStarred={findings.setStarred}
                footer={<ShowMore hidden={pagedFindings.hidden} total={pagedFindings.total} onMore={pagedFindings.more} testId="feed-show-more" />}
              />
            </div>
          )}

          {(auditing || list !== null) && empty === null && ready && listed.length > 0 && (
            <div className="feed-split">
              <FeedList
                days={days}
                rows={listedById}
                selectedId={selectedId}
                onSelect={setChosen}
                label={auditing ? 'Posts judged not relevant' : undefined}
                footer={auditing ? undefined : <ShowMore hidden={pagedOpportunities.hidden} total={pagedOpportunities.total} onMore={pagedOpportunities.more} testId="feed-show-more" />}
              />
              <div className="inbox-detail-pane">
                {selected &&
                  (isFindingRow(selected) ? (
                    <FindingDetail key={selected.id} row={selected} />
                  ) : (
                    <FeedDetail key={selected.id} card={selected.card} primaryAction={main.isOwner(selected.id)} onMainAction={main.offer} />
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </Page>
  )
}
