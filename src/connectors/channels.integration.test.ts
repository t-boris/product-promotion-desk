// The channels module driving the real Reddit connector against a scripted page: the whole onboarding path
// (create account, connect, assess) with no network and no real community.

import { describe, expect, it } from 'vitest'
import type { Capability, CapabilityKey } from '../shared/types'
import { newId } from '../core/db/database'
import { makeTestCore } from '../core/testing/fakes'
import { createConnectors } from './index'
import { RedditFakePage, routeHealthyReddit } from './test-helpers'

async function onboard() {
  const t = makeTestCore({ connectors: createConnectors() })
  const { core, browser } = t
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, 'Natal Mystic', now, now)
  const account = await core.router.call('accounts.create', { platform: 'reddit', label: 'Natal Mystic Reddit' })
  const page = new RedditFakePage()
  browser.pages.set(account.id, page)
  routeHealthyReddit(page)
  const channel = await core.router.call('channels.connect', { productId, accountId: account.id, target: 'https://www.reddit.com/r/test/' })
  return { t, core, page, account, channel }
}

const status = (list: Capability[], key: CapabilityKey): string | undefined => list.find((c) => c.key === key)?.status

describe('onboarding a subreddit end to end (REQ-002)', () => {
  it('connects, assesses by reading only, and never claims sending abilities', async () => {
    const { core, page, channel } = await onboard()
    expect(channel).toMatchObject({ connectorId: 'reddit', target: 'r/test', status: 'setup', mode: 'observe' })

    const assessed = await core.router.call('channels.assess', { channelId: channel.id })
    expect(page.writes).toEqual([])
    expect(status(assessed.capabilities, 'read_posts')).toBe('verified')
    expect(status(assessed.capabilities, 'read_comments')).toBe('verified')
    for (const key of ['publish_post', 'publish_reply', 'verify_send'] as const) {
      expect(status(assessed.capabilities, key)).toBe('needs_check')
    }
    expect(assessed.capabilities.every((c) => c.checkedAt !== null)).toBe(true)
  })

  it('shows the person what to do when the session is signed out, and keeps the account status in step', async () => {
    const { core, page, account, channel } = await onboard()
    page.route('/api/me.json', { message: 'Forbidden', error: 403 }, 403)
    const assessed = await core.router.call('channels.assess', { channelId: channel.id })
    expect(assessed.status).toBe('needs_user')
    expect(assessed.capabilities.every((c) => c.status === 'needs_user')).toBe(true)
    expect(assessed.statusDetail).toMatch(/not signed in to Reddit/)
    expect(core.repos.account(account.id)).toMatchObject({ status: 'login_required', identity: null })
    expect(page.writes).toEqual([])
  })

  it('maps a CAPTCHA to the account and channel', async () => {
    const { core, page, account, channel } = await onboard()
    page.gate = { captcha: true, blocked: false, title: 'Prove your humanity' }
    const assessed = await core.router.call('channels.assess', { channelId: channel.id })
    expect(assessed.status).toBe('needs_user')
    expect(core.repos.account(account.id).status).toBe('captcha')
  })

  it('confirms the signed-in identity through the login check', async () => {
    const { core, account } = await onboard()
    expect(await core.router.call('accounts.checkLogin', { accountId: account.id })).toMatchObject({ status: 'ready', identity: 'natal_bot' })
  })

  it('opens the Reddit sign-in page for the login hand-off', async () => {
    const { t, core, account } = await onboard()
    await core.router.call('accounts.openBrowser', { accountId: account.id })
    expect(t.browser.opened).toEqual([{ accountId: account.id, url: 'https://www.reddit.com/login/' }])
  })

  it('keeps universal-site accounts apart from Reddit accounts', async () => {
    const { core, channel } = await onboard()
    const web = await core.router.call('accounts.create', { platform: 'web', label: 'Forum account' })
    const product = core.repos.listProducts()[0]
    await expect(core.router.call('channels.connect', { productId: product.id, accountId: web.id, target: 'r/test' })).rejects.toMatchObject({ code: 'platform_mismatch' })
    expect(core.repos.listChannels().map((c) => c.id)).toEqual([channel.id])
  })

  it('assesses a site without a profile honestly: nothing is read, sent or claimed', async () => {
    const { core } = await onboard()
    const web = await core.router.call('accounts.create', { platform: 'web', label: 'Forum account' })
    const product = core.repos.listProducts()[0]
    const forum = await core.router.call('channels.connect', { productId: product.id, accountId: web.id, target: 'https://forum.example.com/c/general' })
    const assessed = await core.router.call('channels.assess', { channelId: forum.id })
    expect(assessed.capabilities.every((c) => c.status === 'needs_check')).toBe(true)
    expect(assessed.capabilities[0].detail).toMatch(/no site profile/i)
  })
})
