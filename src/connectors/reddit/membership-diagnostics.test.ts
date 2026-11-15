// DEC-029: a refusal says what Reddit answered (in safe words) and does not multiply; the account's membership is its own row.

import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import type { Capability, CapabilityKey } from '../../shared/types'
import { aboutJson, routeHealthyReddit, seedChannel } from '../test-helpers'
import { plainWords, refusalWords } from './api'
import { listingRefusal, membershipRow } from './assess'
import { RedditConnector } from './connector'
import { mapAbout, membershipOf } from './mapping'

const connector = new RedditConnector({ sleep: async () => undefined, pacingMs: 0 })

function setup() {
  const t = makeTestCore({ connectors: [connector] })
  const seeded = seedChannel(t)
  routeHealthyReddit(seeded.page)
  return { ...t, ...seeded }
}

const byKey = (caps: Capability[]): Record<CapabilityKey, Capability> => Object.fromEntries(caps.map((c) => [c.key, c])) as Record<CapabilityKey, Capability>

const BLOCK_PAGE = '<!doctype html><html><head><title>Blocked</title></head><body><h1>You&#39;ve been blocked by network security.</h1><p>Logged in as u/boris_chart_notebook</p>'

describe('what Reddit said about a refusal', () => {
  it('gives the reason of a JSON answer in plain words', () => {
    expect(refusalWords({ status: 403, json: { reason: 'private', message: 'Forbidden', error: 403 }, text: '' })).toBe('private')
    expect(refusalWords({ status: 403, json: { message: 'Forbidden' }, text: '' })).toBe('Forbidden')
    expect(refusalWords({ status: 403, json: { error: 403 }, text: '' })).toBe('')
  })

  it('names a known kind of page by a fixed phrase and never passes the page on', () => {
    const words = refusalWords({ status: 403, json: null, text: BLOCK_PAGE, type: 'text/html' })
    expect(words).toBe('a network-security block page')
    expect(words).not.toMatch(/boris|chart_notebook|html/i)
    expect(refusalWords({ status: 403, json: null, text: '<title>Just a moment...</title>', type: 'text/html' })).toBe('a human-check page')
    expect(refusalWords({ status: 429, json: null, text: 'Too Many Requests', type: 'text/plain' })).toBe('a "too many requests" page')
    expect(refusalWords({ status: 403, json: null, text: '<html><title>Log in to Reddit</title>', type: 'text/html' })).toBe('a sign-in page')
  })

  it('says an unknown page is a page and not data, without quoting it', () => {
    const words = refusalWords({ status: 403, json: null, text: '<html><body>Some new wording with a secret-ish thing</body>', type: 'text/html' })
    expect(words).toBe('an HTML page instead of data, with no reason given')
    expect(refusalWords({ status: 403, json: null, text: '', type: '' })).toBe('')
  })

  it('drops handles, addresses and long tokens, keeps only plain words and cuts them short', () => {
    expect(plainWords('Forbidden for u/boris_chart_notebook at https://www.reddit.com/r/x?token=abc123')).toBe('Forbidden for at')
    expect(plainWords('Contact me@example.com or user/another-name')).not.toMatch(/example|another/)
    expect(plainWords('mail john.doe@example.com now')).toBe('mail now')
    expect(plainWords('token abcdefghijklmnopqrstuvwxyz0123456789 end')).toBe('token end')
    expect(plainWords('<b>bold</b> {x}')).toBe('b bold /b x')
    expect(plainWords('word '.repeat(60)).length).toBeLessThanOrEqual(100)
  })
})

describe('the listing refusal (pure)', () => {
  it('does not blame the sign-in when the rules and the numbers of the same community were read', () => {
    const text = listingRefusal('astrology', 'access denied (private), HTTP 403', { about: true, rules: true }, true)
    expect(text).toContain('Reddit did not give the r/astrology post list: access denied (private), HTTP 403.')
    expect(text).toMatch(/same sign-in, so the sign-in works; only the post list was refused/)
    expect(text).not.toMatch(/not joined/)
  })

  it('says what else was refused, and points at Membership only when the account has not joined', () => {
    expect(listingRefusal('x', 'a', { about: false, rules: true }, null)).toMatch(/Part of the community/)
    expect(listingRefusal('x', 'a', { about: false, rules: false }, null)).toMatch(/other pages were refused too/)
    expect(listingRefusal('x', 'a', { about: true, rules: true }, false)).toMatch(/has not joined r\/x yet \(see Membership\)/)
    expect(listingRefusal('x', 'a', { about: true, rules: true }, null)).not.toMatch(/joined/)
  })
})

describe('what Reddit says about membership', () => {
  it('keeps "joined", "not joined" and "not said" apart', () => {
    expect(mapAbout(aboutJson({ user_is_subscriber: true }))?.userIsSubscriber).toBe(true)
    expect(mapAbout(aboutJson({ user_is_subscriber: false }))?.userIsSubscriber).toBe(false)
    expect(mapAbout(aboutJson({ user_is_subscriber: null }))?.userIsSubscriber).toBeNull()
    expect(mapAbout(aboutJson({ user_is_subscriber: undefined }))?.userIsSubscriber).toBeNull()
    expect(mapAbout(aboutJson({ user_is_subscriber: 'yes' }))?.userIsSubscriber).toBeNull()
  })

  it.each([
    ['public', 'open'],
    ['archived', 'open'],
    ['restricted', 'restricted'],
    ['gold_restricted', 'restricted'],
    ['private', 'private'],
    ['employees_only', 'private'],
    ['user', 'unknown']
  ])('reads a %s community as %s', (type, access) => {
    const about = mapAbout(aboutJson({ subreddit_type: type, user_is_subscriber: false }))!
    expect(membershipOf(about)).toEqual({ member: false, banned: false, access })
  })

  it('words the row for each state, and says what to do', () => {
    const about = (over: Record<string, unknown>) => mapAbout(aboutJson(over))!
    expect(membershipRow('x', about({ user_is_subscriber: true }), '')).toEqual({ status: 'verified', detail: 'This account is a member of r/x.' })
    const open = membershipRow('x', about({ user_is_subscriber: false }), '')
    expect(open.status).toBe('needs_check')
    expect(open.detail).toMatch(/has not joined r\/x/)
    expect(open.detail).toMatch(/Let the AI join/)
    expect(membershipRow('x', about({ user_is_subscriber: false, subreddit_type: 'restricted' }), '').status).toBe('needs_check')
    const priv = membershipRow('x', about({ user_is_subscriber: false, subreddit_type: 'private' }), '')
    expect(priv.status).toBe('needs_user')
    expect(priv.detail).toMatch(/does not ask for it/)
    expect(membershipRow('x', about({ user_is_subscriber: false, user_is_banned: true }), '').status).toBe('restricted')
    expect(membershipRow('x', about({ user_is_subscriber: null }), '')).toMatchObject({ status: 'needs_check', detail: expect.stringContaining('did not say') })
    expect(membershipRow('x', null, 'access denied, HTTP 403')).toMatchObject({ status: 'needs_check', detail: expect.stringContaining('access denied, HTTP 403') })
  })
})

describe('the assessment of a community whose post list Reddit refused', () => {
  it('explains the refusal once, and the rows that wait for it say so', async () => {
    const { ctx, page } = setup()
    page.routePage('/r/test/new.json', 403, BLOCK_PAGE)
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.status).toBe('unavailable')
    expect(caps.read_posts.detail).toContain('access denied (a network-security block page), HTTP 403')
    expect(caps.read_posts.detail).toMatch(/rules and numbers were read with the same sign-in, so the sign-in works/)
    expect(caps.read_posts.detail).not.toMatch(/boris|chart_notebook/)
    expect(caps.read_comments.detail).toMatch(/^Not tried: .*see Read posts/)
    expect(caps.detect_changes.status).toBe('needs_check')
    expect(caps.detect_changes.detail).toMatch(/^Not examined: it needs the post list/)
    // what the same sign-in could read stays verified, and a member is shown as one
    expect(caps.rules.status).toBe('verified')
    expect(caps.metrics.status).toBe('verified')
    expect(caps.membership).toMatchObject({ status: 'verified', detail: 'This account is a member of r/test.' })
  })

  it('names the missing membership when the community refuses the post list to a non-member', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/about.json', aboutJson({ user_is_subscriber: false }))
    page.route('/r/test/new.json', { reason: 'private', message: 'Forbidden', error: 403 }, 403)
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.detail).toMatch(/access denied \(private\), HTTP 403/)
    expect(caps.read_posts.detail).toMatch(/has not joined r\/test yet \(see Membership\)/)
    expect(caps.membership.status).toBe('needs_check')
  })

  it('says the community\'s other pages were refused too when nothing could be read', async () => {
    const { ctx, page } = setup()
    for (const path of ['/r/test/new.json', '/r/test/about.json', '/r/test/about/rules.json']) page.route(path, { message: 'Forbidden' }, 403)
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.detail).toMatch(/other pages were refused too/)
    expect(caps.membership.status).toBe('needs_check')
    expect(caps.membership.detail).toMatch(/could not be read \(access denied \(Forbidden\), HTTP 403\)/)
  })

  it('keeps the status it had: only an access refusal is unavailable, anything else waits for a check', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/new.json', {}, 500)
    const caps = byKey(await connector.assess(ctx))
    expect(caps.read_posts.status).toBe('needs_check')
    expect(caps.read_posts.detail).toMatch(/Reddit server error/)
    expect(caps.read_comments.status).toBe('needs_check')
  })
})

describe('the membership row in a healthy assessment', () => {
  it('shows a not-joined account as waiting for a decision, not as a failure of the others', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/about.json', aboutJson({ user_is_subscriber: false }))
    const caps = byKey(await connector.assess(ctx))
    expect(caps.membership.status).toBe('needs_check')
    expect(caps.read_posts.status).toBe('verified')
    expect(caps.read_comments.status).toBe('verified')
  })

  it('is read through the community page with the account\'s cookies and changes nothing', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/about.json', aboutJson({ user_is_subscriber: false, subreddit_type: 'restricted' }))
    expect(await connector.membership!(ctx)).toEqual({ member: false, banned: false, access: 'restricted' })
    expect(page.writes).toEqual([])
  })

  it('says it could not read the community instead of guessing', async () => {
    const { ctx, page } = setup()
    page.route('/r/test/about.json', { message: 'Forbidden' }, 403)
    await expect(connector.membership!(ctx)).rejects.toThrow(/Could not read r\/test: access denied \(Forbidden\), HTTP 403/)
  })
})
