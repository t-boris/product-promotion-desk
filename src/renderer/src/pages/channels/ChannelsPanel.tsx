import { useState } from 'react'
import type { ChannelSuggestion, RoleSuggestion } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { EmptyState, ErrorNote, Loading } from '../../ui'
import { AccountsCard } from './AccountsCard'
import { ChannelDetail } from './ChannelDetail'
import { ChannelList } from './ChannelList'
import { ConnectChannel, type Prefill } from './ConnectChannel'
import type { RolePrefill } from './CreateAccount'
import { SuggestRoles } from './SuggestRoles'
import { SuggestChannels } from './SuggestChannels'
import './channels.css'

/** Accounts and channels of one product (DEC-009): the content of the product page's Channels tab. */
export function ChannelsPanel({ productId }: { productId: string }) {
  const accounts = useQuery('accounts.list', { productId }, ['accounts'])
  const everyAccount = useQuery('accounts.list', undefined, ['accounts'])
  const channels = useQuery('channels.list', { productId }, ['channels'])
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const platforms = useQuery('platforms.list', undefined, [])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<Prefill | null>(null)
  const [rolePrefill, setRolePrefill] = useState<RolePrefill | null>(null)

  const channelList = channels.data ?? []
  const accountList = accounts.data ?? []
  const platformList = platforms.data ?? []
  const allProducts = products.data ?? []
  const product = allProducts.find((p) => p.id === productId)
  const sharedAccounts = (everyAccount.data ?? []).filter((a) => a.productId !== null && a.productId !== productId)
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
      <AccountsCard productId={productId} accounts={accountList} channels={channelList} platforms={platformList} rolePrefill={rolePrefill} />
      <SuggestRoles productId={productId} blockedReason={blockedReason} onUse={(suggestion: RoleSuggestion) => setRolePrefill({ suggestion })} />
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
        sharedAccounts={sharedAccounts}
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
            <ChannelDetail key={selected.id} channel={selected} products={allProducts} accounts={[...accountList, ...sharedAccounts]} platforms={platformList} planBlockedReason={blockedReason} onRemoved={() => setSelectedId(null)} />
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
