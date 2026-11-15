import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { localDay } from '../../../shared/local-day'
import type { Channel, Id, IsoTime, Product } from '../../../shared/types'
import { call, useAction, useQuery } from '../hooks'
import { useCurrentProduct } from '../product-context'
import { Button, EmptyState, ErrorNote, Field, Hint, Loading, MenuItem, OpenFormsScope, Page, RowMenu, SegmentedControl } from '../ui'
import { connectChannelHref } from './attention-links'
import { selectionAfterDismiss } from './inbox/inbox-groups'
import { SELECTION_KEYS, selectionAfterKey, type SelectionKey } from '../list-selection'
import { useListSelection } from '../use-list-selection'
import { NoProduct } from './ProductScreen'
import { PostDetail } from './posts/PostDetail'
import { PostsCalendar } from './posts/PostsCalendar'
import { PostsList } from './posts/PostsList'
import { monthOf, offsetOn, plannedTimeOn, rhythmMarkers, monthGrid, type YearMonth } from './posts/posts-calendar'
import { POST_SORTS, POST_STATE_FILTERS, buildPostRows, stateCounts, visibleRows, type PostFilter, type PostSort, type PostStateFilter } from './posts/posts-filter'
import { shortTime } from './posts/short-time'
import { useMixCards } from './posts/useMixCards'
import { useMainActionOwner } from './review/main-action'
import { PublicationForm } from './review/PublicationForm'
import './review/review.css'
import './posts/posts.css'

type View = 'list' | 'calendar'

/** True while the key goes to a field the owner is typing in: the arrow keys then belong to the caret. */
function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element !== null && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

/** The viewer's offset from UTC in minutes, east positive: the calendar puts a post on the day the owner lives it on. */
const localOffsetMinutes = (): number => -new Date().getTimezoneOffset()

export function PostsPage() {
  const { current, loading, error } = useCurrentProduct()
  return (
    // One scope for the page: the new-post form, opened on demand, owns the screen's filled button while it is open.
    <OpenFormsScope>
      {current ? (
        <Fragment key={current.id}>
          <PostsScreen product={current} />
        </Fragment>
      ) : (
        <Page title="Posts" subtitle="Drafts, scheduled and sent material">
          <NoProduct loading={loading} error={error} />
        </Page>
      )}
    </OpenFormsScope>
  )
}

/** What the owner is writing now: the channel the form starts on and, from a day of the calendar, the time it is planned for. */
interface Writing {
  channelId: Id
  plannedAt: IsoTime | null
}

/**
 * Everything the current product has written for its channels (DEC-037, phase B): one row for each post and each group, filtered by
 * state, channel and a search, sorted, as a list with the selected post in full beside it, or as a month of planned and sent posts.
 * "Suggest with AI" and "Write one myself" stay in the header; the screen's one filled button is the selected post's main action, or
 * "Save" while the new-post form is open.
 */
function PostsScreen({ product }: { product: Product }) {
  const channelsQuery = useQuery('channels.list', { productId: product.id }, ['channels', 'products'])
  const channels: Channel[] = channelsQuery.data ?? []
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const cardsQuery = useQuery('opportunities.list', { productId: product.id, kind: 'standalone' }, ['opportunities'])
  // The groups are the product's: one post for several channels is one row, whichever channel the filter is on (DEC-032).
  const groupsQuery = useQuery('postGroups.list', { productId: product.id }, ['opportunities'])
  const groups = groupsQuery.data ?? []
  const rows = useMemo(() => buildPostRows(cardsQuery.data ?? [], groups), [cardsQuery.data, groupsQuery.data])

  const [view, setView] = useState<View>('list')
  const [state, setState] = useState<PostStateFilter>('all')
  const [channelId, setChannelId] = useState<Id | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PostSort>('updated')
  const [writing, setWriting] = useState<Writing | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const filter: PostFilter = { state, channelId, query }
  const visible = useMemo(() => visibleRows(rows, filter, sort), [rows, state, channelId, query, sort])
  const counts = useMemo(() => stateCounts(rows, { channelId, query }), [rows, channelId, query])

  // The row shown: the chosen one while it is listed; when it leaves the list (it was deleted under a filter, say) the one that was next to it.
  const order = useMemo(() => visible.map((row) => row.id), [visible])
  const [selectedId, setChosen] = useListSelection(order, selectionAfterDismiss)
  const selected = visible.find((row) => row.id === selectedId)
  const selectedGroup = selected?.kind === 'group' ? (groups.find((g) => g.group.id === selected.id) ?? null) : null

  // The one filled button belongs to the selected post (or group) while it offers a main action.
  const main = useMainActionOwner(selectedId ? [selectedId] : [])

  // The arrow keys walk the list view; a focused field, button or link of the post keeps its own keys.
  const latest = useRef({ visible, selectedId })
  latest.current = { visible, selectedId }
  const listing = view === 'list' && writing === null
  useEffect(() => {
    if (!listing) return
    const onKey = (event: KeyboardEvent): void => {
      if (!SELECTION_KEYS.includes(event.key) || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditable(event.target)) return
      const target = event.target as HTMLElement
      if (target !== document.body && !target.closest('[data-testid="posts-list"]')) return
      const next = selectionAfterKey(latest.current.visible.map((row) => row.id), latest.current.selectedId, event.key as SelectionKey)
      if (next === null) return
      event.preventDefault()
      setChosen(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listing])

  // The calendar.
  const offset = localOffsetMinutes()
  const today = localDay(new Date(), offset)
  const [month, setMonth] = useState<YearMonth>(() => monthOf(today))
  const [day, setDay] = useState<string | null>(null)
  const { cards: mixCards, unread: mixUnread } = useMixCards(
    channels.map((c) => c.id),
    view === 'calendar'
  )
  const rhythm = useMemo(() => {
    const grid = monthGrid(month, [], today, offset).flat()
    return rhythmMarkers(mixCards, grid[0].date, grid[grid.length - 1].date, offset)
  }, [mixCards, month, today, offset])

  // Writing and suggesting go to a channel: the one the filter is on, else the first one that can take a post.
  const canPost = (channel: Channel): boolean => {
    const ability = channel.capabilities.find((c) => c.key === 'publish_post')
    return !ability || (ability.status !== 'unavailable' && ability.status !== 'restricted')
  }
  const target: Channel | undefined = channels.find((c) => c.id === channelId) ?? channels.find(canPost) ?? channels[0]
  const account = accounts.data?.find((a) => a.id === target?.accountId)
  const authorName = account?.identity ?? account?.label ?? ''
  const postAbility = target?.capabilities.find((c) => c.key === 'publish_post')
  const cannotPost = postAbility && (postAbility.status === 'unavailable' || postAbility.status === 'restricted')

  const [suggest, suggesting] = useAction(async (forChannel: Id) => {
    await call('publications.suggest', { channelId: forChannel })
  })

  const openRow = (id: Id): void => {
    // A post the filters hide is shown by clearing them: the owner asked for that post.
    if (!visible.some((row) => row.id === id)) {
      setState('all')
      setChannelId(null)
      setQuery('')
    }
    setChosen(id)
    setView('list')
  }
  const startWriting = (plannedAt: IsoTime | null): void => {
    if (!target) return
    setNote(null)
    setWriting({ channelId: target.id, plannedAt })
  }
  const clearFilters = (): void => {
    setState('all')
    setChannelId(null)
    setQuery('')
  }

  const loading = (channelsQuery.loading && !channelsQuery.data) || (cardsQuery.loading && !cardsQuery.data)
  const noChannels = channelsQuery.data !== undefined && channels.length === 0
  const nothingYet = !loading && rows.length === 0 && !noChannels
  // With nothing written yet the empty state's "Write one myself" is the screen's filled button; the header then does not offer a second one with the same name.
  const emptyOffersWrite = nothingYet && view === 'list' && writing === null
  const error = channelsQuery.error ?? cardsQuery.error ?? groupsQuery.error

  const suggestControl =
    channels.length > 1 && channelId === null ? (
      <RowMenu label={suggesting.busy ? 'Asking the AI…' : 'Suggest with AI'} testId="suggest-publication">
        {(close) =>
          channels.filter(canPost).map((channel) => (
            <MenuItem
              key={channel.id}
              onClick={() => {
                close()
                void suggest(channel.id)
              }}
              disabled={suggesting.busy}
            >
              {channel.target}
            </MenuItem>
          ))
        }
      </RowMenu>
    ) : (
      // An AI helper is never the filled button: the owner's own way ("Write one myself") is as near as the AI's.
      <Button icon="sparkles" onClick={() => target && void suggest(target.id)} disabled={!target || suggesting.busy} data-testid="suggest-publication">
        {suggesting.busy ? 'Asking the AI…' : 'Suggest with AI'}
      </Button>
    )

  return (
    <Page
      title="Posts"
      subtitle={`${product.name} · Drafts, scheduled and sent material`}
      fill
      actions={
        <>
          <SegmentedControl<View>
            label="View"
            name="posts-view"
            testIdPrefix="posts-view-"
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: 'List' },
              { value: 'calendar', label: 'Calendar' }
            ]}
          />
          {suggestControl}
          {!emptyOffersWrite && (
            <Button onClick={() => startWriting(null)} disabled={!target || writing !== null} data-testid="write-publication">
              Write one myself
            </Button>
          )}
        </>
      }
    >
      <ErrorNote error={error ?? suggesting.error} />
      {note && (
        <div className="note warn" data-testid="posts-note">
          <div>{note}</div>
        </div>
      )}
      {cannotPost && target && (
        <div className="note warn" data-testid="post-warning">
          <div>
            <strong>Posting not available</strong>
          </div>
          <div>
            Publishing posts is {postAbility?.status} in {target.target}
            {postAbility?.detail ? `: ${postAbility.detail}` : ''}. You can still prepare drafts.
          </div>
        </div>
      )}

      {writing === null && rows.length > 0 && (
        <div className="posts-controls" data-testid="posts-controls">
          <SegmentedControl<PostStateFilter>
            label="State"
            name="posts-state"
            testIdPrefix="posts-state-"
            value={state}
            onChange={setState}
            options={POST_STATE_FILTERS.map((f) => ({ value: f.id, label: `${f.label} ${counts[f.id]}` }))}
          />
          <div className="toolbar posts-toolbar">
            <Field label="Channel">
              <select className="input" value={channelId ?? ''} onChange={(e) => setChannelId(e.target.value || null)} data-testid="posts-channel">
                <option value="">All channels</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.target}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Search">
              <input className="input" type="search" value={query} placeholder="Title or text" onChange={(e) => setQuery(e.target.value)} data-testid="posts-search" />
            </Field>
            <Field label="Sort by">
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as PostSort)} data-testid="posts-sort">
                {POST_SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      )}

      {loading && <Loading what="Loading" />}

      {!loading && noChannels && (
        <EmptyState
          fill
          art="channel"
          title="No channels yet"
          action={
            <a className="btn btn-primary" href={connectChannelHref(product.id)} data-testid="publications-connect-channel">
              Connect a channel
            </a>
          }
        >
          This product has no channels yet. Connect one on the Channels screen; posts are written for a specific channel.
        </EmptyState>
      )}

      {writing !== null && target && (
        <div className="posts-scroll">
          {writing.plannedAt && (
            <Hint data-testid="posts-planned-for">
              Planned for {shortTime(writing.plannedAt)}. It is saved as a draft with this time; nothing is sent until you approve it.
            </Hint>
          )}
          <PublicationForm
            productId={product.id}
            channelId={writing.channelId}
            platform={(channels.find((c) => c.id === writing.channelId) ?? target).platform}
            reads={(channels.find((c) => c.id === writing.channelId) ?? target).reads}
            author={{ name: authorName, target: (channels.find((c) => c.id === writing.channelId) ?? target).target }}
            plannedAt={writing.plannedAt}
            onCreated={(_created, saveNote) => {
              // The post just made is shown among all of them, wherever the filters were.
              setNote(saveNote ?? null)
              clearFilters()
              setWriting(null)
            }}
            onCancel={() => setWriting(null)}
          />
        </div>
      )}

      {writing === null && nothingYet && view === 'list' && (
        <EmptyState
          fill
          art="draft"
          title="No posts yet"
          action={
            <Button variant="primary" onClick={() => startWriting(null)} disabled={!target} data-testid="write-publication-empty">
              Write one myself
            </Button>
          }
        >
          Ask the AI for a suggestion or write one yourself. The AI proposes a topic and a draft from your approved product knowledge and the channel's rules. Every post needs your own approval; the automatic rules never publish posts.
        </EmptyState>
      )}

      {writing === null && !loading && rows.length > 0 && view === 'list' && (
        <>
          {visible.length === 0 ? (
            <EmptyState
              fill
              art="draft"
              title="No post matches"
              action={
                <Button onClick={clearFilters} data-testid="posts-clear-filters">
                  Show all posts
                </Button>
              }
            >
              Nothing fits the state, the channel and the search you chose.
            </EmptyState>
          ) : (
            <div className="posts-split">
              <PostsList rows={visible} selectedId={selectedId} onSelect={setChosen} />
              <div className="posts-detail-pane">
                {selected && (
                  <PostDetail
                    key={selected.id}
                    card={selected.kind === 'post' ? selected.cards[0] : null}
                    group={selectedGroup}
                    primaryAction={main.isOwner(selected.id)}
                    onMainAction={main.offer}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {writing === null && !loading && !noChannels && view === 'calendar' && (
        <div className="posts-scroll">
          {mixUnread > 0 && (
            <Hint data-testid="calendar-mix-unread">
              The content mix of {mixUnread === 1 ? 'one channel' : `${mixUnread} channels`} could not be read, so the faint lines for its days are missing.
            </Hint>
          )}
          <PostsCalendar
            rows={visible}
            month={month}
            onMonth={setMonth}
            today={today}
            offsetMinutes={offset}
            rhythm={rhythm}
            day={day}
            onDay={setDay}
            onOpen={openRow}
            onWrite={(date) => startWriting(plannedTimeOn(date, offsetOn(date)))}
          />
        </div>
      )}
    </Page>
  )
}
