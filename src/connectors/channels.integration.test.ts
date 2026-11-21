// The channels module driving the real Reddit connector against a scripted page: the whole onboarding path
// (create account, connect, assess) with no network and no real community.

import { describe, expect, it } from 'vitest'
import type { Capability, CapabilityKey } from '../shared/types'
import { newId } from '../core/db/database'
import { FakePage, makeTestCore } from '../core/testing/fakes'
import { createConnectors } from './index'
import { validProfileDefinition } from './universal/test-helpers'
import { RedditFakePage, routeHealthyReddit } from './test-helpers'

async function onboard() {
  const t = makeTestCore({ connectors: createConnectors() })
  const { core, browser } = t
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, 'Natal Mystic', now, now)
  const account = await core.router.call('accounts.create', { productId, platform: 'reddit', label: 'Natal Mystic Reddit' })
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
    // A connector that has no opinion on reading (Reddit) reads, as it always did (DEC-034).
    expect(channel).toMatchObject({ connectorId: 'reddit', target: 'r/test', status: 'setup', mode: 'observe', reads: true })

    const assessed = await core.router.call('channels.assess', { channelId: channel.id })
    expect(assessed.reads).toBe(true)
    expect(page.writes).toEqual([])
    expect(status(assessed.capabilities, 'read_posts')).toBe('verified')
    expect(status(assessed.capabilities, 'read_comments')).toBe('verified')
    for (const key of ['publish_post', 'publish_reply', 'verify_send'] as const) {
      expect(status(assessed.capabilities, key)).toBe('needs_check')
    }
    expect(assessed.capabilities.every((c) => c.checkedAt !== null)).toBe(true)
  })

  it('a community whose post list Reddit refuses is watched in the browser instead: it activates, and reads through Reddit again once the list answers (DEC-045)', async () => {
    const { core, page, account, channel } = await onboard()
    page.route('/r/test/new.json', '<html>blocked</html>', 403)
    core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(account.id)

    const refused = await core.router.call('channels.assess', { channelId: channel.id })
    expect(status(refused.capabilities, 'read_posts')).toBe('unavailable')
    expect(refused).toMatchObject({ reads: false, watchedInBrowser: true })

    // Before: "Comments cannot be read on this channel ... so it cannot be monitored". Now it goes live and the AI looks at it.
    const active = await core.router.call('channels.activate', { channelId: channel.id })
    expect(active).toMatchObject({ status: 'active', statusDetail: '', reads: false, watchedInBrowser: true })
    expect(active.nextCheckAt).not.toBeNull()

    routeHealthyReddit(page)
    const healed = await core.router.call('channels.assess', { channelId: channel.id })
    expect(healed).toMatchObject({ reads: true, watchedInBrowser: false })
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
    const product = core.repos.listProducts()[0]
    const web = await core.router.call('accounts.create', { productId: product.id, platform: 'web', label: 'Forum account' })
    await expect(core.router.call('channels.connect', { productId: product.id, accountId: web.id, target: 'r/test' })).rejects.toMatchObject({ code: 'platform_mismatch' })
    expect(core.repos.listChannels().map((c) => c.id)).toEqual([channel.id])
  })

  it('assesses a site without a profile honestly: nothing is read, sent or claimed', async () => {
    const { core } = await onboard()
    const product = core.repos.listProducts()[0]
    const web = await core.router.call('accounts.create', { productId: product.id, platform: 'web', label: 'Forum account' })
    const forum = await core.router.call('channels.connect', { productId: product.id, accountId: web.id, target: 'https://forum.example.com/c/general' })
    const assessed = await core.router.call('channels.assess', { channelId: forum.id })
    expect(assessed.capabilities.some((c) => c.status === 'verified')).toBe(false)
    expect(status(assessed.capabilities, 'read_comments')).toBe('unavailable')
    expect(status(assessed.capabilities, 'publish_post')).toBe('needs_check')
    expect(assessed.capabilities.find((c) => c.key === 'read_posts')?.detail).toMatch(/no site profile/i)
    expect(assessed.reads).toBe(false)
  })

  it('serves a named platform (Instagram) by the universal connector and assesses it just as honestly (DEC-013)', async () => {
    const { core } = await onboard()
    const product = core.repos.listProducts()[0]
    const instagram = await core.router.call('accounts.create', { productId: product.id, platform: 'instagram', label: 'Brand on Instagram' })
    const channel = await core.router.call('channels.connect', { productId: product.id, accountId: instagram.id, target: '@natalmystic' })
    // The channel is called by its handle, the way its owner says it, and it is known from the start that the app does not read it (DEC-034).
    expect(channel).toMatchObject({ platform: 'instagram', connectorId: 'universal', target: '@natalmystic', url: 'https://www.instagram.com/natalmystic/', reads: false })
    const assessed = await core.router.call('channels.assess', { channelId: channel.id })
    // Nothing is claimed for a platform whose site profile does not exist yet.
    expect(assessed.capabilities.some((c) => c.status === 'verified')).toBe(false)
    expect(status(assessed.capabilities, 'read_comments')).toBe('unavailable')
    expect(status(assessed.capabilities, 'publish_post')).toBe('needs_check')
    expect(assessed.capabilities.find((c) => c.key === 'read_posts')?.detail).toMatch(/no site profile/i)
  })

  it('an assessment brings a channel the app does not read back to work after the account needed the owner, without a first read (DEC-034)', async () => {
    const { core } = await onboard()
    const product = core.repos.listProducts()[0]
    const instagram = await core.router.call('accounts.create', { productId: product.id, platform: 'instagram', label: 'Brand on Instagram' })
    const channel = await core.router.call('channels.connect', { productId: product.id, accountId: instagram.id, target: '@natalmystic' })
    core.db.prepare("UPDATE channels SET status = 'needs_user', status_detail = 'Account needs you' WHERE id = ?").run(channel.id)
    const assessed = await core.router.call('channels.assess', { channelId: channel.id })
    // Instagram is looked at in the account's browser (DEC-042): it is back to work with nothing to say about itself, and still has no first read.
    expect(assessed).toMatchObject({ status: 'active', statusDetail: '', baselineDoneAt: null, reads: false, watchedInBrowser: true })
  })

  it('an assessment tells a channel again whether the app reads it (DEC-034)', async () => {
    const { core } = await onboard()
    const product = core.repos.listProducts()[0]
    const instagram = await core.router.call('accounts.create', { productId: product.id, platform: 'instagram', label: 'Brand on Instagram' })
    const channel = await core.router.call('channels.connect', { productId: product.id, accountId: instagram.id, target: '@natalmystic' })
    expect(channel.reads).toBe(false)
    core.db.prepare('UPDATE channels SET reads = 1 WHERE id = ?').run(channel.id) // as an older channel is stored
    expect(core.repos.channel(channel.id).reads).toBe(true)
    expect((await core.router.call('channels.assess', { channelId: channel.id })).reads).toBe(false)
  })

  it('refuses a page twice even when the older channel is still named by its address (DEC-034)', async () => {
    const { core } = await onboard()
    const product = core.repos.listProducts()[0]
    const instagram = await core.router.call('accounts.create', { productId: product.id, platform: 'instagram', label: 'Brand on Instagram' })
    const first = await core.router.call('channels.connect', { productId: product.id, accountId: instagram.id, target: '@natalmystic' })
    core.db.prepare("UPDATE channels SET target = 'www.instagram.com/natalmystic' WHERE id = ?").run(first.id) // as it was named before handles
    await expect(core.router.call('channels.connect', { productId: product.id, accountId: instagram.id, target: 'https://www.instagram.com/natalmystic/' })).rejects.toMatchObject({ code: 'duplicate' })
  })

  it('names a pasted Instagram address by its handle and refuses the same page twice (DEC-034)', async () => {
    const { core } = await onboard()
    const product = core.repos.listProducts()[0]
    const instagram = await core.router.call('accounts.create', { productId: product.id, platform: 'instagram', label: 'Brand on Instagram' })
    const pasted = await core.router.call('channels.connect', { productId: product.id, accountId: instagram.id, target: 'www.instagram.com/boris_chart_notebook' })
    expect(pasted).toMatchObject({ target: '@boris_chart_notebook', url: 'https://www.instagram.com/boris_chart_notebook' })
    await expect(core.router.call('channels.connect', { productId: product.id, accountId: instagram.id, target: '@boris_chart_notebook' })).rejects.toMatchObject({ code: 'duplicate' })
  })
})

// ───────────────────────────── DEC-009: platforms and site profiles with the real connectors ─────────────────────────────

describe('platforms and site profiles (DEC-009)', () => {
  const FORUM = 'https://forum.example.com/'

  async function forumWorld() {
    const t = makeTestCore({ connectors: createConnectors() })
    const { core } = t
    const productId = newId()
    const now = core.clock.now().toISOString()
    core.db.prepare('INSERT INTO products (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(productId, 'Natal Mystic', now, now)
    const account = await core.router.call('accounts.create', { productId, platform: 'web', label: 'Forum login' })
    const page = new FakePage()
    // The outline script, then the counts of the draft's selectors (li.topic is what the example profile uses for discussions).
    page.responses = [
      { match: 'const MAX', value: { title: 'Example forum', outline: 'body\n  ul.topics\n    li.topic', links: [] } },
      { match: '"selector":"li.topic"', value: 4 }
    ]
    t.browser.pages.set(account.id, page)
    return { t, core, productId, account, page }
  }

  it('lists the platforms the connectors offer: Reddit is prepared, any other site needs its own profile', async () => {
    const { core } = await forumWorld()
    const platforms = await core.router.call('platforms.list', undefined)
    // Reddit says where its communities are found, what an address looks like, and what is refused (DEC-028).
    expect(platforms[0]).toEqual({
      connectorId: 'reddit',
      platform: 'reddit',
      label: 'Reddit',
      prepared: true,
      loginUrl: 'https://www.reddit.com/login/',
      signupUrl: 'https://www.reddit.com/register/',
      canJoin: true,
      browseUrl: 'https://www.reddit.com/subreddits/',
      example: 'r/yourcommunity',
      hint: expect.stringContaining('r/all')
    })
    expect(platforms.at(-1)).toEqual({ connectorId: 'universal', platform: 'web', label: 'Other website', prepared: false, loginUrl: '' })
    // Between them: the named platforms the universal connector serves (DEC-013), each needing its own site profile.
    expect(platforms.slice(1, -1).map((p) => p.platform)).toEqual(['facebook', 'instagram', 'linkedin', 'pinterest', 'telegram', 'threads', 'tiktok', 'x', 'youtube'])
    expect(platforms.slice(1, -1).every((p) => !p.prepared && p.connectorId === 'universal')).toBe(true)
  })

  it('saves a valid profile as a version and refuses one that contains anything beyond the schema', async () => {
    const { core } = await forumWorld()
    expect(await core.router.call('channels.saveProfile', { host: 'forum.example.com', definition: validProfileDefinition() })).toMatchObject({ host: 'forum.example.com', version: 1, valid: true, errors: [] })
    const error = await core.router.call('channels.saveProfile', { host: 'forum.example.com', definition: validProfileDefinition({ onclick: 'steal()' }) }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'profile_invalid' })
    expect((error as Error).message).toMatch(/onclick/)
    expect(await core.router.call('channels.saveProfile', { host: 'forum.example.com', definition: { not: 'a profile' } }).catch((e: { code: string }) => e.code)).toBe('profile_invalid')
    expect(await core.router.call('channels.saveProfile', { host: 'other.example.org', definition: validProfileDefinition() }).catch((e: { code: string }) => e.code)).toBe('invalid_input')
  })

  it('prepares a draft by reading only, shows what it says, and saves it only when asked; capabilities stay unverified', async () => {
    const { t, core, productId, account, page } = await forumWorld()
    t.engine.on('channels.site_profile', JSON.stringify(validProfileDefinition()))

    const draft = await core.router.call('channels.draftProfile', { productId, accountId: account.id, url: FORUM })

    expect(draft).toMatchObject({ host: 'forum.example.com', valid: true, problems: [], instructions: [] })
    expect(draft.summary.join('\n')).toMatch(/Channel pages: https:\/\/forum\.example\.com\/c\/\*/)
    expect(draft.summary.join('\n')).toMatch(/Can publish a new post in 6 steps/)
    expect(draft.summary).toContain('Found 4 discussions on the page that was read.')
    expect(page.log.filter((entry) => /^(fill|click|upload)\b/.test(entry))).toEqual([])
    expect(core.repos.listChannels()).toEqual([])
    expect(await core.router.call('channels.saveProfile', { host: 'forum.example.com', definition: draft.definition })).toMatchObject({ version: 1, valid: true })

    const forum = await core.router.call('channels.connect', { productId, accountId: account.id, target: 'https://forum.example.com/c/general' })
    expect(forum).toMatchObject({ connectorId: 'universal', platform: 'web' })
    expect(forum.capabilities.every((c) => c.status === 'needs_check')).toBe(true)
  })

  it('does not accept a draft that is not in the profile format: the problems and steps are shown instead', async () => {
    const { t, core, productId, account } = await forumWorld()
    const dangerous = validProfileDefinition({ onload: 'fetch("https://evil.example")' })
    t.engine.on('channels.site_profile', JSON.stringify(dangerous))
    t.engine.on('channels.site_profile.repair', JSON.stringify(dangerous))
    const draft = await core.router.call('channels.draftProfile', { productId, accountId: account.id, url: FORUM })
    expect(draft.valid).toBe(false)
    expect(draft.problems.join(' ')).toMatch(/onload/)
    expect(draft.summary).toEqual([])
    expect(draft.instructions.length).toBeGreaterThan(0)
  })

  it('does not even open the site for an engine that is not tool-free', async () => {
    const { t, core, productId, account, page } = await forumWorld()
    t.engine.toolFree = false
    const draft = await core.router.call('channels.draftProfile', { productId, accountId: account.id, url: FORUM })
    expect(draft).toMatchObject({ valid: false, definition: null })
    expect(draft.instructions[0]).toMatch(/tools on this computer/)
    expect(page.log).toEqual([])
  })

  it('does not accept a draft whose selectors match nothing on the pages that were read, and saves nothing', async () => {
    const { t, core, productId, account, page } = await forumWorld()
    // What an AI wrote for a page with no discussions at all: selectors that exist nowhere on it.
    const ungrounded = validProfileDefinition({
      login: { loggedInSelector: '[data-logged-in=true]' },
      discussions: { containerSelector: 'body', itemSelector: '[data-discussion]', id: { attr: 'data-id' }, title: { selector: 'a' } },
      comments: { containerSelector: 'body', itemSelector: '[data-comment]', id: { attr: 'data-id' }, body: { selector: 'p' } }
    })
    page.responses.push({ match: '"selector":"[data-discussion]"', value: 0 }, { match: '"selector":"[data-comment]"', value: 0 })
    t.engine.on('channels.site_profile', JSON.stringify(ungrounded))

    const draft = await core.router.call('channels.draftProfile', { productId, accountId: account.id, url: FORUM })

    const reason = 'The draft names parts of the page that do not exist on the pages that were read: [data-discussion]'
    expect(draft).toMatchObject({ host: 'forum.example.com', valid: false, problems: [reason], summary: [] })
    expect(draft.instructions[0]).toBe(reason)
    expect(page.log.filter((entry) => /^(fill|click|upload)\b/.test(entry))).toEqual([])
    expect(core.db.prepare('SELECT COUNT(*) AS n FROM connector_profiles').get()).toEqual({ n: 0 })
  })
})
