// DEC-028: "Open browser" where a channel is chosen or shown: the page to open, and "Use the page I'm on" (the address of the owner's page).

import { describe, expect, it } from 'vitest'
import { Connectors } from '../connector-registry'
import { FakeConnector } from '../testing/fake-connector'
import type { ChannelGuide, NormalizedTarget } from '../ports'
import { listPlatforms } from './platforms'
import { hostMatches, PLATFORM_PRESETS } from './presets'
import { publicAddress } from './urls'
import { makeReadyWorld } from './test-helpers'

const GUIDE: ChannelGuide = { browseUrl: 'https://fake.test/communities/', example: 'r/yourcommunity', hint: 'The community, not the site.' }

/** A prepared connector that says where its channels are found, and refuses what is not a community. */
class Guided extends FakeConnector {
  channelGuide(): ChannelGuide {
    return GUIDE
  }
  override normalizeTarget(input: string): NormalizedTarget {
    if (!/^(https?:\/\/fake\.test\/)?r\/\w+/.test(input)) throw new Error(`Not a community address: ${input}`)
    return super.normalizeTarget(input)
  }
}

/** Stands in for the universal connector: any web address, no sign-in page of its own, and no guide. */
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

describe('the browse pages of the platforms', () => {
  it('are https addresses on the platform\'s own domains', () => {
    for (const preset of PLATFORM_PRESETS) {
      expect(preset.browseUrl.startsWith('https://')).toBe(true)
      expect(hostMatches(new URL(preset.browseUrl).hostname, preset.hosts)).toBe(true)
    }
  })

  it('are listed with the platforms: named ones from the presets, prepared ones from the connector\'s guide', () => {
    const connectors = new Connectors()
    connectors.register(new Guided())
    connectors.register(new FakeUniversal())
    const list = listPlatforms(connectors)
    expect(list.find((p) => p.platform === 'fake')).toMatchObject({ prepared: true, browseUrl: GUIDE.browseUrl, example: GUIDE.example, hint: GUIDE.hint })
    expect(list.find((p) => p.platform === 'facebook')).toMatchObject({ browseUrl: 'https://www.facebook.com/groups/discover/' })
    expect(list.find((p) => p.platform === 'web')?.browseUrl).toBeUndefined()
  })

  it('leave a prepared connector without a guide with no browse page, example or hint', () => {
    const connectors = new Connectors()
    connectors.register(new FakeConnector())
    const info = listPlatforms(connectors).find((p) => p.platform === 'fake')
    expect(info?.browseUrl).toBeUndefined()
    expect(info?.example).toBeUndefined()
    expect(info?.hint).toBeUndefined()
  })
})

describe('accounts.browseChannels', () => {
  it('opens the platform\'s page for finding channels when no address is typed, in a window of its own that takes nothing from the AI (DEC-038)', async () => {
    const w = await makeReadyWorld({ fake: new Guided() })
    await w.call('accounts.browseChannels', { accountId: w.account.id })
    expect(w.t.browser.opened).toEqual([{ accountId: w.account.id, url: GUIDE.browseUrl }])
    expect(w.t.browser.session(w.account).control().holder).toBe('none')
  })

  it('opens the typed address when the connector reads it as a channel', async () => {
    const w = await makeReadyWorld({ fake: new Guided() })
    await w.call('accounts.browseChannels', { accountId: w.account.id, address: '  r/astrology ' })
    expect(w.t.browser.opened[0].url).toBe('https://fake.test/r/astrology')
  })

  it('opens the page for finding channels instead when the typed text is not an address of the platform', async () => {
    const w = await makeReadyWorld({ fake: new Guided() })
    await w.call('accounts.browseChannels', { accountId: w.account.id, address: 'astrology lovers' })
    expect(w.t.browser.opened[0].url).toBe(GUIDE.browseUrl)
  })

  it('says what is missing when the platform has no page of its own and nothing was typed, and opens nothing', async () => {
    const w = await makeReadyWorld({ fake: new FakeConnector() })
    expect(await w.refusal('accounts.browseChannels', { accountId: w.account.id })).toBe('no_browse_url')
    expect(await w.refusal('accounts.browseChannels', { accountId: w.account.id, address: '   ' })).toBe('no_browse_url')
    expect(w.t.browser.opened).toEqual([])
    expect(w.t.browser.session(w.account).control().holder).toBe('none')
  })

  it('opens an address of a site with no page of its own, when one is typed', async () => {
    const w = await makeReadyWorld({ fake: new FakeConnector({ id: 'plain', platform: 'plain' }), extra: [new FakeUniversal()] })
    await w.call('accounts.browseChannels', { accountId: w.account.id, address: 'https://fake.test/r/yoga' })
    expect(w.t.browser.opened[0].url).toBe('https://fake.test/r/yoga')
  })

  describe('a named platform', () => {
    const named = async (platform: string) => {
      const w = await makeReadyWorld({ extra: [new FakeUniversal()] })
      const account = await w.call('accounts.create', { productId: w.productId, platform, label: `Brand on ${platform}` })
      return { w, account }
    }

    it('opens its own browse page, a typed handle as the profile, and a typed address of the platform as it is', async () => {
      const { w, account } = await named('instagram')
      await w.call('accounts.browseChannels', { accountId: account.id })
      await w.call('accounts.browseChannels', { accountId: account.id, address: '@yourbrand' })
      await w.call('accounts.browseChannels', { accountId: account.id, address: 'https://www.instagram.com/yourbrand/reels/' })
      expect(w.t.browser.opened.map((o) => o.url)).toEqual([
        'https://www.instagram.com/explore/',
        'https://www.instagram.com/yourbrand/',
        'https://www.instagram.com/yourbrand/reels/'
      ])
    })

    it('does not take an address of another site for a channel of the platform: the platform\'s own page opens', async () => {
      const { w, account } = await named('facebook')
      await w.call('accounts.browseChannels', { accountId: account.id, address: 'https://evil.example/groups/yours' })
      expect(w.t.browser.opened[0].url).toBe('https://www.facebook.com/groups/discover/')
    })

    it('still refuses an address with a password in it, and opens nothing', async () => {
      const { w, account } = await named('facebook')
      expect(await w.refusal('accounts.browseChannels', { accountId: account.id, address: 'https://me:hunter2@www.facebook.com/groups/yours' })).toBe('invalid_input')
      expect(w.t.browser.opened).toEqual([])
    })
  })

  it('refuses an account that does not exist', async () => {
    const w = await makeReadyWorld({ fake: new Guided() })
    expect(await w.refusal('accounts.browseChannels', { accountId: 'nope' })).toBe('not_found')
  })
})

describe('accounts.currentPage ("Use the page I\'m on")', () => {
  const owner = async () => {
    const w = await makeReadyWorld({ fake: new Guided() })
    await w.call('accounts.browseChannels', { accountId: w.account.id })
    return w
  }

  it('gives the address of the page in the owner\'s window and its title, without the query or the fragment', async () => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/astrology/?utm_source=x&token=abc#comments', title: 'Astrology' })
    expect(await w.call('accounts.currentPage', { accountId: w.account.id })).toEqual({ url: 'https://fake.test/r/astrology/', title: 'Astrology', trimmed: true })
  })

  it('says when nothing was cut, and when something was (the screen then asks the owner to check)', async () => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/astrology/', title: '' })
    expect((await w.call('accounts.currentPage', { accountId: w.account.id }))?.trimmed).toBe(false)
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/astrology/#top', title: '' })
    expect((await w.call('accounts.currentPage', { accountId: w.account.id }))?.trimmed).toBe(true)
  })

  it('drops path parameters that can carry a session', async () => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/a;jsessionid=ABC123', title: '' })
    expect((await w.call('accounts.currentPage', { accountId: w.account.id }))?.url).toBe('https://fake.test/r/a')
  })

  it('refuses to guess when the browser has several tabs open', async () => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/a', title: 'A', tabs: 2 })
    expect(await w.refusal('accounts.currentPage', { accountId: w.account.id })).toBe('several_tabs')
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/a', title: 'A', tabs: 1 })
    expect(await w.call('accounts.currentPage', { accountId: w.account.id })).not.toBeNull()
  })

  it('drops credentials before the host', async () => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://me:hunter2@fake.test/r/a?x=1', title: '' })
    expect((await w.call('accounts.currentPage', { accountId: w.account.id }))?.url).toBe('https://fake.test/r/a')
  })

  it.each(['about:blank', 'file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'not an address', ''])('says it is not a web page, and gives nothing, for %j', async (url) => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url, title: 'x' })
    expect(await w.refusal('accounts.currentPage', { accountId: w.account.id })).toBe('not_a_page')
  })

  it('says nothing while the owner has no window open, even when the browser has a page', async () => {
    const w = await makeReadyWorld({ fake: new Guided() })
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/a', title: 'A' })
    expect(await w.call('accounts.currentPage', { accountId: w.account.id })).toBeNull()
  })

  it('says nothing again once the window is closed', async () => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/a', title: 'A' })
    w.t.browser.closeUserWindow(w.account)
    expect(await w.call('accounts.currentPage', { accountId: w.account.id })).toBeNull()
  })

  it('keeps the title short and writes only the host, not the address, to the log', async () => {
    const w = await owner()
    w.t.browser.ownerPages.set(w.account.id, { url: 'https://fake.test/r/secret-community?token=abc', title: 'T'.repeat(500) })
    const page = await w.call('accounts.currentPage', { accountId: w.account.id })
    expect(page?.title).toHaveLength(200)
    const lines = w.core.log.list(50).map((e) => e.message)
    expect(lines.some((line) => line.includes('fake.test'))).toBe(true)
    expect(lines.join('\n')).not.toContain('token=abc')
    expect(lines.join('\n')).not.toContain('secret-community')
  })

  it('says it could not read the page when the browser fails to answer, and writes down the failure without what it said', async () => {
    const w = await owner()
    w.t.browser.ownerPage = async () => {
      throw new Error('could not reach https://fake.test/r/secret?token=abc')
    }
    expect(await w.refusal('accounts.currentPage', { accountId: w.account.id })).toBe('read_failed')
    const lines = w.core.log.list(50)
    expect(lines.some((e) => e.level === 'warn' && /could not be read/.test(e.message))).toBe(true)
    expect(lines.map((e) => e.message).join('\n')).not.toContain('token=abc')
  })
})

describe('publicAddress', () => {
  it('keeps the scheme, host, port and path only', () => {
    expect(publicAddress('http://localhost:3000/a/b?q=1#x')).toBe('http://localhost:3000/a/b')
    expect(publicAddress('https://example.com')).toBe('https://example.com/')
    expect(publicAddress('https://example.com/a;jsessionid=X/b')).toBe('https://example.com/a/b')
  })
})
