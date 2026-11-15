import { useEffect, useRef, useState } from 'react'
import type { Id, OpportunityCard } from '../../../shared/types'
import { useAutomation, useQuery } from '../hooks'
import { useCurrentProduct } from '../product-context'
import { FEED_HREF } from '../route'
import { EmptyState, ErrorNote, Loading, OpenFormsScope, Page, SegmentedControl } from '../ui'
import { fixItemsFor, displayOrder, effectiveSelection, groupOf, inboxSections, moveSelection, needsDecision, newestFirst, rememberSeen, selectionAfterAction, selectionAfterDismiss, waitingElsewhere, type Seen } from './inbox/inbox-groups'
import { FixList } from './inbox/FixList'
import { GettingStarted } from './inbox/GettingStarted'
import { InboxDetail } from './inbox/InboxDetail'
import { InboxList } from './inbox/InboxList'
import { useInboxCards } from './inbox/useInboxCards'
import { useLaunchCounts } from './products/LaunchPath'
import { productLabels } from './products/product-labels'
import './inbox/inbox.css'

type Segment = 'decide' | 'fix'

const NOTHING = 'New comments, drafts to approve and connection problems appear here.'

/** True while the key goes to a field the owner is typing in: the arrow keys then belong to the caret. */
function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element !== null && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

/**
 * Everything that waits for the owner, for the current product (DEC-037), in two segments. Decide: the replies, posts, questions of the
 * AI and results to confirm, as a list with the selected item in full beside it and its buttons pinned under it. Fix: the connection and
 * account problems, each with the link that fixes it. The screen's one filled button is the action bar's.
 */
export function InboxPage() {
  return (
    // One scope for the page: "Also post to…" opened on an item owns the filled button while it is open.
    <OpenFormsScope>
      <InboxScreen />
    </OpenFormsScope>
  )
}

function InboxScreen() {
  const { current, products, loading: productsLoading, error: productsError, setCurrent } = useCurrentProduct()
  const attention = useQuery('attention.list', undefined, ['attention', 'opportunities', 'channels', 'accounts'])
  const channels = useQuery('channels.list', undefined, ['channels'])
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const { state: automation, setPaused } = useAutomation()
  const { countsOf, loaded: countsLoaded } = useLaunchCounts()
  const [chosenSegment, setSegment] = useState<Segment | null>(null)
  const [chosenRow, setChosenRow] = useState<Id | null>(null)
  // Everything that appeared stays until dismissed, in the order and the group it first appeared in.
  const [seen, setSeen] = useState<Seen[]>([])

  const items = attention.data ?? []
  const waitingIds = newestFirst(items.filter((item) => item.refType === 'opportunity'))
  const { cards, error: cardsError, loaded: cardsLoaded } = useInboxCards([...new Set([...seen.map((row) => row.id), ...waitingIds])])

  // What waits now, in the group it belongs to by the card as it is now; a card that has not loaded is not listed yet.
  const waitingNow: Seen[] = waitingIds.flatMap((id) => {
    const card = cards.get(id)
    return card && needsDecision(card.opportunity.state) ? [{ id, group: groupOf(card) }] : []
  })
  const remembered = rememberSeen(seen, waitingNow)
  useEffect(() => {
    if (remembered.length !== seen.length) setSeen(remembered)
  }, [remembered.length, seen.length])

  // This product's rows. An item of another product is not this screen's; the line below the list says it waits.
  const rows = current ? remembered.filter((row) => cards.get(row.id)?.opportunity.productId === current.id) : []
  const sections = inboxSections(rows)
  const order = displayOrder(sections)
  const selectedId = effectiveSelection(order, chosenRow)
  const selected = selectedId ? cards.get(selectedId) : undefined
  const waiting = new Set(order.filter((id) => needsDecision(cards.get(id)?.opportunity.state ?? 'cancelled')))
  const elsewhere = current ? waitingElsewhere([...cards.values()].filter((card) => needsDecision(card.opportunity.state)), current.id) : []
  const names = productLabels(products)

  const problems = fixItemsFor(items, current?.id ?? '', { channels: channels.data ?? [], accounts: accounts.data ?? [] })
  // With nothing to decide and something to fix, the problem is not left behind a tab that looks empty.
  const segment: Segment = chosenSegment ?? (rows.length === 0 && cardsLoaded && problems.length > 0 ? 'fix' : 'decide')

  // The list as the latest render has it, for the handlers that outlive a render: the keys, and the end of an action that takes a while.
  const latest = useRef({ order, selectedId, waiting })
  latest.current = { order, selectedId, waiting }
  // The arrow keys walk the list and Cmd+Enter presses the filled button, while the Decide segment is shown.
  useEffect(() => {
    if (segment !== 'decide') return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        const primary = document.querySelector<HTMLButtonElement>('[data-testid="inbox-primary"]')
        if (primary && !primary.disabled) {
          event.preventDefault()
          primary.click()
        }
        return
      }
      if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditable(event.target)) return
      // Only from the list, or with nothing focused: a focused button or link of the detail keeps its own keys.
      const target = event.target as HTMLElement
      if (target !== document.body && !target.closest('[data-testid="inbox-list"]')) return
      const next = moveSelection(latest.current.order, latest.current.selectedId, event.key === 'ArrowDown' ? 1 : -1)
      if (next === null) return
      event.preventDefault()
      setChosenRow(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [segment])

  const onDone = (card: OpportunityCard): void => {
    // The item is dealt with: the next one that waits is shown. An approved item that is still to be sent stays.
    if (!needsDecision(card.opportunity.state)) setChosenRow(selectionAfterAction(latest.current.order, card.opportunity.id, latest.current.waiting))
  }
  const dismiss = (id: Id): void => {
    setChosenRow(selectionAfterDismiss(latest.current.order, id))
    setSeen((previous) => previous.filter((row) => row.id !== id))
  }

  const loading = productsLoading || (attention.loading && !attention.data) || !countsLoaded || (waitingIds.length > 0 && !cardsLoaded)
  const noChannel = current === null || countsOf(current.id).channels === 0
  const error = productsError ?? attention.error ?? cardsError

  return (
    <Page
      title="Inbox"
      subtitle={current ? `${current.name} · Comments, drafts, questions and connection problems that need you` : 'Comments, drafts, questions and connection problems that need you'}
      fill
      actions={
        <SegmentedControl
          label="Inbox"
          name="inbox-segment"
          testIdPrefix="inbox-segment-"
          value={segment}
          onChange={setSegment}
          options={[
            { value: 'decide', label: rows.length > 0 ? `Decide (${waiting.size})` : 'Decide' },
            { value: 'fix', label: problems.length > 0 ? `Fix (${problems.length})` : 'Fix' }
          ]}
        />
      }
    >
      <ErrorNote error={error} />
      {loading && <Loading what="Loading" />}

      {!loading && segment === 'decide' && (
        <>
          {elsewhere.length > 0 && (
            <p className="inbox-elsewhere" data-testid="inbox-elsewhere">
              Waiting in other products:{' '}
              {elsewhere.map((entry, at) => (
                <span key={entry.productId}>
                  {at > 0 && ', '}
                  <button type="button" className="link-btn" onClick={() => setCurrent(entry.productId)} data-testid={`inbox-elsewhere-${entry.productId}`}>
                    {names.get(entry.productId) ?? 'Another product'} ({entry.count})
                  </button>
                </span>
              ))}
            </p>
          )}
          {order.length > 0 ? (
            <div className="inbox-split">
              <InboxList sections={sections} cards={cards} waiting={waiting} selectedId={selectedId} onSelect={setChosenRow} />
              <div className="inbox-detail-pane">
                {selected && <InboxDetail key={selected.opportunity.id} card={selected} onDone={onDone} onDismiss={() => dismiss(selected.opportunity.id)} />}
              </div>
            </div>
          ) : noChannel ? (
            <div className="inbox-scroll">
              <GettingStarted
                product={current}
                products={products}
                accounts={accounts.data?.length ?? 0}
                paused={automation?.paused}
                counts={current ? countsOf(current.id) : { channels: 0, approvedPublications: 0, draftPublications: 0 }}
                onResume={() => void setPaused(false)}
              />
            </div>
          ) : (
            <div className="gs" data-testid="attention-empty">
              <EmptyState
                fill
                art="inbox"
                title="Nothing needs you right now"
                action={
                  <a className="btn" href={FEED_HREF} data-testid="attention-next-opportunities">
                    Open Feed
                  </a>
                }
              >
                {NOTHING}
              </EmptyState>
            </div>
          )}
        </>
      )}

      {!loading && segment === 'fix' && (
        <div className="inbox-scroll">
          <FixList items={problems} channels={channels.data ?? []} products={products} />
        </div>
      )}
    </Page>
  )
}
