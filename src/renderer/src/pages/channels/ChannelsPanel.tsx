import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '../../hooks'
import { useHash } from '../../use-hash'
import { channelHref, channelsNewHref, parseChannelHash } from '../../route'
import { platformOfAddress } from './add-channel'
import { Button, EmptyState, ErrorNote, Loading } from '../../ui'
import { useTabAccent } from '../products/LaunchPath'
import { useOverviewData } from '../overview/useOverviewData'
import { AddChannel } from './AddChannel'
import { ChannelPage } from './ChannelPage'
import { ChannelsList } from './ChannelsList'
import { channelRows, filterRows, neighbour, shownChannelId } from './channels-list'
import { setupStage, type SetupStage } from './setup-stage'
import { suggestionBlock } from './suggestion-block'
import './channels.css'

/** True while the key goes to a field the owner is typing in: the arrow keys then belong to the caret. */
function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  return element !== null && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

/**
 * The channels of one product (DEC-009, DEC-037, and the Channels page of 0.46.0): a list with a search box and the platforms as chips on the left,
 * and beside it either the open channel's page or the "Add a channel" flow. Posts live in Posts and accounts in Accounts: this screen is only about
 * channels. With no channel yet the flow is all there is. The address `#/channels/<id>` opens a channel, `#/channels/new` the flow.
 */
export function ChannelsPanel({ productId }: { productId: string }) {
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const channels = useQuery('channels.list', { productId }, ['channels'])
  const everyChannel = useQuery('channels.list', undefined, ['channels'])
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const platforms = useQuery('platforms.list', undefined, [])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const route = parseChannelHash(useHash())
  // How many posts wait in each channel: the Overview's numbers, the same ones the owner saw on the tiles before.
  const overview = useOverviewData(productId, 30)
  const [platformFilter, setPlatformFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const channelList = channels.data ?? []
  const accountList = accounts.data ?? []
  const platformList = platforms.data ?? []
  const allProducts = products.data ?? []
  const product = allProducts.find((p) => p.id === productId)
  const productName = (id: string | null): string => allProducts.find((p) => p.id === id)?.name ?? 'another product'
  const hasAccount = accountList.length > 0

  const waiting = useMemo(() => new Map((overview.view?.channels ?? []).map((c) => [c.channelId, c.waiting])), [overview.view])
  const rows = useMemo(() => channelRows(channelList, waiting, platformList), [channels.data, waiting, platforms.data])
  const visible = filterRows(rows, platformFilter, search)

  const loaded = channels.data !== undefined && accounts.data !== undefined && !(channels.loading && !channels.data)
  // With no channel the flow is all there is (the way into the screen's first use); a channel asked for that is not on the list says so.
  const adding = route.adding || (loaded && channelList.length === 0)
  const shownId = adding ? null : shownChannelId(visible, rows, route.channelId)
  const selected = channelList.find((c) => c.id === shownId)
  const missing = !adding && route.channelId !== null && loaded && !channels.loading && !rows.some((r) => r.id === route.channelId)

  // The stage of the setup path names the next step of a channel (Assess, Activate); the path decides whether that step is the screen's filled button.
  const stage = setupStage({ hasAccount, channelCount: channelList.length, selected })
  const filledStage: SetupStage | null = useTabAccent('channels').own ? stage : null

  const blocked = suggestionBlock({
    productId,
    approved: product ? product.activePassportVersionId !== null : null,
    engineId: settings.data?.engineId,
    engines: engines.data,
    ready: !settings.loading && !engines.loading
  })
  const engineLabel = engines.data?.find((e) => e.id === settings.data?.engineId)?.label

  // The flow starts where the link says; an account just made for it names its own platform.
  const startAccount = route.accountId !== null ? accountList.find((a) => a.id === route.accountId) : undefined
  const startPlatform = route.platform ?? (route.address ? platformOfAddress(route.address, platformList) : null) ?? startAccount?.platform ?? null

  // The arrow keys walk the list; a focused field, button or link of the page beside it keeps its own keys.
  const latest = useRef({ visible, shownId })
  latest.current = { visible, shownId }
  useEffect(() => {
    if (adding) return
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditable(event.target)) return
      const target = event.target as HTMLElement
      if (target !== document.body && !target.closest('[data-testid="channel-list"]')) return
      const next = neighbour(latest.current.visible, latest.current.shownId, event.key === 'ArrowDown' ? 1 : -1)
      if (next === null || next === latest.current.shownId) return
      event.preventDefault()
      window.location.hash = channelHref(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding])

  if (!loaded) {
    return (
      <div className="pane channels-panel" data-testid="channels-panel">
        <ErrorNote error={accounts.error ?? channels.error ?? products.error ?? platforms.error} />
        <Loading what="Loading channels" />
      </div>
    )
  }

  const flow = product ? (
    <AddChannel
      key={`${startPlatform ?? ''}|${route.accountId ?? ''}|${route.address ?? ''}`}
      product={product}
      accounts={accountList}
      channels={channelList}
      allChannels={everyChannel.data ?? []}
      platforms={platformList}
      productName={productName}
      startPlatform={startPlatform}
      startTarget={route.address}
      firstAccountId={route.accountId}
      blocked={blocked}
      engineLabel={engineLabel}
      onConnected={(channel) => (window.location.hash = channelHref(channel.id))}
      onCancel={channelList.length > 0 ? () => (window.location.hash = shownId ? channelHref(shownId) : '#/channels') : undefined}
    />
  ) : null

  return (
    <div className="pane channels-panel" data-testid="channels-panel">
      <ErrorNote error={accounts.error ?? channels.error ?? products.error ?? platforms.error ?? overview.error} />
      {channelList.length === 0 ? (
        <div className="channels-detail-pane channels-first">{flow}</div>
      ) : (
        <div className="channels-split">
          <ChannelsList rows={rows} shownId={shownId} platform={platformFilter} search={search} onSelect={(id) => (window.location.hash = channelHref(id, route.channelId === id ? route.tab : undefined))} onPlatform={setPlatformFilter} onSearch={setSearch} />
          <div className="channels-detail-pane">
            {adding && flow}
            {!adding && selected && (
              <ChannelPage
                key={selected.id}
                channel={selected}
                tab={route.tab}
                products={allProducts}
                accounts={accountList}
                platforms={platformList}
                planBlockedReason={blocked?.text ?? null}
                stage={filledStage}
                listed
                onRemoved={() => (window.location.hash = '#/channels')}
              />
            )}
            {missing && (
              <EmptyState art="channel" title="This channel is not here" action={<Button onClick={() => (window.location.hash = '#/channels')}>Show the list</Button>}>
                It may have been removed. The channels of this product are on the list.
              </EmptyState>
            )}
            {!adding && !missing && selected === undefined && (
              <EmptyState art="channel" title="No channel fits this search">
                Change the search or the platform, or add a channel.
              </EmptyState>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** "Add a channel" in the page header: a bezel (the flow's own Connect button is the filled one), off while the flow is open. */
export function AddChannelButton({ productId }: { productId: string }) {
  const channels = useQuery('channels.list', { productId }, ['channels'])
  const route = parseChannelHash(useHash())
  const none = channels.data !== undefined && channels.data.length === 0
  return (
    <Button icon="plus" onClick={() => (window.location.hash = channelsNewHref())} disabled={route.adding || none} data-testid="channel-add">
      Add a channel
    </Button>
  )
}

