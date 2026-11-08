import { useState } from 'react'
import type { ChannelSuggestion, RoleSuggestion } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { accountsNewHref } from '../../route'
import { EmptyState, ErrorNote, Loading } from '../../ui'
import { AccountsCard } from './AccountsCard'
import { ChannelDetail } from './ChannelDetail'
import { ChannelList } from './ChannelList'
import { ConnectChannel, type Prefill } from './ConnectChannel'
import { SuggestRoles } from './SuggestRoles'
import { SuggestChannels } from './SuggestChannels'
import './channels.css'

/** Channels of one product and the accounts it works with (DEC-009, DEC-015): the content of the product page's Channels tab. */
export function ChannelsPanel({ productId }: { productId: string }) {
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const channels = useQuery('channels.list', { productId }, ['channels'])
  const everyChannel = useQuery('channels.list', undefined, ['channels'])
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const platforms = useQuery('platforms.list', undefined, [])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<Prefill | null>(null)

  const channelList = channels.data ?? []
  const accountList = accounts.data ?? []
  // The accounts this product works with: those its channels use and those made for it.
  const productAccounts = accountList.filter((a) => a.productId === productId || channelList.some((c) => c.accountId === a.id))
  const platformList = platforms.data ?? []
  const allProducts = products.data ?? []
  const product = allProducts.find((p) => p.id === productId)
  const productName = (id: string | null): string => allProducts.find((p) => p.id === id)?.name ?? 'another product'
  const selected = channelList.find((c) => c.id === selectedId) ?? (channelList.length === 1 ? channelList[0] : undefined)

  const blockedReason = suggestionBlockedReason({
    approved: product ? product.activePassportVersionId !== null : null,
    engineId: settings.data?.engineId,
    engines: engines.data,
    ready: !settings.loading && !engines.loading
  })

  return (
    <div className="stack" data-testid="channels-panel">
      <ErrorNote error={accounts.error ?? channels.error ?? products.error ?? platforms.error} />
      {(accounts.loading && !accounts.data) || (channels.loading && !channels.data) ? <Loading what="Loading channels" /> : null}
      <AccountsCard accounts={productAccounts} channels={channelList} platforms={platformList} />
      <SuggestRoles productId={productId} blockedReason={blockedReason} onUse={(suggestion: RoleSuggestion) => (window.location.hash = accountsNewHref({ name: suggestion.name, voice: suggestion.voice }))} />
      <SuggestChannels
        productId={productId}
        platforms={platformList}
        blockedReason={blockedReason}
        onUse={(suggestion: ChannelSuggestion) => setPrefill({ suggestion })}
      />
      <ConnectChannel
        product={product}
        accounts={accountList}
        channels={channelList}
        allChannels={everyChannel.data ?? []}
        platforms={platformList}
        productName={productName}
        prefill={prefill}
        onConnected={(channel) => setSelectedId(channel.id)}
      />
      <div className="channels-layout">
        <aside className="channels-list">
          <ChannelList channels={channelList} products={allProducts.filter((p) => p.id === productId)} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        </aside>
        <div className="channels-detail">
          {selected ? (
            <ChannelDetail key={selected.id} channel={selected} products={allProducts} accounts={accountList} platforms={platformList} planBlockedReason={blockedReason} onRemoved={() => setSelectedId(null)} />
          ) : (
            <EmptyState title="Select a channel">Pick a channel to see its status and abilities, assess it, and set how the app behaves there.</EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}

/** Why the "with AI" buttons (channels, roles, plan) cannot be used right now, in plain words; null when it can (or while the facts are still loading). */
function suggestionBlockedReason(facts: {
  approved: boolean | null
  engineId: string | null | undefined
  engines: { id: string; ready: boolean; detail: string; label: string }[] | undefined
  ready: boolean
}): string | null {
  if (facts.approved === false) return 'Approve the product passport first so the suggestions fit it.'
  if (!facts.ready) return null
  if (!facts.engineId) return 'Choose an AI engine in Settings first.'
  const engine = facts.engines?.find((e) => e.id === facts.engineId)
  if (!engine || !engine.ready) return engine?.detail || `${engine?.label ?? 'The selected AI engine'} is not available. Check it in Settings.`
  return null
}
