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
    expect(info).toMatchObject({ connectorId: 'universal', api: { accountKind: 'developer app', keyLabel: 'Sign-in with X', keyId: { label: 'Client ID' }, signIn: { label: 'Sign in with X' }, renews: true, work: expect.stringMatching(/works on X as the signed-in account.*reads the replies.*sends your answers.*numbers under each post.*charges your developer app/s) } })
    expect(w.core.connectors.resolve(PROFILE_URL)?.id).toBe('universal')
    const steps = guideSteps(info, { kind: null, access: 'api' })
    expect(steps.length).toBe(4)
    expect(steps.map((s) => s.text).join(' ')).toMatch(/paid from credits.*\$0\.015.*\$0\.20.*\$0\.01 for each answer.*tenth of a cent.*five times that.*about \$0\.03.*name of each person.*a cent on a day the application checks who signed in.*auto-recharge.*OAuth 2\.0.*Native App.*http:\/\/127\.0\.0\.1:47821\/signin.*Client ID.*Sign in with X.*Authorize app.*renews it by itself/s)
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

  it('connects the signed-in profile as a channel the application reads: its posts and the replies to them, never watched in a browser, and says what X charges', async () => {
    const w = await connected()
    expect(w.channel).toMatchObject({ status: 'active', connectorId: 'x-api', target: '@natalmystic', url: PROFILE_URL, reads: true, watchedInBrowser: false })
    const caps = Object.fromEntries((await w.call('channels.assess', { channelId: w.channel.id })).capabilities.map((c) => [c.key, c]))
    expect(caps.publish_post).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/go out as @NatalMystic.*up to 4 pictures.*one GIF.*\$0\.015.*\$0\.20 with a link\).*video and a quote are published on X itself/s) })
    expect(caps.read_posts).toMatchObject({ status: 'verified', detail: expect.stringMatching(/posts of @NatalMystic of the last 30 days are read from X/) })
    expect(caps.read_comments).toMatchObject({ status: 'verified', detail: expect.stringMatching(/Replies to the posts of @NatalMystic are read from X: those that name the account.*tenth of a cent/s) })
    expect(caps.publish_reply).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/answer goes under a reply as @NatalMystic.*only a post that names the account.*\$0\.01/s) })
    expect(caps.metrics).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/Under each post.*likes, replies and views for 30 days.*tenth of a cent.*about \$0\.03 a post/s) })
    expect(caps.read_inbox).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/arrive as replies to the account's posts.*names the account is not collected/s) })
    // Another's profile is neither read nor posted to.
    const other = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://x.com/somebody' })
    const others = (await w.call('channels.assess', { channelId: other.id })).capabilities
    for (const key of ['publish_post', 'read_posts', 'read_comments']) expect(others.find((c) => c.key === key)).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/sign-in is of @NatalMystic, and this channel is the profile of @somebody/) })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://x.com/natalmystic/status/1' })).rejects.toMatchObject({ code: 'platform_mismatch', message: expect.stringMatching(/It takes the address of the profile that signed in.*https:\/\/x\.com\/yourbrand/s) })
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
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
    expect(await w.send({ kind: 'reply', parentExternalId: 'pin:1', text: 'Thanks!' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/was not read through X's API.*Nothing was sent/s) })
    expect(await w.send({ kind: 'reply', parentExternalId: 'x:1', text: ' ' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/nothing to answer with/) })
    expect(made()).toBe(0)

    const ways = sendWays(w.core, undefined, w.channel)
    const video = renderForPlatform({ title: null, text: 'A clip', link: null, attachments: [{ name: 'clip.mp4', mime: 'video/mp4' }] } as never, 'x')
    expect(sendProblems('x', video, ways).join(' ')).toMatch(/A video is not sent to X through its API by this application/)
    // The price of the send, by whether the post has an address in it; nothing is said of money for a browser channel or another platform.
    const plain = renderForPlatform({ title: null, text: 'Words only.', link: null, attachments: [] } as never, 'x')
    const linked = renderForPlatform({ title: null, text: 'Read it.', link: 'https://natalmystic.com/how', attachments: [] } as never, 'x')
    expect(sendPriceNote('x', plain, ways)).toBe("X charges your developer app about $0.015 for this post ($0.20 if it had a link), and about $0.001 on each day its numbers are read: 30 days after it goes out, about $0.03. This is X's price list of 28 November 2026; today's prices are in its Developer Console.")
    expect(sendPriceNote('x', linked, ways)).toMatch(/about \$0\.20 for this post, because it has a link \(\$0\.015 without one\), and about \$0\.001 on each day/)
    // An answer has one price, said by the application where an answer is approved; a channel worked in a browser has none.
    expect(await w.call('channels.replyPrice', { channelId: w.channel.id })).toBe("X charges your developer app about $0.01 for this answer. This is X's price list of 28 November 2026; today's prices are in its Developer Console.")
    expect(sendPriceNote('x', linked, ways, 'reply')).toMatch(/about \$0\.01 for this answer/)
    await expect(w.call('channels.replyPrice', { channelId: 'nobody' })).rejects.toMatchObject({ code: 'not_found' })
    expect(sendPriceNote('x', plain, { aiBrowser: true, noConnector: true })).toBeNull()
    expect(sendPriceNote('x', plain, { aiBrowser: true, noConnector: true }, 'reply')).toBeNull()
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

  it('reads likes, replies and views under its posts in one request, from the account\'s own list of posts', async () => {
    const w = await connected()
    const one = (await w.send({ text: 'One' })) as { externalId: string; url: string }
    const two = (await w.send({ text: 'Two' })) as { externalId: string; url: string }
    w.x.numbers[parseExternalId(one.externalId) as string] = { like_count: 7, reply_count: 2, impression_count: 310 }
    const before = w.x.calls.length
    const asked = [one, two, { externalId: 'x:999', url: null }, { externalId: 'pin:1', url: null }].map((p) => ({ externalId: p.externalId, url: p.url }))
    expect(await w.connector.readPostNumbers?.(w.ctx, asked)).toEqual({ [one.externalId]: { likes: 7, comments: 2, views: 310 }, [two.externalId]: { likes: 0, comments: 0, views: 0 } })
    const reads = w.x.calls.slice(before)
    expect(reads.map((c) => c.path.split('?')[0])).toEqual([`users/${w.x.user.id}/tweets`])
    const query = new URLSearchParams(reads[0]?.path.split('?')[1])
    // Between the oldest and the newest of the posts asked for, without answers and reposts.
    expect([query.get('since_id'), query.get('exclude'), query.get('tweet.fields')]).toEqual(['998', 'retweets,replies', 'public_metrics'])
    expect(BigInt(query.get('until_id') ?? '0')).toBe(BigInt(parseExternalId(two.externalId) as string) + BigInt(1))
    expect(await w.call('results.posts', { channelId: w.channel.id })).toMatchObject({ readable: true, byAi: false })
  })
})

describe('replies on X', () => {
  const DAY = 24 * HOUR
  const itemsOf = (w: Awaited<ReturnType<typeof connected>>) =>
    w.core.db.prepare('SELECT c.external_id AS comment, c.author, c.body FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE o.channel_id = ? ORDER BY c.external_id').all(w.channel.id)

  it('reads a reply to the account\'s post as an item to answer, sends the answer under it, and takes the account\'s own words as nobody to answer', async () => {
    const w = await connected()
    const post = (await w.send({ text: 'What does a natal chart show?' })) as { externalId: string; url: string }
    const postId = parseExternalId(post.externalId) as string
    w.clock.advance(60_000)
    const first = w.x.replies(postId, 'Does it need the exact birth time?', 'ann_lee')
    w.clock.advance(60_000)
    const second = w.x.replies(postId, 'Beautiful.', 'bo')
    // Not collected: a post of somebody else that names the account. Not read at all: a reply whose writer took the name out.
    w.x.mentions('Have you seen this app?', 'cy')
    const quiet = w.x.replies(postId, 'No name in this one.', 'dee', { names: false })
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    // X puts the answered name first in a reply; the application keeps the words as X's pages show them.
    expect(itemsOf(w)).toEqual([
      { comment: `x:${first.id}`, author: '@ann_lee', body: 'Does it need the exact birth time?' },
      { comment: `x:${second.id}`, author: '@bo', body: 'Beautiful.' }
    ])

    const answer = await w.send({ kind: 'reply', parentExternalId: `x:${first.id}`, destination: `https://x.com/ann_lee/status/${first.id}`, text: 'Yes, to the minute.' })
    expect(answer).toMatchObject({ status: 'confirmed', url: expect.stringMatching(/^https:\/\/x\.com\/NatalMystic\/status\/\d+$/) })
    expect(w.x.calls.filter((c) => c.method === 'POST' && c.path === 'tweets').at(-1)?.body).toEqual({ text: 'Yes, to the minute.', reply: { in_reply_to_tweet_id: first.id } })
    expect(w.x.posts[0]).toMatchObject({ replyTo: first.id, text: '@ann_lee Yes, to the minute.' })
    const thread = await w.connector.fetchThread(w.ctx, post.externalId)
    expect(thread).toMatchObject({ externalId: post.externalId, url: post.url, author: '@NatalMystic', body: 'What does a natal chart show?', title: 'What does a natal chart show?' })
    expect(thread?.incomplete).toBeUndefined()
    expect(thread?.comments.map((c) => [c.author, c.body, c.parentExternalId])).toEqual([
      ['@ann_lee', 'Does it need the exact birth time?', post.externalId],
      ['@bo', 'Beautiful.', post.externalId],
      ['@NatalMystic', 'Yes, to the minute.', `x:${first.id}`]
    ])
    expect(thread?.comments[0]?.url).toBe(`https://x.com/ann_lee/status/${first.id}`)
    // The account's own answer is nobody to answer.
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    expect(itemsOf(w)).toHaveLength(2)

    // X takes an answer only to a post that names the account: its refusal is said with the rule, and nothing is sent.
    const posts = w.x.posts.length
    expect(await w.send({ kind: 'reply', parentExternalId: `x:${quiet.id}`, text: 'Hello!' })).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/X does not allow it \(Reply to this conversation is not allowed.*\)\. X lets an app answer only a post that names the account.*Answer this one on X\. Nothing was sent\./s)
    })
    expect(w.x.posts).toHaveLength(posts)

    // The answer to a sent reply is lost: it is found under the reply it answers, by its words.
    w.x.failNext = 'lost'
    const attemptedAt = w.core.clock.now().toISOString()
    const lost = { kind: 'reply' as const, parentExternalId: `x:${second.id}`, text: 'Thank you!' }
    expect(await w.send(lost)).toMatchObject({ status: 'unknown', error: expect.stringMatching(/not known whether the answer was made/) })
    expect(await w.connector.findPublished?.(w.ctx, w.request({ ...lost, attemptedAt }))).toEqual({ url: `https://x.com/NatalMystic/status/${w.x.posts[0]?.id}`, externalId: `x:${w.x.posts[0]?.id}` })
    expect(await w.connector.findPublished?.(w.ctx, w.request({ ...lost, parentExternalId: `x:${first.id}`, attemptedAt }))).toBeNull()
    await expect(w.connector.findPublished?.(w.ctx, w.request({ ...lost, parentExternalId: null, attemptedAt }))).rejects.toThrow(/was not read through X's API/)
  })

  it('asks X only for what is newer than what it read, page by page, and for an older post by its id', async () => {
    const w = await connected()
    w.x.pageSize = 2
    const sent: { externalId: string }[] = []
    for (const text of ['One', 'Two', 'Three', 'Four', 'Five']) {
      sent.push((await w.send({ text })) as { externalId: string })
      w.clock.advance(60_000)
    }
    const firstId = parseExternalId(sent[0]?.externalId ?? '') as string
    w.x.replies(firstId, 'A reply.', 'ann_lee')
    const batch = await w.connector.fetchActivity(w.ctx, { limit: 25 })
    expect(batch.discussions.map((d) => d.body)).toEqual(['Five', 'Four', 'Three', 'Two', 'One'])
    expect(batch.discussions.at(-1)?.comments.map((c) => c.body)).toEqual(['A reply.'])
    expect((await w.connector.fetchActivity(w.ctx, { limit: 2 })).discussions.map((d) => d.body)).toEqual(['Five', 'Four'])
    // Nothing new: X gives nothing, so it charges nothing.
    const given = { ...w.x.given }
    await w.connector.fetchActivity(w.ctx, { limit: 25 })
    expect(w.x.given).toEqual(given)
    const asked = w.x.calls.filter((c) => c.method === 'GET').slice(-2).map((c) => new URLSearchParams(c.path.split('?')[1]))
    expect(asked.map((q) => [q.has('since_id'), q.has('start_time'), q.get('max_results')])).toEqual([[true, false, '100'], [true, false, '100']])
    expect(asked[0]?.get('exclude')).toBe('retweets')
    expect(asked[1]?.get('expansions')).toBe('author_id')
    // One new reply is the only post X gives the next time.
    w.x.replies(firstId, 'Another.', 'bo')
    const thread = await w.connector.fetchThread(w.ctx, sent[0]?.externalId ?? '')
    expect(thread?.comments.map((c) => c.body)).toEqual(['A reply.', 'Another.'])
    expect(w.x.given).toEqual({ ...given, named: given.named + 1 })
    // A reply is not a discussion of the channel, and neither is a post nobody made.
    expect(await w.connector.fetchThread(w.ctx, `x:${w.x.all[0]?.id}`)).toBeNull()
    expect(await w.connector.fetchThread(w.ctx, 'x:1')).toBeNull()
    expect(await w.connector.fetchThread(w.ctx, 'pin:1')).toBeNull()

    // After 30 days nothing of it is kept; the post is asked of X by its id, and its old replies are no longer read.
    w.clock.advance(31 * DAY)
    expect((await w.connector.fetchActivity(w.ctx, { limit: 25 })).discussions).toEqual([])
    const old = await w.connector.fetchThread(w.ctx, sent[0]?.externalId ?? '')
    expect(old).toMatchObject({ body: 'One', comments: [] })
    // Two posts were given by their ids: the reply that turned out to be nobody's discussion, and this one.
    expect(w.x.given.byId).toBe(given.byId + 2)
  })
})
