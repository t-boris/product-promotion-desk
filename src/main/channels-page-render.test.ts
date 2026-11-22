// The Channels page's two panes rendered to markup (the renderer has no test runner of its own; this file is compiled with the renderer): the list
// of channels with its search and chips, and the add-a-channel flow. The components import the application's transport, which wants a window with the
// bridge of the preload script: it is stubbed before they are loaded.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { Account, Channel, PlatformInfo, Product } from '../shared/types'
import type { AddChannel as AddChannelComponent } from '../renderer/src/pages/channels/AddChannel'
import type { ChannelsList as ChannelsListComponent } from '../renderer/src/pages/channels/ChannelsList'
import { channelRows } from '../renderer/src/pages/channels/channels-list'

const platform = (key: string, over: Partial<PlatformInfo> = {}): PlatformInfo => ({ connectorId: key === 'reddit' ? 'reddit' : 'universal', platform: key, label: key === 'web' ? 'Other website' : key[0].toUpperCase() + key.slice(1), prepared: key === 'reddit', loginUrl: '', ...over })
const PLATFORMS = [platform('reddit', { canJoin: true, example: 'r/astrology' }), platform('instagram', { example: '@brand' }), platform('web')]
const product = { id: 'p1', name: 'Natal Mystic', activePassportVersionId: 'v1' } as unknown as Product
const account = (id: string, key: string, over: Partial<Account> = {}): Account => ({ id, platform: key, productId: null, label: `${key} login`, ...over }) as unknown as Account
const channel = (id: string, key: string, target: string, over: Partial<Channel> = {}): Channel => ({ id, productId: 'p1', accountId: `a-${key}`, platform: key, target, status: 'active', reads: key === 'reddit', ...over }) as unknown as Channel

const html = (node: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(node)

let ChannelsList: typeof ChannelsListComponent
let AddChannel: typeof AddChannelComponent

beforeAll(async () => {
  vi.stubGlobal('window', { ppd: { invoke: () => new Promise(() => {}), onEvent: () => () => {} }, location: { search: '', hash: '' } })
  ;({ ChannelsList } = await import('../renderer/src/pages/channels/ChannelsList'))
  ;({ AddChannel } = await import('../renderer/src/pages/channels/AddChannel'))
})

describe('the list of channels', () => {
  const channels = [channel('c1', 'reddit', 'r/astrology'), channel('c2', 'reddit', 'r/tarot', { status: 'needs_user' }), channel('c3', 'instagram', '@natalmystic')]
  const rows = channelRows(channels, new Map([['c1', 3]]), PLATFORMS)
  const list = (over: Partial<Parameters<typeof ChannelsListComponent>[0]> = {}): string =>
    html(createElement(ChannelsList, { rows, shownId: 'c1', platform: null, search: '', onSelect: () => {}, onPlatform: () => {}, onSearch: () => {}, ...over }))

  it('is a list with one row for each channel, a search box and the platforms as chips with their counts', () => {
    const markup = list()
    expect(markup).toContain('data-testid="channels-search"')
    expect(markup).toContain('role="listbox"')
    expect(markup.match(/role="option"/g)).toHaveLength(3)
    for (const text of ['All 3', 'Reddit 2', 'Instagram 1', 'Reddit · needs you', 'Instagram · your own posts']) expect(markup).toContain(text)
    expect(markup).toContain('The number is how many posts are waiting for you there.')
  })

  it('marks the shown channel, keeps one row in the Tab order, and says how many posts wait only where some do', () => {
    const markup = list()
    expect(markup).toMatch(/aria-selected="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-selected="true"/)
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1)
    expect(markup.match(/waiting for you"/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="3 waiting for you"')
  })

  it('shows only what the search and the chip leave, and says so when nothing fits', () => {
    const only = list({ platform: 'instagram' })
    expect(only.match(/role="option"/g)).toHaveLength(1)
    const none = list({ search: 'zzz' })
    expect(none).toContain('No channel fits this search.')
    expect(html(createElement(ChannelsList, { rows: [], shownId: null, platform: null, search: '', onSelect: () => {}, onPlatform: () => {}, onSearch: () => {} }))).toContain('No channels yet.')
  })

  it('offers no chips while all the channels are on one platform', () => {
    const one = channelRows([channel('c1', 'reddit', 'r/a'), channel('c2', 'reddit', 'r/b')], new Map(), PLATFORMS)
    expect(html(createElement(ChannelsList, { rows: one, shownId: 'c1', platform: null, search: '', onSelect: () => {}, onPlatform: () => {}, onSearch: () => {} }))).not.toContain('channels-chips')
  })
})

describe('the add-a-channel flow', () => {
  const flow = (over: Partial<Parameters<typeof AddChannelComponent>[0]> = {}): string =>
    html(
      createElement(AddChannel, {
        product,
        accounts: [account('a-reddit', 'reddit')],
        channels: [],
        allChannels: [],
        platforms: PLATFORMS,
        productName: () => 'Natal Mystic',
        startPlatform: null,
        firstAccountId: null,
        blocked: null,
        engineLabel: 'Codex',
        onConnected: () => {},
        onCancel: () => {},
        ...over
      })
    )

  it('starts with the platforms, each with one line on what the application does there, and the other steps waiting', () => {
    const markup = flow()
    for (const text of ['1. Where?', '2. Which account?', '3. Which address?', '4. Connect', 'Reads communities, can join them', 'Your own posts, in your account', 'Needs a site profile first']) expect(markup).toContain(text)
    expect(markup).toContain('Choose the platform first.')
    expect(markup).toContain('Choose where the channel is first.')
    expect(markup).toMatch(/data-testid="connect-submit"[^>]*disabled|disabled[^>]*data-testid="connect-submit"/)
  })

  it('chooses the only account of the platform itself and asks for a community on Reddit', () => {
    const markup = flow({ startPlatform: 'reddit' })
    expect(markup).toContain('data-testid="add-account-one"')
    expect(markup).toContain('is the only Reddit account, so it is used.')
    expect(markup).toContain('3. Which community?')
    expect(markup).toContain('Type the address of the channel.')
    expect(markup).not.toContain('data-testid="connect-account"')
  })

  it('leads to the Accounts screen for the platform when no account fits, and offers nothing to connect with', () => {
    const markup = flow({ startPlatform: 'instagram' })
    expect(markup).toContain('data-testid="add-no-account"')
    expect(markup).toContain('There is no Instagram account yet.')
    expect(markup).toContain('href="#/accounts/new?')
    expect(markup).toContain('platform=instagram')
    expect(markup).toContain('Add an account for Instagram first.')
    expect(markup).toContain('Add an account for Instagram')
  })

  it('lists the accounts of the platform when there are several, the product\'s own first', () => {
    const markup = flow({ startPlatform: 'reddit', accounts: [account('a-other', 'reddit', { label: 'second' }), account('a-reddit', 'reddit', { productId: 'p1' })] })
    expect(markup).toContain('data-testid="connect-account"')
    expect(markup).toContain('Used by this product')
    expect(markup).toContain('Other accounts of the library')
  })

  it('gives the AI ideas a place under the address, and says why they are off when they are', () => {
    expect(flow({ startPlatform: 'reddit' })).toContain('data-testid="find-with-ai"')
    const blocked = flow({ startPlatform: 'reddit', blocked: { text: 'Approve the passport first.', fix: { href: '#/setup', label: 'Open Setup' } } })
    expect(blocked).toContain('data-testid="find-blocked"')
    expect(blocked).toContain('Approve the passport first.')
  })

  it('has no Cancel while there is nothing to go back to', () => {
    expect(flow()).toContain('data-testid="add-channel-cancel"')
    expect(flow({ onCancel: undefined })).not.toContain('data-testid="add-channel-cancel"')
  })
})
