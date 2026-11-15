import { useState } from 'react'
import type { ChannelSuggestion, RoleSuggestion } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { useHash } from '../../use-hash'
import { accountsNewHref, channelHref, channelsAccountOf, parseChannelHash } from '../../route'
import { Disclosure, EmptyState, ErrorNote, Loading, useMainVariant } from '../../ui'
import { useTabAccent } from '../products/LaunchPath'
import { AccountsCard } from './AccountsCard'
import { ChannelPage } from './ChannelPage'
import { ChannelTiles } from '../overview/ChannelTiles'
import { useOverviewData } from '../overview/useOverviewData'
import { ConnectChannel, type Prefill } from './ConnectChannel'
import { SuggestRoles } from './SuggestRoles'
import { SuggestChannels } from './SuggestChannels'
import { setupStage, type SetupStage } from './setup-stage'
import { suggestionBlock } from './suggestion-block'
import './channels.css'

/**
 * Channels of one product and the accounts it works with (DEC-009, DEC-015): the content of the Channels screen of the current product. It is a
 * single column: the accounts line, "Connect a channel", the channel list, the picked
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
  // The channel page asked for by the address (`#/channels/<id>/<tab>`); without one this is the list of channels.
  const route = parseChannelHash(useHash())
  const tiles = useOverviewData(productId, 30)
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
  const selected = channelList.find((c) => c.id === route.channelId)
  // On the list the only channel stands for "the one the owner works with", so the stage still says what to do next with it.
  const stage = setupStage({ hasAccount, channelCount: channelList.length, selected: selected ?? (route.channelId === null && channelList.length === 1 ? channelList[0] : undefined) })
  // The stage of this tab names its own next step, but the path decides whether that step is the screen's filled button: only while the Channel
  // stage is the path's next one. A connected channel ends it, so "Assess channel" and "Activate" are bezels and the next stage is filled (BUG-065).
  const filledStage: SetupStage | null = useTabAccent('channels').own ? stage : null
  const main = useMainVariant()

  const blocked = suggestionBlock({
    productId,
    approved: product ? product.activePassportVersionId !== null : null,
    engineId: settings.data?.engineId,
    engines: engines.data,
    ready: !settings.loading && !engines.loading
  })
  const blockedReason = blocked?.text ?? null
  const engineLabel = engines.data?.find((e) => e.id === settings.data?.engineId)?.label

  const loadingList = (accounts.loading && !accounts.data) || (channels.loading && !channels.data)
  // A channel page for a channel that is not there (it was removed, or the link is old) says so and goes back to the list.
  // It is said only once the list is not being reloaded: a channel that was just connected is in the next answer, not yet in this one.
  const missing = route.channelId !== null && channels.data !== undefined && !channels.loading && selected === undefined

  return (
    <div className="pane" data-testid="channels-panel">
      <ErrorNote error={accounts.error ?? channels.error ?? products.error ?? platforms.error} />
      {loadingList ? <Loading what="Loading channels" /> : null}
      {selected && (
        <ChannelPage
          key={selected.id}
          channel={selected}
          tab={route.tab}
          products={allProducts}
          accounts={accountList}
          platforms={platformList}
          planBlockedReason={blockedReason}
          stage={filledStage}
          onRemoved={() => (window.location.hash = '#/channels')}
        />
      )}
      {missing && (
        <EmptyState
          art="channel"
          title="This channel is not here"
          action={
            <a className="btn" href="#/channels" data-testid="channels-back">
              All channels
            </a>
          }
        >
          It may have been removed. The channels of this product are on the list.
        </EmptyState>
      )}
      {/* The channels come first once there are some: they are what the screen is about; the accounts and the connect form are what is added to them. */}
      {route.channelId === null && channelList.length > 0 && (
        <>
          <ErrorNote error={tiles.error} />
          {tiles.view ? <ChannelTiles channels={tiles.view.channels} lines={tiles.lines} days={tiles.view.days} /> : tiles.error ? null : <Loading what="Loading channels" />}
          {/* With one channel that is still to be assessed or started, its page is the next step: the link is the screen's filled button. */}
          {filledStage && (filledStage === 'assess' || filledStage === 'activate') && channelList.length === 1 && (
            <div className="row">
              <a className={`btn btn-${main}`} href={channelHref(channelList[0].id)} data-testid="open-only-channel">
                {filledStage === 'assess' ? 'Assess this channel' : 'Activate this channel'}
              </a>
            </div>
          )}
        </>
      )}
      {route.channelId === null && accountsKnown && (
        <>
          <AccountsCard productId={productId} accounts={productAccounts} libraryHasAccounts={hasAccount} channels={channelList} platforms={platformList} filled={filledStage === 'account'} />
          <ConnectChannel
            product={product}
            needsAccount={!hasAccount}
            filled={filledStage === 'connect'}
            accounts={accountList}
            firstAccountId={firstAccountId}
            channels={channelList}
            allChannels={everyChannel.data ?? []}
            platforms={platformList}
            productName={productName}
            prefill={prefill}
            onConnected={(channel) => (window.location.hash = channelHref(channel.id))}
          />
        </>
      )}
      {route.channelId === null && channelList.length === 0 && hasAccount && (
        // Without an account the strip above already says what to do; an empty "No channels yet" would only repeat it.
        <EmptyState art="channel" title="No channels yet">
          Connect your first channel above.
        </EmptyState>
      )}
      {/* Ideas are optional help, so they are folded; the reason they are off stays on the summary line, in view. */}
      {route.channelId === null && (
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
          <SuggestChannels productId={productId} accounts={[...productAccounts, ...accountList.filter((a) => !productAccounts.includes(a))]} platforms={platformList} blocked={blocked} engineLabel={engineLabel} onUse={(suggestion: ChannelSuggestion) => setPrefill({ suggestion })} />
        </Disclosure>
      )}
    </div>
  )
}
