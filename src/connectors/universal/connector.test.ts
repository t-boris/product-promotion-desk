import { describe, expect, it } from 'vitest'
import type { ControlledSession } from '../../core/browser-session'
import { makeTestCore } from '../../core/testing/fakes'
import { TicketError, type PublishRequest } from '../../core/ports'
import { authIssueOf, CaptchaRequiredError, LoginRequiredError } from '../errors'
import type { Capability, CapabilityKey } from '../../shared/types'
import { seedChannel } from '../test-helpers'
import { UniversalConnector, addressOf } from './connector'
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
  it('says plainly that nothing is read here, keeps posting at needs_check, and never claims verified (DEC-034)', async () => {
    const { connector, ctx, page } = setup({ profile: null })
    const caps = await connector.assess(ctx)
    expect(caps).toHaveLength(9)
    const status = Object.fromEntries(caps.map((c) => [c.key, c.status]))
    // Posting is the one ability that stays: the AI makes the post in the account's browser, and the owner confirms it afterwards.
    expect(status.publish_post).toBe('needs_check')
    expect(status.verify_send).toBe('needs_check')
    for (const key of ['read_posts', 'read_comments', 'detect_changes', 'publish_reply', 'metrics', 'membership']) expect(status[key]).toBe('unavailable')
    expect(caps.some((c) => c.status === 'verified')).toBe(false)
    expect(caps.find((c) => c.key === 'read_posts')?.detail).toMatch(/no site profile for forum\.example\.com/i)
    expect(caps.find((c) => c.key === 'read_posts')?.detail).toMatch(/does not read this site/)
    // The reason is told once; every other row that is unavailable says only that the app does not read the site.
    for (const key of ['read_comments', 'detect_changes', 'publish_reply', 'metrics', 'membership']) expect(caps.find((c) => c.key === key)?.detail).toMatch(/does not read this site\.$/)
    // The app cannot read the page back, so it never confirms a post itself and never promises to: the owner does (DEC-034).
    expect(caps.find((c) => c.key === 'publish_post')?.detail).toMatch(/you confirm yourself that it is up/)
    expect(caps.find((c) => c.key === 'publish_post')?.detail).not.toMatch(/first real post/)
    expect(caps.find((c) => c.key === 'verify_send')?.detail).toMatch(/cannot confirm a post by itself: you confirm it/)
    expect(page.log).toEqual([]) // nothing was loaded or touched
  })

  it('does not trust an invalid profile and says why', async () => {
    const { connector, ctx } = setup({ profile: { ...validProfileDefinition(), script: 'alert(1)' } })
    const caps = await connector.assess(ctx)
    expect(caps.some((c) => c.status === 'verified')).toBe(false)
    expect(caps.find((c) => c.key === 'read_comments')?.status).toBe('unavailable')
    expect(caps.find((c) => c.key === 'read_posts')?.detail).toMatch(/invalid/)
  })

  it('reads a site only when a valid site profile exists for it (DEC-034)', () => {
    const readable = setup()
    expect(readable.connector.readsChannel(readable.ctx.channel)).toBe(true)
    const none = setup({ profile: null })
    expect(none.connector.readsChannel(none.ctx.channel)).toBe(false)
    const invalid = setup({ profile: { ...validProfileDefinition(), script: 'alert(1)' } })
    expect(invalid.connector.readsChannel(invalid.ctx.channel)).toBe(false)
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

  it('never reads a rules page: a page that forbids bots changes nothing (DEC-050)', async () => {
    const { connector, ctx, page } = setup()
    page.at('https://forum.example.com/rules', { selectors: new Set(['div.rules']), texts: { 'div.rules': 'No bots or automated posting allowed.' } })
    const caps = byKey(await connector.assess(ctx))
    expect(caps.publish_post.status).toBe('needs_check')
    expect(caps.publish_reply.status).toBe('needs_check')
    expect(caps.publish_reply.detail).not.toMatch(/No bots|rules/i)
    expect(caps.read_posts.status).toBe('verified')
    expect(Object.keys(caps)).not.toContain('rules')
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
    b.page.gate = { captcha: true, blocked: false, title: 'Verify', signal: 'the page title is a check page' }
    const caps = await b.connector.assess(b.ctx)
    expect(caps.every((c) => c.status === 'needs_user' && /CAPTCHA/.test(c.detail))).toBe(true)
  })

  it('does not read a channel address outside the channel pages of its profile: it is for own posts, and nothing is loaded (DEC-034)', async () => {
    const t = setup()
    const other = seedChannel(t, { target: 'forum.example.com/other', url: 'https://forum.example.com/other', connectorId: 'universal', platform: 'web', page: new SiteFakePage() })
    // The profile covers /c/* of this host: the channel it was written for is read, a page of the same host it does not describe is not.
    expect(t.connector.readsChannel(t.ctx.channel)).toBe(true)
    expect(t.connector.readsChannel(other.ctx.channel)).toBe(false)
    const caps = await t.connector.assess(other.ctx)
    const status = Object.fromEntries(caps.map((c) => [c.key, c.status]))
    expect(status).toMatchObject({ read_posts: 'unavailable', read_comments: 'unavailable', publish_reply: 'unavailable', publish_post: 'needs_check', verify_send: 'needs_check' })
    expect(caps.find((c) => c.key === 'read_posts')?.detail).toMatch(/does not match any channel pattern/)
    expect(caps.find((c) => c.key === 'read_posts')?.detail).toMatch(/does not read this page/)
    expect(caps.find((c) => c.key === 'read_comments')?.detail).toBe('The app does not read this page.')
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

describe('universal connector: sign-in check of an account that has no site profile yet', () => {
  it('says the account is signed out when the page asks to sign in, and what it saw', async () => {
    const { connector, ctx, page } = setup({ profile: null })
    page.session = { signedOut: true, signal: 'a password field is shown', textLength: 500 }
    expect(await connector.checkLogin(ctx)).toEqual({ loggedIn: false, identity: null, captcha: false, signal: 'a password field is shown' })
    expect(page.sessionLooks).toBe(1) // a sign-in prompt ends the wait at once
  })

  it('says the session is in when the page never asks to sign in after it had time to draw', async () => {
    const { connector, ctx, page } = setup({ profile: null })
    const state = await connector.checkLogin(ctx)
    expect(state).toMatchObject({ loggedIn: true, identity: null, captcha: false })
    expect(page.sessionLooks).toBeGreaterThan(3) // forms are drawn late, so it looked more than once
    expect(page.log.filter((entry) => entry.startsWith('goto ')).length).toBe(1)
  })

  it('does not claim a session on a page that stayed empty', async () => {
    const { connector, ctx, page } = setup({ profile: null })
    page.session = { signedOut: false, signal: '', textLength: 12 }
    const state = await connector.checkLogin(ctx)
    expect(state.loggedIn).toBe(false)
    expect(state.signal).toMatch(/stayed empty/)
  })

  it('reports a visible human check as such', async () => {
    const { connector, ctx, page } = setup({ profile: null })
    page.gate = { captcha: true, blocked: false, title: 'Verify', signal: 'a visible check on the page (google.com/recaptcha)' }
    expect(await connector.checkLogin(ctx)).toMatchObject({ loggedIn: false, captcha: true, signal: 'a visible check on the page (google.com/recaptcha)' })
  })

  it('writes nothing and uses no profile', async () => {
    const { connector, ctx, page } = setup({ profile: null })
    await connector.checkLogin(ctx)
    expect(page.writes).toEqual([])
  })

  it('still uses the profile when there is one, and refuses an invalid one as before', async () => {
    const withProfile = setup()
    expect(await withProfile.connector.checkLogin(withProfile.ctx)).toEqual({ loggedIn: true, identity: 'natal', captcha: false })
    expect(withProfile.page.sessionLooks).toBe(0)
    const invalid = setup({ profile: { ...validProfileDefinition(), script: 'alert(1)' } })
    await expect(invalid.connector.checkLogin(invalid.ctx)).rejects.toThrow(/invalid/)
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
    h.page.gate = { captcha: true, blocked: false, title: 'Just a moment', signal: 'the page title is a check page' }
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

  it('stops with a definite failure, and no submit click, when the owner used a sign-out page of the account in their own window while the flow typed (DEC-038)', async () => {
    const h = setup()
    h.page.afterSubmitUrl = 'https://forum.example.com/t/2'
    h.page.site.get('https://forum.example.com/t/2')!.selectors.add('div.post.mine')
    const fill = h.page.fill.bind(h.page)
    h.page.fill = async (selector: string, text: string) => {
      await fill(selector, text)
      ;(h.ctx.session as ControlledSession).noteIdentityActivity()
    }
    const outcome = await h.connector.publish(h.ctx, h.ticketFor(reply().destination), reply())
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/sign-in may have changed/) })
    expect(h.page.writes.some((w) => w.startsWith('click button.submit'))).toBe(false)
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

describe('universal connector: the address of a channel (DEC-034)', () => {
  it('is the host and the path with no closing slash, and normalizeTarget stores exactly that', () => {
    expect(addressOf('https://forum.example.com/c/news/')).toBe('forum.example.com/c/news')
    expect(addressOf('https://www.instagram.com/brand/?hl=en#top')).toBe('www.instagram.com/brand')
    expect(new UniversalConnector().normalizeTarget('https://forum.example.com/c/news/#top').target).toBe(addressOf('https://forum.example.com/c/news/'))
  })

  it('is what {{target}} stands for even when the channel is called by a handle', async () => {
    const def = validProfileDefinition()
    ;(def.ownContent as { url: string }).url = 'https://forum.example.com/u/{{identity}}/posts?c={{target}}'
    const h = setup({ profile: def })
    h.core.db.prepare("UPDATE channels SET target = '@brand' WHERE id = ?").run(h.ctx.channel.id)
    const renamed = { ...h.ctx, channel: h.core.repos.channel(h.ctx.channel.id) }
    expect(renamed.channel.target).toBe('@brand')
    await h.connector.findPublished(renamed, { kind: 'post', destination: CHANNEL, parentExternalId: null, title: 'T', text: 'x', link: null, attachments: [], attemptedAt: '2026-11-08T11:55:00Z' }).catch(() => undefined)
    expect(h.page.log).toContain('goto https://forum.example.com/u/natal/posts?c=forum.example.com%2Fc%2Fnews')
  })

  it('is what {{target}} stands for when a channel is assessed or published to, whatever it is called', async () => {
    const def = validProfileDefinition()
    ;(def.publish as { post: { steps: Record<string, unknown>[] } }).post.steps[0] = { type: 'goto', url: 'https://forum.example.com/c/news?from={{target}}' }
    const expected = 'goto https://forum.example.com/c/news?from=forum.example.com%2Fc%2Fnews'
    const renamed = (h: ReturnType<typeof setup>) => {
      h.core.db.prepare("UPDATE channels SET target = '@brand' WHERE id = ?").run(h.ctx.channel.id)
      return { ...h.ctx, channel: h.core.repos.channel(h.ctx.channel.id) }
    }
    const assessing = setup({ profile: def })
    await assessing.connector.assess(renamed(assessing)).catch(() => undefined)
    expect(assessing.page.log).toContain(expected)
    const publishing = setup({ profile: def })
    const request: PublishRequest = { kind: 'post', destination: CHANNEL, parentExternalId: null, title: 'T', text: 'x', link: null, attachments: [] }
    await publishing.connector.publish(renamed(publishing), publishing.ticketFor(CHANNEL), request).catch(() => undefined)
    expect(publishing.page.log).toContain(expected)
  })

  it('an assessment tells a channel again that it is read now: it awaits its first read, it is not simply set going (DEC-034)', async () => {
    const h = setup()
    // As it was stored while the site had no profile: not read, suspended by a lost sign-in, never read.
    h.core.db.prepare("UPDATE channels SET reads = 0, status = 'needs_user', status_detail = 'Account needs you', baseline_done_at = NULL WHERE id = ?").run(h.ctx.channel.id)
    const assessed = await h.core.router.call('channels.assess', { channelId: h.ctx.channel.id })
    expect(assessed).toMatchObject({ reads: true, status: 'setup', baselineDoneAt: null })
    expect(assessed.statusDetail).not.toBe('Your own posts only.')
  })
})
