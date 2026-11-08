import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import { TicketError, type PublishRequest } from '../../core/ports'
import { authIssueOf, CaptchaRequiredError, LoginRequiredError } from '../errors'
import type { Capability, CapabilityKey } from '../../shared/types'
import { seedChannel } from '../test-helpers'
import { UniversalConnector } from './connector'
import { armForum, item, SiteFakePage, validProfileDefinition } from './test-helpers'

const CHANNEL = 'https://forum.example.com/c/news'

function setup(opts: { profile?: Record<string, unknown> | null } = {}) {
  const connector = new UniversalConnector({ sleep: async () => undefined, pacingMs: 0, pollMs: 1, verifyTimeoutMs: 5 })
  const t = makeTestCore({ connectors: [connector] })
  connector.bindStorage({ db: t.core.db, clock: t.core.clock })
  const seeded = seedChannel(t, { target: 'forum.example.com/c/news', url: CHANNEL, connectorId: 'universal', platform: 'web', identity: 'natal', page: new SiteFakePage() })
  armForum(seeded.page)
  if (opts.profile !== null) connector.saveProfile(opts.profile ?? validProfileDefinition())
  const ticketFor = (destination: string) => t.core.tickets.issue({ actionId: 'a1', contentHash: 'h', accountId: seeded.accountId, destination })
  return { connector, ...t, ...seeded, ticketFor }
}

const byKey = (caps: Capability[]): Record<CapabilityKey, Capability> => Object.fromEntries(caps.map((c) => [c.key, c])) as Record<CapabilityKey, Capability>

describe('universal connector: addresses', () => {
  const connector = new UniversalConnector()
  it('accepts web addresses and normalizes them', () => {
    expect(connector.matches('https://forum.example.com/c/news')).toBe(true)
    expect(connector.matches('r/astrology')).toBe(false)
    expect(connector.normalizeTarget('https://forum.example.com/c/news/#top')).toEqual({ target: 'forum.example.com/c/news', url: 'https://forum.example.com/c/news/' })
    expect(connector.normalizeTarget('forum.example.com').url).toBe('https://forum.example.com/')
  })

  it('refuses credentials in addresses and non-web schemes', () => {
    expect(() => connector.normalizeTarget('https://user:secret@forum.example.com/')).toThrow(/credentials/)
    expect(() => connector.normalizeTarget('ftp://forum.example.com/')).toThrow()
  })
})

describe('universal connector: unknown site without a valid profile', () => {
  it('reports every capability as needs_check with guidance, never verified', async () => {
    const { connector, ctx, page } = setup({ profile: null })
    const caps = await connector.assess(ctx)
    expect(caps).toHaveLength(8)
    expect(caps.every((c) => c.status === 'needs_check')).toBe(true)
    expect(caps[0].detail).toMatch(/no site profile for forum\.example\.com/i)
    expect(caps[0].detail).toMatch(/Add a validated site profile/)
    expect(page.log).toEqual([]) // nothing was loaded or touched
  })

  it('does not trust an invalid profile and says why', async () => {
    const { connector, ctx } = setup({ profile: { ...validProfileDefinition(), script: 'alert(1)' } })
    const caps = await connector.assess(ctx)
    expect(caps.every((c) => c.status === 'needs_check')).toBe(true)
    expect(caps[0].detail).toMatch(/invalid/)
  })

  it('refuses to read or publish without a valid profile', async () => {
    const { connector, ctx, ticketFor } = setup({ profile: null })
    await expect(connector.fetchActivity(ctx, { limit: 5 })).rejects.toThrow(/no site profile/i)
    const request: PublishRequest = { kind: 'post', destination: CHANNEL, parentExternalId: null, title: 'T', text: 'x', link: null, attachments: [] }
    expect((await connector.publish(ctx, ticketFor(CHANNEL), request)).status).toBe('failed')
  })
})

describe('universal connector: assessment with a valid profile', () => {
  it('verifies reading from the page and keeps sending at needs_check', async () => {
    const { connector, ctx, page } = setup()
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.status).toBe('verified')
    expect(caps.read_comments.status).toBe('verified')
    expect(caps.detect_changes.status).toBe('verified')
    expect(caps.rules.status).toBe('verified')
    expect(caps.verify_send.status).toBe('verified')
    expect(caps.metrics.status).toBe('verified')
    expect(caps.publish_post.status).toBe('needs_check')
    expect(caps.publish_reply.status).toBe('needs_check')
    expect(caps.publish_post.detail).toMatch(/first authorized send/)
    expect(page.writes).toEqual([])
  })

  it('does not rely on the own-content list for reconciliation when it exposes no time', async () => {
    const def = validProfileDefinition()
    delete ((def.ownContent as { reader: Record<string, unknown> }).reader).time
    const h = setup({ profile: def })
    const caps = byKey(await h.connector.assess(h.ctx))
    expect(caps.verify_send.status).toBe('needs_check')
    expect(caps.verify_send.detail).toMatch(/no time/)
  })

  it('marks publishing unavailable when the profile has no flow for it', async () => {
    const def = validProfileDefinition()
    delete (def.publish as Record<string, unknown>).reply
    const { connector, ctx } = setup({ profile: def })
    const caps = byKey(await connector.assess(ctx))
    expect(caps.publish_reply.status).toBe('unavailable')
    expect(caps.publish_post.status).toBe('needs_check')
  })

  it('restricts sending when the rules page forbids automation', async () => {
    const { connector, ctx, page } = setup()
    page.at('https://forum.example.com/rules', { selectors: new Set(['div.rules']), texts: { 'div.rules': 'No bots or automated posting allowed.' } })
    const caps = byKey(await connector.assess(ctx))
    expect(caps.publish_post.status).toBe('restricted')
    expect(caps.publish_reply.status).toBe('restricted')
    expect(caps.read_posts.status).toBe('verified')
  })

  it('does not verify reading when the container disappeared (site layout changed)', async () => {
    const { connector, ctx, page } = setup()
    page.at(CHANNEL, { selectors: new Set(), items: {} })
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.status).toBe('needs_check')
    expect(caps.read_posts.detail).toMatch(/layout may have changed/)
    expect(caps.detect_changes.status).toBe('needs_check')
  })

  it('asks for sign-in / CAPTCHA instead of claiming anything', async () => {
    const a = setup()
    a.page.login = { loggedIn: false, identity: '', captcha: false }
    expect((await a.connector.assess(a.ctx)).every((c) => c.status === 'needs_user')).toBe(true)
    const b = setup()
    b.page.gate = { captcha: true, blocked: false, title: 'Verify' }
    const caps = await b.connector.assess(b.ctx)
    expect(caps.every((c) => c.status === 'needs_user' && /CAPTCHA/.test(c.detail))).toBe(true)
  })

  it('does not trust a profile for a channel address outside its patterns', async () => {
    const t = setup()
    const other = seedChannel(t, { target: 'forum.example.com/other', url: 'https://forum.example.com/other', connectorId: 'universal', platform: 'web', page: new SiteFakePage() })
    const caps = await t.connector.assess(other.ctx)
    expect(caps.every((c) => c.status === 'needs_check')).toBe(true)
    expect(caps[0].detail).toMatch(/does not match any channel pattern/)
    expect(other.page.log).toEqual([])
  })

  it('checks the login through the profile selectors', async () => {
    const { connector, ctx, page } = setup()
    expect(await connector.checkLogin(ctx)).toEqual({ loggedIn: true, identity: 'natal', captcha: false })
    page.login = { loggedIn: false, identity: '', captcha: false }
    expect(await connector.checkLogin(ctx)).toEqual({ loggedIn: false, identity: null, captcha: false })
    page.login = { loggedIn: false, identity: '', captcha: true }
    expect((await connector.checkLogin(ctx)).captcha).toBe(true)
  })
})

describe('universal connector: reading', () => {
  it('maps discussions and comments, resolving relative permalinks and parent ids', async () => {
    const { connector, ctx } = setup()
    const batch = await connector.fetchActivity(ctx, { limit: 10 })
    expect(batch.discussions.map((d) => d.externalId)).toEqual(['t2', 't1'])
    expect(batch.discussions[1].url).toBe('https://forum.example.com/t/1')
    const comments = batch.discussions[0].comments
    expect(comments.map((c) => [c.externalId, c.parentExternalId])).toEqual([
      ['t2-p1', null],
      ['t2-p2', 't2-p1']
    ])
    expect(comments[0].postedAt).toBe('2026-11-08T10:05:00.000Z')
    expect(batch.discussions[1].comments).toEqual([]) // container present, no comments: a genuine empty thread
  })

  it('fails the batch when a thread page no longer matches the profile, instead of reporting zero comments', async () => {
    const { connector, ctx, page } = setup()
    page.at('https://forum.example.com/t/2', { selectors: new Set(), items: {} })
    await expect(connector.fetchActivity(ctx, { limit: 10 })).rejects.toThrow(/was not found/)
  })

  it('reports a sign-in wall as a recognizable error instead of a changed layout', async () => {
    const h = setup()
    h.page.site.get(CHANNEL)!.selectors.delete('ul.topics') // the login wall replaces the list
    h.page.login = { loggedIn: false, identity: '', captcha: false }
    await expect(h.connector.fetchActivity(h.ctx, { limit: 5 })).rejects.toBeInstanceOf(LoginRequiredError)
    await expect(h.connector.fetchThread(h.ctx, 't2')).rejects.toBeInstanceOf(LoginRequiredError)
  })

  it('reports a CAPTCHA wall as a recognizable error', async () => {
    const h = setup()
    h.page.site.get(CHANNEL)!.selectors.delete('ul.topics')
    h.page.gate = { captcha: true, blocked: false, title: 'Just a moment' }
    await expect(h.connector.fetchActivity(h.ctx, { limit: 5 })).rejects.toBeInstanceOf(CaptchaRequiredError)
  })

  it('keeps the layout error when the account is signed in and the container is simply gone', async () => {
    const h = setup()
    h.page.site.get(CHANNEL)!.selectors.delete('ul.topics')
    const error = await h.connector.fetchActivity(h.ctx, { limit: 5 }).catch((e: unknown) => e)
    expect(authIssueOf(error)).toBeNull()
    expect((error as Error).message).toMatch(/ul\.topics/)
  })

  it('ignores permalinks that leave the profile host', async () => {
    const { connector, ctx, page } = setup()
    page.site.get(CHANNEL)!.items['li.topic'][0].permalink = 'https://evil.example.org/t/2'
    const batch = await connector.fetchActivity(ctx, { limit: 10 })
    expect(batch.discussions[0].url).toBe(CHANNEL)
    expect(page.log.some((l) => l.includes('evil.example.org'))).toBe(false)
  })

  it('finds one thread through the listing and returns null for a missing one', async () => {
    const { connector, ctx } = setup()
    expect((await connector.fetchThread(ctx, 't2'))?.title).toBe('Newer topic')
    expect(await connector.fetchThread(ctx, 'nope')).toBeNull()
  })

  it('reads metrics from the page and reports the rest as unavailable', async () => {
    const { connector, ctx, page } = setup()
    expect(await connector.fetchMetrics(ctx)).toEqual([{ key: 'members', label: 'Members', value: 1200, available: true }])
    page.site.get(CHANNEL)!.texts = {}
    expect(await connector.fetchMetrics(ctx)).toEqual([{ key: 'members', label: 'Members', value: null, available: false }])
  })
})

describe('universal connector: publishing', () => {
  const reply = (over: Partial<PublishRequest> = {}): PublishRequest => ({
    kind: 'reply',
    destination: 'https://forum.example.com/t/2',
    parentExternalId: 't2-p1',
    title: null,
    text: 'Thanks for asking!',
    link: null,
    attachments: [],
    ...over
  })
  const post = (over: Partial<PublishRequest> = {}): PublishRequest => ({ kind: 'post', destination: CHANNEL, parentExternalId: null, title: 'Birth chart basics', text: 'Body', link: null, attachments: [], ...over })

  it('runs the reply steps with placeholders filled in, using the ticket for every write', async () => {
    const h = setup()
    h.page.afterSubmitUrl = 'https://forum.example.com/t/2'
    h.page.site.get('https://forum.example.com/t/2')!.selectors.add('div.post.mine')
    const outcome = await h.connector.publish(h.ctx, h.ticketFor(reply().destination), reply())
    expect(outcome.status).toBe('confirmed')
    expect(h.page.log).toContain('goto https://forum.example.com/t/2')
    expect(h.page.writes).toEqual([
      'click div.post[data-id="t2-p1"] button.reply',
      'fill textarea.editor Thanks for asking!',
      'click button.submit'
    ])
  })

  it('confirms a post by URL pattern and captures its id', async () => {
    const h = setup()
    h.page.afterSubmitUrl = 'https://forum.example.com/t/77'
    h.page.at('https://forum.example.com/t/77', { pageText: 'Birth chart basics — first post', selectors: new Set() })
    const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
    expect(outcome).toEqual({ status: 'confirmed', url: 'https://forum.example.com/t/77', externalId: '77' })
  })

  it('does not confirm when only part of the verification holds', async () => {
    const h = setup()
    h.page.afterSubmitUrl = 'https://forum.example.com/t/77'
    h.page.at('https://forum.example.com/t/77', { pageText: 'something else entirely', selectors: new Set() })
    expect((await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())).status).toBe('unknown')
  })

  it('maps the site rejection message to a definite failure', async () => {
    const h = setup()
    h.page.errors = ['You are posting too fast']
    const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/too fast/) })
  })

  it('reports unknown when the page breaks after the submit click', async () => {
    const h = setup()
    h.page.failOnClickAt = 2 // the submit click of the post flow
    const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
    expect(outcome).toMatchObject({ status: 'unknown', error: expect.stringMatching(/page crashed/) })
  })

  it('reports a definite failure when a step fails before the submit click', async () => {
    const h = setup()
    h.page.site.get(CHANNEL)!.selectors.delete('button.new-topic') // layout changed: the flow cannot start
    const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/layout may have changed/) })
    expect(h.page.writes).toEqual([])
  })

  it('refuses an unsafe parent id instead of building a selector from it', async () => {
    const h = setup()
    const outcome = await h.connector.publish(h.ctx, h.ticketFor(reply().destination), reply({ parentExternalId: '"] , body , ["' }))
    expect(outcome.status).toBe('failed')
    expect(h.page.writes).toEqual([])
  })

  it('requires a valid ticket for the exact destination', async () => {
    const h = setup()
    await expect(h.connector.publish(h.ctx, undefined as never, post())).rejects.toBeInstanceOf(TicketError)
    await expect(h.connector.publish(h.ctx, h.ticketFor('https://forum.example.com/other'), post())).rejects.toThrow(/destination/)
    expect(h.page.log).toEqual([])
  })

  it('refuses destinations outside the profile host and attachments', async () => {
    const h = setup()
    const outside = post({ destination: 'https://evil.example.org/' })
    expect((await h.connector.publish(h.ctx, h.ticketFor(outside.destination), outside)).status).toBe('failed')
    const withFile = post({ attachments: [{ name: 'a.png', path: '/x/a.png', mime: 'image/png', sha256: 'aa' }] })
    expect((await h.connector.publish(h.ctx, h.ticketFor(withFile.destination), withFile)).status).toBe('failed')
    expect(h.page.log).toEqual([])
  })

  describe('session checks before the first write', () => {
    const failureOf = (outcome: Awaited<ReturnType<UniversalConnector['publish']>>): string => (outcome.status === 'failed' ? outcome.error : `not failed: ${outcome.status}`)

    it('refuses with a recognizable sign-in error when the account is not signed in', async () => {
      const h = setup()
      h.page.login = { loggedIn: false, identity: '', captcha: false }
      const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
      expect(outcome.status).toBe('failed')
      expect(authIssueOf(failureOf(outcome))).toBe('login')
      expect(h.page.writes).toEqual([])
    })

    it('refuses with a recognizable CAPTCHA error when the site shows a human check', async () => {
      const h = setup()
      h.page.login = { loggedIn: true, identity: 'natal', captcha: true }
      const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
      expect(authIssueOf(failureOf(outcome))).toBe('captcha')
      expect(h.page.writes).toEqual([])
    })

    it('refuses when someone else is signed in than the configured account', async () => {
      const h = setup()
      h.page.login = { loggedIn: true, identity: 'someone_else', captcha: false }
      const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
      expect(failureOf(outcome)).toMatch(/someone_else.*natal/)
      expect(h.page.writes).toEqual([])
    })

    it('refuses when the site does not reveal who is signed in although the account has a confirmed identity', async () => {
      const h = setup()
      h.page.login = { loggedIn: true, identity: '', captcha: false }
      const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
      expect(failureOf(outcome)).toMatch(/who is signed in/)
      expect(h.page.writes).toEqual([])
    })

    it('refuses when the profile cannot read the signed-in name but the account identity is known', async () => {
      const def = validProfileDefinition({ login: { loggedInSelector: '#current-user', captchaSelector: '.captcha' } })
      const h = setup({ profile: def })
      const outcome = await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())
      expect(failureOf(outcome)).toMatch(/who is signed in/)
      expect(h.page.writes).toEqual([])
    })

    it('compares the name ignoring case and spacing, and publishes', async () => {
      const h = setup()
      h.page.login = { loggedIn: true, identity: '  NATAL ', captcha: false }
      h.page.afterSubmitUrl = 'https://forum.example.com/t/77'
      h.page.at('https://forum.example.com/t/77', { pageText: 'Birth chart basics', selectors: new Set() })
      expect((await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())).status).toBe('confirmed')
    })

    it('does not block an account whose identity is not known yet', async () => {
      const h = setup()
      h.core.db.prepare('UPDATE accounts SET identity = NULL WHERE id = ?').run(h.accountId)
      h.page.login = { loggedIn: true, identity: 'anyone', captcha: false }
      h.page.afterSubmitUrl = 'https://forum.example.com/t/77'
      h.page.at('https://forum.example.com/t/77', { pageText: 'Birth chart basics', selectors: new Set() })
      const { ctx } = h.core.connectorContext(h.channel.id)
      expect((await h.connector.publish(ctx, h.ticketFor(CHANNEL), post())).status).toBe('confirmed')
    })
  })

  it('stops with a definite failure when the profile has no flow for the action', async () => {
    const def = validProfileDefinition()
    delete (def.publish as Record<string, unknown>).post
    const h = setup({ profile: def })
    expect((await h.connector.publish(h.ctx, h.ticketFor(CHANNEL), post())).status).toBe('failed')
  })
})

describe('universal connector: resolving unknown outcomes', () => {
  const attemptedAt = '2026-11-08T11:55:00Z' // the own item "mine-1" was created at 12:00, i.e. after the attempt
  const request: PublishRequest = { kind: 'reply', destination: 'https://forum.example.com/t/2', parentExternalId: 't2-p1', title: null, text: 'My earlier  reply', link: null, attachments: [], attemptedAt }
  const OWN = 'https://forum.example.com/u/natal/posts'
  const ownItems = (h: ReturnType<typeof setup>, items: ReturnType<typeof item>[]): void => {
    h.page.site.get(OWN)!.items['div.post'] = items
  }

  it('finds own content that matches the request body, parent and time', async () => {
    const { connector, ctx } = setup()
    expect(await connector.findPublished(ctx, request)).toEqual({ url: 'https://forum.example.com/t/2#9', externalId: 'mine-1' })
    expect(await connector.findPublished(ctx, { ...request, text: 'never sent' })).toBeNull()
  })

  it('never matches older content with identical text', async () => {
    const h = setup()
    ownItems(h, [item({ id: 'old', body: 'Thanks!', parentId: 't2-p1', permalink: 'https://forum.example.com/t/2#1', time: '2026-10-01T09:00:00Z' })])
    expect(await h.connector.findPublished(h.ctx, { ...request, text: 'Thanks!' })).toBeNull()
  })

  it('does not match a comment under another parent', async () => {
    const h = setup()
    ownItems(h, [item({ id: 'x', body: 'My earlier reply', parentId: 't2-p2', permalink: 'https://forum.example.com/t/2#2', time: '2026-11-08T12:00:00Z' })])
    expect(await h.connector.findPublished(h.ctx, request)).toBeNull()
  })

  it('picks the new comment among older identical ones', async () => {
    const h = setup()
    ownItems(h, [
      item({ id: 'old', body: 'My earlier reply', parentId: 't2-p1', permalink: 'https://forum.example.com/t/2#1', time: '2026-10-01T09:00:00Z' }),
      item({ id: 'new', body: 'My earlier reply', parentId: 't2-p1', permalink: 'https://forum.example.com/t/2#3', time: '2026-11-08T12:01:00Z' })
    ])
    expect(await h.connector.findPublished(h.ctx, request)).toMatchObject({ externalId: 'new' })
  })

  it('allows a few minutes of clock skew but not more', async () => {
    const h = setup()
    ownItems(h, [item({ id: 'a', body: 'My earlier reply', parentId: 't2-p1', permalink: 'https://forum.example.com/t/2#1', time: '2026-11-08T11:52:00Z' })])
    expect(await h.connector.findPublished(h.ctx, request)).toMatchObject({ externalId: 'a' })
    ownItems(h, [item({ id: 'b', body: 'My earlier reply', parentId: 't2-p1', permalink: 'https://forum.example.com/t/2#1', time: '2026-11-08T11:40:00Z' })])
    expect(await h.connector.findPublished(h.ctx, request)).toBeNull()
  })

  it('does not match an item whose time is missing or unreadable', async () => {
    const h = setup()
    ownItems(h, [item({ id: 'a', body: 'My earlier reply', parentId: 't2-p1', permalink: 'https://forum.example.com/t/2#1', time: 'yesterday-ish' })])
    expect(await h.connector.findPublished(h.ctx, request)).toBeNull()
  })

  it('finds a post by title and time, not by title alone', async () => {
    const h = setup()
    const postRequest: PublishRequest = { kind: 'post', destination: CHANNEL, parentExternalId: null, title: 'Birth chart basics', text: 'Body', link: null, attachments: [], attemptedAt }
    ownItems(h, [
      item({ id: 'old-topic', title: 'Birth chart basics', body: 'Body', permalink: 'https://forum.example.com/t/5', time: '2026-09-01T09:00:00Z' }),
      item({ id: 'other', title: 'Another title', body: 'Body', permalink: 'https://forum.example.com/t/6', time: '2026-11-08T12:00:00Z' })
    ])
    expect(await h.connector.findPublished(h.ctx, postRequest)).toBeNull()
    ownItems(h, [item({ id: 'fresh', title: 'Birth chart basics', body: 'Body', permalink: 'https://forum.example.com/t/7', time: '2026-11-08T12:00:00Z' })])
    expect(await h.connector.findPublished(h.ctx, postRequest)).toMatchObject({ externalId: 'fresh' })
  })

  it('refuses to guess when the time of the attempt is unknown', async () => {
    const { connector, ctx } = setup()
    await expect(connector.findPublished(ctx, { ...request, attemptedAt: undefined })).rejects.toThrow(/time of the send attempt/)
  })

  it('throws when the profile cannot tell new content from old (no time, or no parent for a reply), instead of answering "not published"', async () => {
    const noTime = validProfileDefinition()
    delete ((noTime.ownContent as { reader: Record<string, unknown> }).reader).time
    const a = setup({ profile: noTime })
    await expect(a.connector.findPublished(a.ctx, request)).rejects.toThrow(/time/)

    const noParent = validProfileDefinition()
    delete ((noParent.ownContent as { reader: Record<string, unknown> }).reader).parentId
    const b = setup({ profile: noParent })
    await expect(b.connector.findPublished(b.ctx, request)).rejects.toThrow(/parent/)
  })

  it('throws when the profile cannot look up own content, so "cannot look" is never "not published"', async () => {
    const def = validProfileDefinition()
    delete def.ownContent
    const { connector, ctx } = setup({ profile: def })
    await expect(connector.findPublished(ctx, request)).rejects.toThrow(/cannot look up/)
  })

  it('throws a recognizable sign-in error when the own-content page is a login wall', async () => {
    const h = setup()
    h.page.site.get(OWN)!.selectors.delete('div.mine')
    h.page.login = { loggedIn: false, identity: '', captcha: false }
    await expect(h.connector.findPublished(h.ctx, request)).rejects.toBeInstanceOf(LoginRequiredError)
  })
})
