import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import { TakeoverError } from '../../core/ports'
import type { Capability, CapabilityKey } from '../../shared/types'
import { aboutJson, listing, postThing, routeHealthyReddit, rulesJson, seedChannel } from '../test-helpers'
import { RedditConnector } from './connector'
import { postingVerdicts } from './assess'
import { analyzeRules } from '../rules-text'

const connector = new RedditConnector({ sleep: async () => undefined, pacingMs: 0 })

function setup() {
  const t = makeTestCore({ connectors: [connector] })
  const seeded = seedChannel(t)
  routeHealthyReddit(seeded.page)
  return { ...t, ...seeded }
}

const byKey = (caps: Capability[]): Record<CapabilityKey, Capability> => Object.fromEntries(caps.map((c) => [c.key, c])) as Record<CapabilityKey, Capability>

describe('Reddit assessment (REQ-002)', () => {
  it('verifies only what it observed and leaves sending abilities at needs_check', async () => {
    const { ctx } = setup()
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.status).toBe('verified')
    expect(caps.read_comments.status).toBe('verified')
    expect(caps.detect_changes.status).toBe('verified')
    expect(caps.rules.status).toBe('verified')
    expect(caps.verify_send.status).toBe('verified')
    expect(caps.metrics.status).toBe('verified')
    // Honesty rule: reaching the form is not proof that a send works.
    expect(caps.publish_post.status).toBe('needs_check')
    expect(caps.publish_reply.status).toBe('needs_check')
    expect(caps.publish_post.detail).toMatch(/first authorized send/)
    expect(Object.keys(caps)).toHaveLength(8)
  })

  it('never types, clicks or uploads anything: no test publication (REQ-002)', async () => {
    const { ctx, page } = setup()
    await connector.assess(ctx)
    expect(page.writes).toEqual([])
    // Only reads and navigation happened.
    expect(page.log.every((line) => /^(goto|read|wait) /.test(line))).toBe(true)
  })

  it('reads through the logged-in page with same-origin site-relative paths only', async () => {
    const { ctx, page } = setup()
    await connector.assess(ctx)
    expect(page.fetched.length).toBeGreaterThan(5)
    expect(page.fetched.every((p) => p.startsWith('/') && !p.startsWith('//'))).toBe(true)
  })

  it('asks the user to sign in instead of claiming anything when the session is logged out', async () => {
    const { ctx, page } = setup()
    page.route('/api/me.json', {}, 200)
    const caps = await connector.assess(ctx)
    expect(caps).toHaveLength(8)
    expect(caps.every((c) => c.status === 'needs_user')).toBe(true)
    expect(caps[0].detail).toMatch(/sign in/i)
  })

  it('reports a CAPTCHA as needs_user', async () => {
    const { ctx, page } = setup()
    page.gate = { captcha: true, blocked: false, title: 'Just a moment' }
    const caps = await connector.assess(ctx)
    expect(caps.every((c) => c.status === 'needs_user' && /CAPTCHA/.test(c.detail))).toBe(true)
  })

  it('marks sending as restricted when the rules forbid automation, but keeps reading verified', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/about/rules.json', rulesJson([{ short_name: 'No bots', description: 'Bots and automated posting are not allowed here.' }]))
    const caps = byKey(await connector.assess(ctx))
    expect(caps.publish_post.status).toBe('restricted')
    expect(caps.publish_reply.status).toBe('restricted')
    expect(caps.publish_reply.detail).toMatch(/No bots/)
    expect(caps.read_posts.status).toBe('verified')
  })

  it('marks an unreadable community as unavailable, not verified', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/new.json', { reason: 'private', message: 'Forbidden', error: 403 }, 403)
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.status).toBe('unavailable')
    expect(caps.read_posts.detail).toMatch(/private/)
    expect(caps.detect_changes.status).not.toBe('verified')
  })

  it('does not call comments verified when no thread with comments exists', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/new.json', listing([postThing({ id: 'p2', numComments: 0 })]))
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.status).toBe('verified')
    expect(caps.read_comments.status).toBe('needs_check')
    expect(caps.detect_changes.status).toBe('needs_check')
  })

  it('reports the posting UI as unavailable when the form cannot be found', async () => {
    const { ctx, page } = setup()
    page.selectors = new Set()
    const caps = byKey(await connector.assess(ctx))
    expect(caps.publish_post.status).toBe('unavailable')
    expect(caps.publish_reply.status).toBe('unavailable')
  })

  it('does not verify the send check when own submissions cannot be read back', async () => {
    const { ctx, page } = setup()
    page.route('/user/natal_bot/submitted.json', {}, 403)
    expect((byKey(await connector.assess(ctx))).verify_send.status).toBe('needs_check')
  })

  it('lets a takeover by the user stop the assessment', async () => {
    const { ctx, page } = setup()
    ctx.session.takeControl()
    await expect(connector.assess(ctx)).rejects.toBeInstanceOf(TakeoverError)
    expect(page.log).toEqual([])
  })

  it('treats a Reddit block page as inconclusive rather than failing or verifying', async () => {
    const { ctx, page } = setup()
    page.gate = { captcha: false, blocked: true, title: 'blocked' }
    const caps = await connector.assess(ctx)
    expect(caps.every((c) => c.status === 'needs_check')).toBe(true)
  })

  it('reads identity through a differently shaped /api/me answer', async () => {
    const { ctx, page } = setup()
    page.route('/api/me.json', { name: 'natal_bot' })
    expect((await connector.assess(ctx)).find((c) => c.key === 'read_posts')?.status).toBe('verified')
  })
})

describe('posting verdicts (pure)', () => {
  const about = (over: Record<string, unknown>) => {
    const json = aboutJson(over) as { data: Record<string, unknown> }
    return {
      displayName: 'test',
      subscribers: 1,
      activeUsers: null,
      subredditType: String(json.data.subreddit_type),
      submissionType: String(json.data.submission_type),
      userIsBanned: json.data.user_is_banned === true,
      userIsContributor: json.data.user_is_contributor === true,
      over18: false
    }
  }

  it('treats an archived community as read-only', () => {
    const v = postingVerdicts('test', about({ subreddit_type: 'archived' }), null)
    expect(v.post.status).toBe('unavailable')
    expect(v.reply.status).toBe('unavailable')
  })

  it('restricts a banned account and a restricted community for posts only', () => {
    expect(postingVerdicts('test', about({ user_is_banned: true }), null).reply.status).toBe('restricted')
    const restricted = postingVerdicts('test', about({ subreddit_type: 'restricted' }), null)
    expect(restricted.post.status).toBe('restricted')
    expect(restricted.reply.status).toBe('needs_check')
    expect(postingVerdicts('test', about({ subreddit_type: 'restricted', user_is_contributor: true }), null).post.status).toBe('needs_check')
  })

  it('warns about promotion rules without restricting', () => {
    const analysis = analyzeRules([{ name: 'No self-promotion', text: 'Do not advertise.' }])
    const v = postingVerdicts('test', about({}), analysis)
    expect(v.post.status).toBe('needs_check')
    expect(v.post.detail).toMatch(/No self-promotion/)
  })
})
