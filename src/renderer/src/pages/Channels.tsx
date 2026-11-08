import { useState } from 'react'
import { useQuery } from '../hooks'
import { EmptyState, ErrorNote, Loading, Page } from '../ui'
import { AccountsCard } from './channels/AccountsCard'
import { ChannelDetail } from './channels/ChannelDetail'
import { ChannelList } from './channels/ChannelList'
import { ConnectChannel } from './channels/ConnectChannel'
import './channels/channels.css'

export function ChannelsPage() {
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const channels = useQuery('channels.list', undefined, ['channels'])
  const products = useQuery('products.list', undefined, ['products'])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const channelList = channels.data ?? []
  const accountList = accounts.data ?? []
  const productList = products.data ?? []
  // A channel removed here or elsewhere is no longer selected; with one channel, show it.
  const selected = channelList.find((c) => c.id === selectedId) ?? (channelList.length === 1 ? channelList[0] : undefined)

  return (
    <Page title="Channels" subtitle="Accounts, what each account can do in a channel, and how the app behaves there">
      <ErrorNote error={accounts.error ?? channels.error ?? products.error} />
      {(accounts.loading && !accounts.data) || (channels.loading && !channels.data) ? <Loading what="Loading channels" /> : null}
      <AccountsCard accounts={accountList} channels={channelList} />
      <ConnectChannel products={productList} accounts={accountList} onConnected={(channel) => setSelectedId(channel.id)} />
      <div className="channels-layout">
        <aside className="channels-list">
          <ChannelList channels={channelList} products={productList} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        </aside>
        <div className="channels-detail">
          {selected ? (
            <ChannelDetail key={selected.id} channel={selected} products={productList} accounts={accountList} onRemoved={() => setSelectedId(null)} />
          ) : (
            <EmptyState title="Select a channel">Pick a channel to see its status and abilities, assess it, and set how the app behaves there.</EmptyState>
          )}
        </div>
      </div>
    </Page>
  )
}
