// Named platforms served by the universal connector (DEC-013): the catalog, accounts and channels on them, handles, and ideas.

import { describe, expect, it } from 'vitest'
import { Connectors } from '../connector-registry'
import { FakeConnector } from '../testing/fake-connector'
import type { NormalizedTarget } from '../ports'
import { addressOnPlatform, expandHandle, hostMatches, presetFor, PLATFORM_PRESETS } from './presets'
import { listPlatforms } from './platforms'
import { connectableSuggestions } from './suggestions'
import { makeReadyWorld } from './test-helpers'

/** Stands in for the universal connector: any web address, no sign-in page of its own. */
class FakeUniversal extends FakeConnector {
  readonly label = 'Other website'
  constructor() {
    super({ id: 'universal', platform: 'web' })
  }
  override matches(input: string): boolean {
    return /^https?:\/\//i.test(input.trim())
  }
  override normalizeTarget(input: string): NormalizedTarget {
    const url = new URL(input.trim())
    return { target: `${url.hostname}${url.pathname}`.replace(/\/+$/, ''), url: url.toString() }
  }
  override loginUrl(): string {
    return ''
  }
}

const world = () => makeReadyWorld({ extra: [new FakeUniversal()] })

describe('the preset data', () => {
  it('has unique keys, https login pages and addresses on the platform\'s own domains', () => {
    expect(new Set(PLATFORM_PRESETS.map((p) => p.platform)).size).toBe(PLATFORM_PRESETS.length)
    for (const preset of PLATFORM_PRESETS) {
      expect(preset.loginUrl.startsWith('https://')).toBe(true)
      expect(preset.accepts.length).toBeGreaterThan(0)
      expect(preset.handleUrl).toContain('{handle}')
      expect(addressOnPlatform(preset, expandHandle(preset, '@brand'))).toBe(true)
    }
    for (const required of ['instagram', 'facebook', 'tiktok']) expect(presetFor(required)).toBeDefined()
  })

  it('turns a handle into an address, and leaves everything else as typed', () => {
    const instagram = presetFor('instagram')!
    expect(expandHandle(instagram, '@yourbrand')).toBe('https://www.instagram.com/yourbrand/')
    expect(expandHandle(instagram, ' @your.brand_1 ')).toBe('https://www.instagram.com/your.brand_1/')
    expect(expandHandle(instagram, 'https://www.instagram.com/x/')).toBe('https://www.instagram.com/x/')
    expect(expandHandle(instagram, '@bad handle')).toBe('@bad handle')
    expect(expandHandle(presetFor('tiktok')!, '@yourbrand')).toBe('https://www.tiktok.com/@yourbrand')
  })

  it('recognises the platform\'s domains and their sub-domains, and nothing that only looks similar', () => {
    expect(hostMatches('www.instagram.com', ['instagram.com'])).toBe(true)
    expect(hostMatches('INSTAGRAM.com', ['instagram.com'])).toBe(true)
    expect(hostMatches('notinstagram.com', ['instagram.com'])).toBe(false)
    expect(hostMatches('instagram.com.evil.test', ['instagram.com'])).toBe(false)
    expect(addressOnPlatform(presetFor('x')!, 'https://twitter.com/brand')).toBe(true)
    expect(addressOnPlatform(presetFor('x')!, 'not a url')).toBe(false)
  })
})

describe('platforms.list', () => {
  it('lists the prepared platform, then the named platforms by name, then any other website', async () => {
    const w = await world()
    const platforms = await w.call('platforms.list', undefined)
    expect(platforms.map((p) => p.label)).toEqual(['Fake', 'Facebook', 'Instagram', 'LinkedIn', 'Pinterest', 'Telegram', 'Threads', 'TikTok', 'X (Twitter)', 'YouTube', 'Other website'])
    const instagram = platforms.find((p) => p.platform === 'instagram')!
    expect(instagram).toMatchObject({ connectorId: 'universal', prepared: false, loginUrl: 'https://www.instagram.com/accounts/login/', accepts: ['image', 'video'] })
    expect(instagram.hint).toContain('@yourbrand')
    expect(platforms.find((p) => p.platform === 'fake')?.prepared).toBe(true)
  })

  it('shows no named platform when nothing can serve it', async () => {
    const w = await makeReadyWorld()
    expect((await w.call('platforms.list', undefined)).map((p) => p.platform)).toEqual(['fake'])
  })

  it('lets a prepared connector keep its own platform key', () => {
    const connectors = new Connectors()
    connectors.register(new FakeConnector({ id: 'instagram-prepared', platform: 'instagram' }))
    connectors.register(new FakeUniversal())
    const list = listPlatforms(connectors)
    expect(list.filter((p) => p.platform === 'instagram')).toHaveLength(1)
    expect(list.find((p) => p.platform === 'instagram')?.prepared).toBe(true)
  })
})

describe('accounts and channels on a named platform', () => {
  it('creates an account for a named platform and opens its sign-in page', async () => {
    const w = await world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'Brand on Instagram' })
    expect(account.platform).toBe('instagram')
    await w.call('accounts.openBrowser', { accountId: account.id })
    expect(w.t.browser.opened).toEqual([{ accountId: account.id, url: 'https://www.instagram.com/accounts/login/' }])
  })

  it('refuses a named platform that nothing serves, and an unknown one', async () => {
    const plain = await makeReadyWorld()
    expect(await plain.refusal('accounts.create', { productId: plain.productId, platform: 'instagram', label: 'x' })).toBe('invalid_input')
    const w = await world()
    expect(await w.refusal('accounts.create', { productId: w.productId, platform: 'myspace', label: 'x' })).toBe('invalid_input')
  })

  it('connects a channel by handle or by address; the channel keeps the platform and is served by the universal connector', async () => {
    const w = await world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'Brand on Instagram' })
    const byHandle = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: '@yourbrand' })
    expect(byHandle).toMatchObject({ platform: 'instagram', connectorId: 'universal', url: 'https://www.instagram.com/yourbrand/', status: 'setup', plan: null })
    const byAddress = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://www.instagram.com/other_page/' })
    expect(byAddress.platform).toBe('instagram')
    // The same page twice, however it was typed, is one channel.
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: account.id, target: '@yourbrand' })).toBe('duplicate')
  })

  it('refuses an address that is not on the platform of the account', async () => {
    const w = await world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'Brand on Instagram' })
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://www.facebook.com/groups/club' })).toBe('platform_mismatch')
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://notinstagram.com/x' })).toBe('platform_mismatch')
    // An address of a prepared platform belongs to that platform's own accounts.
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: account.id, target: 'r/astrology' })).toBe('platform_mismatch')
    expect(w.core.repos.listChannels()).toEqual([])
  })

  it('does not take a handle for an account that is not on a named platform', async () => {
    const w = await world()
    const web = await w.call('accounts.create', { productId: w.productId, platform: 'web', label: 'Some site' })
    expect(await w.refusal('channels.connect', { productId: w.productId, accountId: web.id, target: '@yourbrand' })).toBe('invalid_target')
    const ok = await w.call('channels.connect', { productId: w.productId, accountId: web.id, target: 'https://www.instagram.com/yourbrand/' })
    expect(ok.platform).toBe('web')
  })
})

describe('ideas on a named platform', () => {
  const connectors = () => {
    const registry = new Connectors()
    registry.register(new FakeConnector())
    registry.register(new FakeUniversal())
    return registry
  }

  it('keeps a handle or an address on the platform, and drops one on another domain or without a connector', () => {
    const kept = connectableSuggestions(connectors(), [
      { platform: 'instagram', target: '@yourbrand', reason: 'r' },
      { platform: 'facebook', target: 'https://www.facebook.com/groups/club', reason: 'r' },
      { platform: 'instagram', target: 'https://www.facebook.com/groups/club', reason: 'wrong platform' },
      { platform: 'tiktok', target: 'tiktok', reason: 'not an address' }
    ])
    expect(kept.map((s) => `${s.platform} ${s.target}`)).toEqual(['instagram @yourbrand', 'facebook https://www.facebook.com/groups/club'])
    const noUniversal = new Connectors()
    noUniversal.register(new FakeConnector())
    expect(connectableSuggestions(noUniversal, [{ platform: 'instagram', target: '@yourbrand', reason: 'r' }])).toEqual([])
  })
})
