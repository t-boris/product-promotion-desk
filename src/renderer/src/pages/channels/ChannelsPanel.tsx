import { useState } from 'react'
import type { ChannelSuggestion, RoleSuggestion } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { accountsNewHref, channelsAccountOf } from '../../route'
import { Disclosure, EmptyState, ErrorNote, Loading } from '../../ui'
import { AccountsCard } from './AccountsCard'
import { ChannelDetail } from './ChannelDetail'
import { ChannelList } from './ChannelList'
import { ConnectChannel, type Prefill } from './ConnectChannel'
import { SuggestRoles } from './SuggestRoles'
import { SuggestChannels } from './SuggestChannels'
import { setupStage } from './setup-stage'
import { suggestionBlock } from './suggestion-block'
import './channels.css'

/**
 * Channels of one product and the accounts it works with (DEC-009, DEC-015): the content of the product page's Channels tab. The tab is a
 * single column (the product page already has its list beside it): the accounts line, "Connect a channel", the channel list, the picked
 * channel's group boxes and the AI ideas. Exactly one button is filled, the one of the setup stage (`setupStage`).
 */
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
  // The account just added from this tab comes back in the link and is the one "Connect a channel" starts with (BUG-063).
  const [firstAccountId] = useState(() => channelsAccountOf(window.location.hash))

  const channelList = channels.data ?? []
  const accountList = accounts.data ?? []
  // One answer to "is there an account?" for the whole tab: any account of the library can serve this product (DEC-015).
  // Until the list has loaded there is no answer, and the tab does not say "no account" (BUG-030).
  const accountsKnown = accounts.data !== undefined
  const hasAccount = accountList.length > 0
  // The accounts this product works with: those its channels use and those made for it.
  const productAccounts = accountList.filter((a) => a.productId === productId || channelList.some((c) => c.accountId === a.id))
  const platformList = platforms.data ?? []
  const allProducts = products.data ?? []
  const product = allProducts.find((p) => p.id === productId)
  const productName = (id: string | null): string => allProducts.find((p) => p.id === id)?.name ?? 'another product'
  const selected = channelList.find((c) => c.id === selectedId) ?? (channelList.length === 1 ? channelList[0] : undefined)
  const stage = setupStage({ hasAccount, channelCount: channelList.length, selected })

  const blocked = suggestionBlock({
    productId,
    approved: product ? product.activePassportVersionId !== null : null,
    engineId: settings.data?.engineId,
    engines: engines.data,
    ready: !settings.loading && !engines.loading
  })
  const blockedReason = blocked?.text ?? null
  const engineLabel = engines.data?.find((e) => e.id === settings.data?.engineId)?.label

  return (
    <div className="pane" data-testid="channels-panel">
      <ErrorNote error={accounts.error ?? channels.error ?? products.error ?? platforms.error} />
      {(accounts.loading && !accounts.data) || (channels.loading && !channels.data) ? <Loading what="Loading channels" /> : null}
      {accountsKnown && (
        <>
          <AccountsCard productId={productId} accounts={productAccounts} libraryHasAccounts={hasAccount} channels={channelList} platforms={platformList} filled={stage === 'account'} />
          <ConnectChannel
            product={product}
            needsAccount={!hasAccount}
            filled={stage === 'connect'}
            accounts={accountList}
            firstAccountId={firstAccountId}
            channels={channelList}
            allChannels={everyChannel.data ?? []}
            platforms={platformList}
            productName={productName}
            prefill={prefill}
            onConnected={(channel) => setSelectedId(channel.id)}
          />
        </>
      )}
      {channelList.length === 0 ? (
        // Without an account the strip above already says what to do; an empty "No channels yet" would only repeat it.
        hasAccount && <EmptyState art="channel" title="No channels yet">Connect your first channel above.</EmptyState>
      ) : (
        <>
          <ChannelList channels={channelList} products={allProducts.filter((p) => p.id === productId)} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          {selected ? (
            <ChannelDetail key={selected.id} channel={selected} products={allProducts} accounts={accountList} platforms={platformList} planBlockedReason={blockedReason} stage={stage} onRemoved={() => setSelectedId(null)} />
          ) : (
            <EmptyState title="Select a channel">Pick a channel to see its status and abilities, assess it, and set how the app behaves there.</EmptyState>
          )}
        </>
      )}
      {/* Ideas are optional help, so they are folded; the reason they are off stays on the summary line, in view. */}
      <Disclosure
        title="Ideas from the AI"
        testId="ai-ideas"
        aside={
          blocked ? (
            <span className="dot-line" data-testid="ai-ideas-blocked">
              <span className="dot warn" aria-hidden="true" />
              {blocked.text}
            </span>
          ) : (
            <span className="dot-line">
              <span className="dot good" aria-hidden="true" />
              Ready · {engineLabel ?? 'AI engine'}
            </span>
          )
        }
      >
        <SuggestRoles productId={productId} blocked={blocked} engineLabel={engineLabel} onUse={(suggestion: RoleSuggestion) => (window.location.hash = accountsNewHref({ name: suggestion.name, voice: suggestion.voice }, productId))} />
        <SuggestChannels productId={productId} platforms={platformList} blocked={blocked} engineLabel={engineLabel} onUse={(suggestion: ChannelSuggestion) => setPrefill({ suggestion })} />
      </Disclosure>
    </div>
  )
}
