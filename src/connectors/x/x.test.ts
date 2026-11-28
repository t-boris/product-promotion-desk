import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/db/database'
import { byHost } from '../../core/net/fake-s3'
import { SIGN_IN_CALLBACK, createSignInListener } from '../../core/net/sign-in-listener'
import { sendWays } from '../../core/pipeline/send-ways'
import { makeTestCore, type TestCore } from '../../core/testing/fakes'
import { apiKeyKey } from '../../core/vault'
import type { MonitorService } from '../../core/services'
import type { PublishRequest } from '../../core/ports'
import { guideSteps } from '../../shared/connection-guide'
import { renderForPlatform, sendPriceNote, sendProblems } from '../../shared/post-format'
import { UniversalConnector } from '../universal'
import { XApiConnector, parseExternalId, profileOf } from './connector'
import { FAKE_X_CLIENT, FakeX } from './fake-x'

let t: TestCore | null = null
const dirs: string[] = []
afterEach(async () => {
  await t?.core.shutdown()
  t = null
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PROFILE_URL = 'https://x.com/natalmystic'
const HOUR = 3_600_000
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

/** A core with the X API connector; a fake X behind its API host; the sign-in answers on a free port of this machine; one product. */
function world() {
  const x = new FakeX()
  t = makeTestCore({ connectors: [new XApiConnector(), new UniversalConnector()], http: byHost({ 'api.x.com': x }), signInListener: createSignInListener(0) })
  const core = t.core
  const browser = t.browser
  x.now = () => core.clock.now()
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goals_json, active_passport_version_id, analysis_status, created_at, updated_at, add_site_link) VALUES (?, ?, ?, ?, json_array(), ?, ?, ?, ?, 0)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)
  const logged = (): string => JSON.stringify(core.db.prepare('SELECT * FROM log_events').all())
  const call = core.router.call.bind(core.router) as typeof core.router.call
  /** The page the application opened in the account's browser for the sign-in, once it has. */
  const signInPage = async (accountId: string, after = 0): Promise<string> => {
    for (let i = 0; i < 400; i += 1) {
      const opened = browser.opened.slice(after).find((o) => o.accountId === accountId && (o.url ?? '').startsWith('https://x.com/i/oauth2/authorize'))
      if (opened?.url) return opened.url
      await tick()
    }
    throw new Error('the sign-in page was never opened')
  }
  /** The whole sign-in: the application opens X's page, the owner allows it there, X sends the browser back to this machine. */
  const signIn = async (accountId: string, keyId = FAKE_X_CLIENT) => {
    const before = browser.opened.length
    const done = call('vault.signIn', { accountId, keyId })
    done.catch(() => undefined)
    const allowed = x.authorize(await signInPage(accountId, before))
    await fetch(`${allowed.redirectUri}?state=${encodeURIComponent(allowed.state)}&code=${allowed.code}`)
    return done
  }
  return { core, x, productId, secrets: t.secrets, clock: t.clock, browser, logged, call, signIn, signInPage }
}

/** An X account that signed in, with its own profile connected, assessed and active. */
async function connected() {
  const w = world()
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'x', label: 'Natal Mystic on X', access: 'api' })
  const ready = await w.signIn(account.id)
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: PROFILE_URL })
  await w.call('channels.assess', { channelId: channel.id })
  const active = await w.call('channels.activate', { channelId: channel.id })
  const { connector, ctx } = w.core.connectorContext(active.id)
  const loose = { ...ctx, tickets: { assertValid: () => undefined } }
  const ticket = { id: 't', actionId: 'a', contentHash: 'h', accountId: ready.id, destination: active.url, expiresAt: 0, signature: '' }
  const request = (given: Partial<PublishRequest>): PublishRequest => ({ kind: 'post', destination: active.url, parentExternalId: null, title: null, text: '', link: null, attachments: [], ...given })
  const send = (given: Partial<PublishRequest>) => connector.publish(loose, ticket, request(given))
  const kept = () => JSON.parse(w.secrets.values.get(apiKeyKey(account.id)) ?? '{}') as { c: string; a: string; r: string }
  const refreshes = () => w.x.calls.filter((c) => c.path === 'oauth2/token' && (c.body as { grant_type?: string }).grant_type === 'refresh_token').length
  return { ...w, account: ready, channel: active, connector, ctx, send, request, kept, refreshes, monitor: w.core.services.monitor as MonitorService }
}

function file(name: string, mime: string, bytes = 12) {
  const dir = mkdtempSync(join(tmpdir(), 'ppd-x-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, 'x')
  truncateSync(path, bytes)
  return { name, path, mime, sha256: 'x' }
}
const picture = (name = 'chart.png', mime = 'image/png', bytes = 12) => file(name, mime, bytes)

describe('the address of an X profile', () => {
  it('is a profile, on x.com or twitter.com, and never a post or a page of X itself', () => {
    expect(profileOf('https://x.com/NatalMystic')).toBe('natalmystic')
    expect(profileOf('x.com/natalmystic/')).toBe('natalmystic')
    expect(profileOf('https://twitter.com/natal_mystic?lang=en')).toBe('natal_mystic')
    expect(profileOf('https://mobile.x.com/@natalmystic')).toBe('natalmystic')
    expect(profileOf('https://x.com/natalmystic/status/1800000000000000000')).toBeNull()
    expect(profileOf('https://x.com/home')).toBeNull()
    expect(profileOf('https://x.com/i/lists/1')).toBeNull()
    expect(profileOf('https://x.com/search?q=astrology')).toBeNull()
    expect(profileOf('https://x.com/a_name_that_is_too_long')).toBeNull()
    expect(profileOf('https://www.instagram.com/natalmystic/')).toBeNull()
    expect(parseExternalId('x:1800000000000000000')).toBe('1800000000000000000')
    expect(parseExternalId('pin:1')).toBeNull()
  })
})

describe('an X account that works through X\'s API (DEC-086)', () => {
  it('is offered for X beside the browser account, is connected by a sign-in, and says what it costs', async () => {
    const w = world()
    const info = (await w.call('platforms.list', undefined as never)).find((p) => p.platform === 'x')
    expect(info).toMatchObject({ connectorId: 'universal', api: { accountKind: 'developer app', keyLabel: 'Sign-in with X', keyId: { label: 'Client ID' }, signIn: { label: 'Sign in with X' }, renews: true, work: expect.stringMatching(/posts on X.*charges your developer app.*Replies and mentions are not read/s) } })
    expect(w.core.connectors.resolve(PROFILE_URL)?.id).toBe('universal')
    const steps = guideSteps(info, { kind: null, access: 'api' })
    expect(steps.length).toBe(4)
    expect(steps.map((s) => s.text).join(' ')).toMatch(/paid from credits.*\$0\.015.*\$0\.20.*half a cent.*30 days after a post: about \$0\.15 a post.*a cent on a day it checks who signed in.*auto-recharge.*OAuth 2\.0.*Native App.*http:\/\/127\.0\.0\.1:47821\/signin.*Client ID.*Sign in with X.*Authorize app.*renews it by itself/s)
    expect(steps.map((s) => s.text).join(' ')).toContain(SIGN_IN_CALLBACK)
  })

  it('signs in through X\'s own page in the account\'s browser, keeps what X gives in the vault only, and becomes ready under the account\'s name', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'x', label: 'Natal Mystic on X', access: 'api' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: 'anything' })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/connected by a sign-in.*Sign in with X/) })
    await expect(w.call('vault.signIn', { accountId: account.id, keyId: ' ' })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/The Client ID is required/) })

    const done = w.call('vault.signIn', { accountId: account.id, keyId: ` ${FAKE_X_CLIENT} ` })
    const page = new URL(await w.signInPage(account.id))
    // The page is X's own, opened with the app's id, the address on this machine, a random word and the S256 challenge.
    expect(`${page.origin}${page.pathname}`).toBe('https://x.com/i/oauth2/authorize')
    expect(Object.fromEntries(page.searchParams)).toMatchObject({ response_type: 'code', client_id: FAKE_X_CLIENT, scope: 'tweet.read tweet.write users.read media.write offline.access', code_challenge_method: 'S256' })
    expect(page.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/signin$/)
    expect(page.searchParams.get('state')?.length).toBeGreaterThanOrEqual(32)
    expect(page.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(page.href).not.toContain('+')
    // A second sign-in of the same account does not start while this one waits.
    await expect(w.call('vault.signIn', { accountId: account.id, keyId: FAKE_X_CLIENT })).rejects.toMatchObject({ code: 'invalid_state', message: expect.stringMatching(/going on already/) })
    const allowed = w.x.authorize(page.href)
    expect((await fetch(`${allowed.redirectUri}?state=${allowed.state}&code=${allowed.code}`)).status).toBe(200)
    const ready = await done
    expect(ready).toMatchObject({ status: 'ready', identity: '@NatalMystic' })
    const kept = JSON.parse(w.secrets.values.get(apiKeyKey(account.id)) ?? '{}') as { c: string; a: string; r: string }
    expect(kept).toMatchObject({ c: FAKE_X_CLIENT, a: expect.stringMatching(/^access_/), r: expect.stringMatching(/^refresh_/) })
    expect((await w.call('vault.status', undefined as never)).apiKeyAccountIds).toEqual([account.id])
    // Nothing of the exchange is logged: no token, no code, no verifier, no state.
    const log = w.logged()
    for (const secret of [kept.a, kept.r, allowed.code, allowed.state]) expect(log).not.toContain(secret)
    expect(log).toMatch(/A sign-in with X was saved for Natal Mystic on X\./)
    expect(log).toMatch(/The sign-in of Natal Mystic on X was started/)
  })

  it('says why a sign-in did not happen: stopped, refused on X\'s page, or an app X does not know', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'x', label: 'Natal Mystic on X', access: 'api' })
    const stopped = w.call('vault.signIn', { accountId: account.id, keyId: FAKE_X_CLIENT })
    stopped.catch(() => undefined)
    await w.signInPage(account.id)
    await w.call('vault.stopSignIn', { accountId: account.id })
    await expect(stopped).rejects.toMatchObject({ code: 'sign_in_failed', message: 'The sign-in was stopped.' })

    // The owner pressed "Cancel" on X's page: X sends the browser back with its refusal and no code.
    let before = w.browser.opened.length
    const refused = w.call('vault.signIn', { accountId: account.id, keyId: FAKE_X_CLIENT })
    refused.catch(() => undefined)
    const page = new URL(await w.signInPage(account.id, before))
    await fetch(`${page.searchParams.get('redirect_uri')}?state=${page.searchParams.get('state')}&error=access_denied`)
    await expect(refused).rejects.toMatchObject({ code: 'sign_in_failed', message: expect.stringMatching(/did not allow it \(access_denied\). Nothing was saved/) })

    // A Client ID that is not the app's: X's page would refuse it; here the exchange does.
    w.x.clientId = 'YW5vdGhlckNsaWVudElkT2ZBbm90aGVyQXBw'
    before = w.browser.opened.length
    const wrong = w.call('vault.signIn', { accountId: account.id, keyId: FAKE_X_CLIENT })
    wrong.catch(() => undefined)
    const other = new URL(await w.signInPage(account.id, before))
    w.x.clientId = FAKE_X_CLIENT
    const allowed = w.x.authorize(other.href)
    w.x.clientId = 'YW5vdGhlckNsaWVudElkT2ZBbm90aGVyQXBw'
    await fetch(`${allowed.redirectUri}?state=${allowed.state}&code=${allowed.code}`)
    await expect(wrong).rejects.toMatchObject({ code: 'sign_in_failed', message: expect.stringMatching(/X did not finish the sign-in.*Native App.*callback address is http:\/\/127\.0\.0\.1:47821\/signin.*Nothing was saved/s) })
    expect(w.secrets.values.has(apiKeyKey(account.id))).toBe(false)
    expect((await w.call('accounts.list', undefined as never)).find((a) => a.id === account.id)?.status).not.toBe('ready')
  })

  it('connects the signed-in profile as a channel for the owner\'s own posts: not read, not watched in a browser, and says what X charges', async () => {
    const w = await connected()
    expect(w.channel).toMatchObject({ status: 'active', connectorId: 'x-api', target: '@natalmystic', url: PROFILE_URL, reads: false, watchedInBrowser: false, baselineDoneAt: null })
    const caps = Object.fromEntries((await w.call('channels.assess', { channelId: w.channel.id })).capabilities.map((c) => [c.key, c]))
    expect(caps.publish_post).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/go out as @NatalMystic.*up to 4 pictures.*one GIF.*\$0\.015.*\$0\.20 with a link\) and for reading its numbers.*video and a quote are published on X itself/s) })
    for (const key of ['read_posts', 'read_comments', 'publish_reply']) expect(caps[key]).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/not read through X's API.*only to a person who mentioned the account/s) })
    expect(caps.metrics).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/Under each post.*likes, replies and views for 30 days.*half a cent.*about \$0\.15 a post/s) })
    // Another's profile is not posted to.
    const other = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://x.com/somebody' })
    expect((await w.call('channels.assess', { channelId: other.id })).capabilities.find((c) => c.key === 'publish_post')).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/sign-in is of @NatalMystic, and this channel is the profile of @somebody/) })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://x.com/natalmystic/status/1' })).rejects.toMatchObject({ code: 'platform_mismatch', message: expect.stringMatching(/It takes the address of the profile that signed in.*https:\/\/x\.com\/yourbrand/s) })
    // A check of the channel reads nothing that X would charge for.
    const before = w.x.calls.length
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    expect(w.x.calls.slice(before).filter((c) => c.path !== 'users/me')).toEqual([])
    expect(sendWays(w.core, undefined, w.channel)).toMatchObject({ aiBrowser: false, api: true })
  })

  it('renews the two-hour access token when it is used after its end, once for requests that come together, and keeps the new pair', async () => {
    const w = await connected()
    const first = w.kept()
    expect(await w.send({ text: 'Within two hours.' })).toMatchObject({ status: 'confirmed' })
    expect(w.refreshes()).toBe(0)
    w.clock.advance(2 * HOUR + 60_000)
    const [a, b] = await Promise.all([w.send({ text: 'After two hours, one.' }), w.send({ text: 'After two hours, two.' })])
    expect([a.status, b.status]).toEqual(['confirmed', 'confirmed'])
    expect(w.refreshes()).toBe(1)
    const second = w.kept()
    expect(second.a).not.toBe(first.a)
    expect(second.r).not.toBe(first.r)
    expect(w.x.refresh.has(first.r)).toBe(false)
    // The daily renewal keeps an unused sign-in alive, and does not fill the log with it.
    w.clock.advance(26 * HOUR)
    expect(await (w.core.services.keys as { renewDue(): Promise<number> }).renewDue()).toBe(1)
    expect(w.kept().r).not.toBe(second.r)
    expect(w.logged()).not.toMatch(/sign-in with X of Natal Mystic on X was renewed/)
    for (const secret of [first.a, first.r, second.a, second.r]) expect(w.logged()).not.toContain(secret)
    // X no longer takes the refresh token (the app's access was withdrawn on X): nothing is sent, and the account asks for a sign-in.
    w.x.refresh.clear()
    w.clock.advance(3 * HOUR)
    expect(await w.send({ text: 'After the access was withdrawn.' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/no longer accepts the saved sign-in.*Sign in with X.*Nothing was sent/s) })
    expect(await w.call('accounts.checkLogin', { accountId: w.account.id })).toMatchObject({ status: 'login_required' })
    // Signing in again makes it ready, and the next post goes out.
    expect(await w.signIn(w.account.id)).toMatchObject({ status: 'ready' })
    expect(await w.send({ text: 'After signing in again.' })).toMatchObject({ status: 'confirmed' })
  })
})

describe('posting on X', () => {
  it('sends words, pictures in their order, or one GIF, and returns the post\'s address', async () => {
    const w = await connected()
    const out = await w.send({ text: 'What a natal chart shows.' })
    expect(out).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^x:\d+$/), url: expect.stringMatching(/^https:\/\/x\.com\/NatalMystic\/status\/\d+$/) })
    expect(w.x.calls.filter((c) => c.method === 'POST' && c.path === 'tweets').at(-1)?.body).toEqual({ text: 'What a natal chart shows.' })
    expect(await w.send({ text: 'Two charts.', attachments: [picture('one.png'), picture('two.jpg', 'image/jpeg')] })).toMatchObject({ status: 'confirmed' })
    expect(w.x.posts[0]).toMatchObject({ text: 'Two charts.', media: ['one.png', 'two.jpg'] })
    expect([...w.x.uploads.values()].map((u) => u.category)).toEqual(['tweet_image', 'tweet_image'])
    expect(await w.send({ attachments: [picture('moon.gif', 'image/gif')] })).toMatchObject({ status: 'confirmed' })
    expect([...w.x.uploads.values()].at(-1)).toEqual({ name: 'moon.gif', category: 'tweet_gif' })
    expect(w.logged()).not.toContain(w.kept().a)
  })

  it('refuses before asking X what a post cannot be, and says the video and the price before the approval', async () => {
    const w = await connected()
    const made = () => w.x.calls.filter((c) => c.method === 'POST' && (c.path === 'tweets' || c.path === 'media/upload')).length
    expect(await w.send({})).toMatchObject({ status: 'failed', error: expect.stringMatching(/nothing to post/) })
    expect(await w.send({ text: 'A clip', attachments: [file('clip.mp4', 'video/mp4')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/“clip.mp4” is none of them.*video is published on X itself/s) })
    expect(await w.send({ attachments: [1, 2, 3, 4, 5].map((n) => picture(`${n}.png`)) })).toMatchObject({ status: 'failed', error: expect.stringMatching(/at most 4 pictures in a post; this one has 5/) })
    expect(await w.send({ attachments: [picture('moon.gif', 'image/gif'), picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/one GIF in a post, with no other picture/) })
    expect(await w.send({ attachments: [picture('big.png', 'image/png', 5 * 1024 * 1024 + 1)] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/up to 5 MB through its API; “big.png” is 6 MB/) })
    expect(await w.send({ attachments: [{ name: 'gone.png', path: '/nonexistent/gone.png', mime: 'image/png', sha256: 'x' }] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be read from this Mac/) })
    expect(await w.send({ kind: 'reply', parentExternalId: 'x:1', text: 'Thanks!' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/only to a person who mentioned the account.*Nothing was sent/s) })
    expect(made()).toBe(0)

    const ways = sendWays(w.core, undefined, w.channel)
    const video = renderForPlatform({ title: null, text: 'A clip', link: null, attachments: [{ name: 'clip.mp4', mime: 'video/mp4' }] } as never, 'x')
    expect(sendProblems('x', video, ways).join(' ')).toMatch(/A video is not sent to X through its API by this application/)
    // The price of the send, by whether the post has an address in it; nothing is said of money for a browser channel or another platform.
    const plain = renderForPlatform({ title: null, text: 'Words only.', link: null, attachments: [] } as never, 'x')
    const linked = renderForPlatform({ title: null, text: 'Read it.', link: 'https://natalmystic.com/how', attachments: [] } as never, 'x')
    expect(sendPriceNote('x', plain, ways)).toBe("X charges your developer app about $0.015 for this post ($0.20 if it had a link), and about $0.005 on each day its numbers are read: 30 days after it goes out, about $0.15. This is X's price list of 28 November 2026; today's prices are in its Developer Console.")
    expect(sendPriceNote('x', linked, ways)).toMatch(/about \$0\.20 for this post, because it has a link \(\$0\.015 without one\), and about \$0\.005 on each day/)
    expect(sendPriceNote('x', plain, { aiBrowser: true, noConnector: true })).toBeNull()
    expect(sendPriceNote('linkedin', plain, ways)).toBeNull()
  })

  it('says what X refused, and that the outcome is unknown when its answer was lost or held no id', async () => {
    const w = await connected()
    w.x.failNext = { status: 402, title: 'Payment Required', detail: 'Your account does not have enough credits.', type: 'https://api.x.com/2/problems/usage-capped' }
    expect(await w.send({ text: 'One' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/reason of payment \(Your account does not have enough credits\.\).*Developer Console.*Nothing was sent/s) })
    w.x.failNext = { status: 403, title: 'Forbidden', detail: 'You are not allowed to create a Tweet with duplicate content.' }
    expect(await w.send({ text: 'One' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/does not allow it \(You are not allowed to create a Tweet with duplicate content\.\)/) })
    w.x.failNext = { status: 429, title: 'Too Many Requests', detail: 'Too Many Requests' }
    expect(await w.send({ text: 'One' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/asks to wait/) })
    w.x.failNext = { status: 400, title: 'Invalid Request', detail: 'media type unrecognized.', on: 'upload' }
    expect(await w.send({ text: 'One', attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/media type unrecognized.*“chart.png” was not taken.*Nothing was sent/s) })
    expect(w.x.posts).toHaveLength(0)
    w.x.failNext = { status: 503, title: 'Service Unavailable', detail: 'Over capacity' }
    expect(await w.send({ text: 'One' })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/error of its own.*not known whether the post was made/s) })
    w.x.namesPosts = false
    expect(await w.send({ text: 'No id' })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/returned no id/) })
    w.x.namesPosts = true

    // The answer is lost after X made the post: it is found among the newest by its words, though X rewrote the address in them.
    w.x.failNext = 'lost'
    const attemptedAt = w.core.clock.now().toISOString()
    const lost = { text: 'Read how it is built.\n\nhttps://natalmystic.com/how' }
    expect(await w.send(lost)).toMatchObject({ status: 'unknown', error: expect.stringMatching(/did not answer.*not known whether the post was made/s) })
    const post = w.x.posts[0]
    expect(post?.text).toContain('https://t.co/')
    expect(await w.connector.findPublished?.(w.ctx, w.request({ ...lost, attemptedAt }))).toEqual({ url: `https://x.com/NatalMystic/status/${post?.id}`, externalId: `x:${post?.id}` })
    expect(await w.connector.findPublished?.(w.ctx, w.request({ text: 'Other words.', attemptedAt }))).toBeNull()
    w.clock.advance(HOUR)
    expect(await w.connector.findPublished?.(w.ctx, w.request({ ...lost, attemptedAt: w.core.clock.now().toISOString() }))).toBeNull()
  })

  it('reads likes, replies and views under its posts in one request', async () => {
    const w = await connected()
    const one = (await w.send({ text: 'One' })) as { externalId: string; url: string }
    const two = (await w.send({ text: 'Two' })) as { externalId: string; url: string }
    w.x.numbers[parseExternalId(one.externalId) as string] = { like_count: 7, reply_count: 2, impression_count: 310 }
    const before = w.x.calls.length
    const asked = [one, two, { externalId: 'x:999', url: null }, { externalId: 'pin:1', url: null }].map((p) => ({ externalId: p.externalId, url: p.url }))
    expect(await w.connector.readPostNumbers?.(w.ctx, asked)).toEqual({ [one.externalId]: { likes: 7, comments: 2, views: 310 }, [two.externalId]: { likes: 0, comments: 0, views: 0 } })
    expect(w.x.calls.slice(before).map((c) => c.path.split('?')[0])).toEqual(['tweets'])
    expect(await w.call('results.posts', { channelId: w.channel.id })).toMatchObject({ readable: true, byAi: false })
  })
})
