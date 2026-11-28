import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/db/database'
import { byHost } from '../../core/net/fake-s3'
import { sendWays } from '../../core/pipeline/send-ways'
import { makeTestCore, type TestCore } from '../../core/testing/fakes'
import { apiKeyKey } from '../../core/vault'
import type { MonitorService } from '../../core/services'
import type { PublishRequest } from '../../core/ports'
import { guideSteps } from '../../shared/connection-guide'
import { renderForPlatform, sendProblems } from '../../shared/post-format'
import { UniversalConnector } from '../universal'
import { PinterestApiConnector, boardOf, boardWords, parseExternalId } from './connector'
import { FAKE_PIN_APP_ID, FAKE_PIN_SECRET, FakePinterest } from './fake-pinterest'

let t: TestCore | null = null
const dirs: string[] = []
afterEach(async () => {
  await t?.core.shutdown()
  t = null
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const BOARD_URL = 'https://www.pinterest.com/natalmystic/natal-charts/'
const DAY = 24 * 3_600_000

/** A core with the Pinterest API connector; a fake Pinterest behind its API host; one product. */
function world() {
  const pinterest = new FakePinterest()
  t = makeTestCore({ connectors: [new PinterestApiConnector(), new UniversalConnector()], http: byHost({ 'api.pinterest.com': pinterest, 'pinterest-media-upload.s3-accelerate.amazonaws.com': pinterest }) })
  const core = t.core
  pinterest.now = () => core.clock.now()
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goals_json, active_passport_version_id, analysis_status, created_at, updated_at, add_site_link) VALUES (?, ?, ?, ?, json_array(), ?, ?, ?, ?, 0)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)
  const logged = (): string => JSON.stringify(core.db.prepare('SELECT * FROM log_events').all())
  return { core, pinterest, productId, secrets: t.secrets, clock: t.clock, logged, call: core.router.call.bind(core.router) as typeof core.router.call }
}

/** A Pinterest account with its app id and secret key saved and a board connected, assessed and active. */
async function connected(target = BOARD_URL) {
  const w = world()
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'pinterest', label: 'Natal Mystic on Pinterest', access: 'api' })
  const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_PIN_SECRET, keyId: FAKE_PIN_APP_ID })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target })
  await w.call('channels.assess', { channelId: channel.id })
  const active = await w.call('channels.activate', { channelId: channel.id })
  const { connector, ctx } = w.core.connectorContext(active.id)
  const loose = { ...ctx, tickets: { assertValid: () => undefined } }
  const ticket = { id: 't', actionId: 'a', contentHash: 'h', accountId: ready.id, destination: active.url, expiresAt: 0, signature: '' }
  const request = (given: Partial<PublishRequest>): PublishRequest => ({ kind: 'post', destination: active.url, parentExternalId: null, title: null, text: '', link: null, attachments: [], ...given })
  const send = (given: Partial<PublishRequest>) => connector.publish(loose, ticket, request(given))
  return { ...w, account: ready, channel: active, connector, ctx, send, request, monitor: w.core.services.monitor as MonitorService }
}

/** A file on this Mac of the given size. */
function file(name: string, mime: string, bytes = 12) {
  const dir = mkdtempSync(join(tmpdir(), 'ppd-pin-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, 'x')
  truncateSync(path, bytes)
  return { name, path, mime, sha256: 'x' }
}
const picture = (name = 'chart.png', mime = 'image/png', bytes = 12) => file(name, mime, bytes)
const tokensAsked = (w: { pinterest: FakePinterest }) => w.pinterest.calls.filter((c) => c.path === 'oauth/token').length

describe('the address of a Pinterest board', () => {
  it('is a board of an account, and never a profile, a pin or a page of Pinterest itself', () => {
    expect(boardOf('https://www.pinterest.com/NatalMystic/natal-charts/')).toEqual({ user: 'natalmystic', board: 'natal-charts' })
    expect(boardOf('pinterest.com/natalmystic/natal-charts')).toEqual({ user: 'natalmystic', board: 'natal-charts' })
    expect(boardOf('https://uk.pinterest.com/natalmystic/moon-stars/?x=1')).toEqual({ user: 'natalmystic', board: 'moon-stars' })
    expect(boardOf('https://www.pinterest.com/natalmystic/%D0%BB%D1%83%D0%BD%D0%B0/')).toEqual({ user: 'natalmystic', board: 'луна' })
    expect(boardOf('https://www.pinterest.com/natalmystic/')).toBeNull()
    expect(boardOf('https://www.pinterest.com/natalmystic/_saved/')).toBeNull()
    expect(boardOf('https://www.pinterest.com/pin/813460001/')).toBeNull()
    expect(boardOf('https://www.pinterest.com/ideas/astrology/')).toBeNull()
    expect(boardOf('https://www.pinterest.com/natalmystic/natal-charts/section/')).toBeNull()
    expect(boardOf('https://www.instagram.com/natalmystic/natal-charts/')).toBeNull()
    // A board's name reads in an address as its letters and digits with hyphens between.
    expect(boardWords('Moon & Stars!')).toBe('moon-stars')
    expect(boardWords('Natal Charts')).toBe('natal-charts')
    expect(boardWords('Луна')).toBe('луна')
    expect(parseExternalId('pin:813460001')).toBe('813460001')
    expect(parseExternalId('li:urn:li:share:1')).toBeNull()
  })
})

describe('a Pinterest account that works through Pinterest\'s API (DEC-085)', () => {
  it('is offered for Pinterest beside the browser account, asks for the app id beside the secret key, and is never chosen by an address alone', async () => {
    const w = world()
    const info = (await w.call('platforms.list', undefined as never)).find((p) => p.platform === 'pinterest')
    expect(info).toMatchObject({
      connectorId: 'universal',
      api: { accountKind: 'developer app', keyLabel: 'App secret key', keyId: { label: 'App id', hint: expect.stringMatching(/number under the app’s name/) }, work: expect.stringMatching(/creates pins on the boards.*no comments/s), channel: { example: 'https://www.pinterest.com/yourbrand/your-board/', hint: expect.stringMatching(/address of a board/) } }
    })
    expect(info?.api).not.toHaveProperty('keyDays')
    expect(info?.api).not.toHaveProperty('renews')
    expect(w.core.connectors.resolve(BOARD_URL)?.id).toBe('universal')
    const steps = guideSteps(info, { kind: null, access: 'api' })
    expect(steps.length).toBe(5)
    expect(steps.map((s) => s.text).join(' ')).toMatch(/business account.*two-factor authentication.*Connect app.*Trial access.*App id.*App secret key.*seen only by you.*Upgrade.*screen recording.*asks Pinterest for a token by itself/s)
  })

  it('checks the pair with Pinterest, keeps both values in the vault only, and becomes ready under the account\'s name', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'pinterest', label: 'Natal Mystic on Pinterest', access: 'api' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_PIN_SECRET })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/The app id is required/) })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: 'not a key', keyId: FAKE_PIN_APP_ID })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/does not look like a Pinterest app secret key/) })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_PIN_SECRET, keyId: 'my-app' })).rejects.toMatchObject({ message: expect.stringMatching(/does not look like an app id.*number under the app’s name/) })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: `${FAKE_PIN_SECRET}x`, keyId: FAKE_PIN_APP_ID })).rejects.toMatchObject({ message: expect.stringMatching(/does not accept the app id and the app secret key.*Nothing was saved/s) })
    w.pinterest.twoFactor = false
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_PIN_SECRET, keyId: FAKE_PIN_APP_ID })).rejects.toMatchObject({ message: expect.stringMatching(/Two-factor authentication is required.*Nothing was saved/s) })
    expect(w.secrets.values.has(apiKeyKey(account.id))).toBe(false)
    w.pinterest.twoFactor = true

    const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: ` ${FAKE_PIN_SECRET} `, keyId: ` ${FAKE_PIN_APP_ID} ` })
    expect(ready).toMatchObject({ status: 'ready', identity: '@natalmystic' })
    expect(w.secrets.values.get(apiKeyKey(account.id))).toBe(`${FAKE_PIN_APP_ID}:${FAKE_PIN_SECRET}`)
    // Nothing ends for the owner: the application asks for a token itself.
    expect(await w.call('vault.status', undefined as never)).toMatchObject({ apiKeyAccountIds: [account.id], apiKeyEnds: {} })
    expect(w.logged()).not.toContain(FAKE_PIN_SECRET)
    for (const token of w.pinterest.tokens) expect(w.logged()).not.toContain(token)
    // The token is asked for with the pair in the Basic header and the scopes in a form; everything else carries the token.
    const asked = w.pinterest.calls.filter((c) => c.path === 'oauth/token').at(-1)
    expect(asked).toMatchObject({ auth: 'basic', body: { grant_type: 'client_credentials', scope: 'user_accounts:read,boards:read,pins:read,pins:write' } })
    expect(w.pinterest.calls.filter((c) => c.path !== 'oauth/token').every((c) => c.auth === 'bearer')).toBe(true)
  })

  it('connects a board as a channel for the owner\'s own pins: not read, not watched in a browser, and says what is seen by whom', async () => {
    const w = await connected()
    expect(w.channel).toMatchObject({ status: 'active', connectorId: 'pinterest-api', target: 'pinterest.com/natalmystic/natal-charts', url: BOARD_URL, reads: false, watchedInBrowser: false, baselineDoneAt: null })
    const caps = Object.fromEntries((await w.call('channels.assess', { channelId: w.channel.id })).capabilities.map((c) => [c.key, c]))
    expect(caps.publish_post).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/board “Natal Charts” as @natalmystic.*1 to 5 JPEG or PNG pictures.*carousel pin.*or one MP4, MOV or M4V video up to 2 GB with one picture as its cover.*Standard access.*seen only by you/s) })
    for (const key of ['read_posts', 'read_comments', 'publish_reply']) expect(caps[key]).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/Pinterest's API has no comments/) })
    expect(caps.metrics).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/Under each pin.*reactions and comments.*shown in the last 90 days/s) })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://www.pinterest.com/natalmystic/' })).rejects.toMatchObject({
      code: 'platform_mismatch',
      message: expect.stringMatching(/not an address it can work with\. It takes the address of a board of the account that owns the developer app.*For example: https:\/\/www\.pinterest\.com\/yourbrand\/your-board\//s)
    })
    // A check of the channel finds nothing to answer.
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ?').get(w.channel.id)).toEqual({ n: 0 })
    expect(sendWays(w.core, undefined, w.channel)).toMatchObject({ aiBrowser: false, api: true })
    // The preview asks the application the same question the approval does.
    expect(await w.call('channels.sendWays', { channelId: w.channel.id })).toEqual({ aiBrowser: false, api: true, publicFiles: false })
    await expect(w.call('channels.sendWays', { channelId: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
    expect(await w.connector.fetchMetrics(w.ctx)).toEqual([])
  })

  it('finds the board by its name written as an address, through every page of the list, and says why when it cannot', async () => {
    const w = await connected('https://www.pinterest.com/natalmystic/moon-stars/')
    w.pinterest.pageSize = 1
    expect(await w.send({ title: 'The Moon', attachments: [picture()] })).toMatchObject({ status: 'confirmed' })
    expect(w.pinterest.pins[0]).toMatchObject({ board_id: '549755885176' })

    const assess = async (channelId: string) => Object.fromEntries((await w.call('channels.assess', { channelId })).capabilities.map((c) => [c.key, c]))
    const other = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://www.pinterest.com/somebody/natal-charts/' })
    expect((await assess(other.id)).publish_post).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/app belongs to @natalmystic, and this channel is a board of @somebody/) })
    const missing = await w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://www.pinterest.com/natalmystic/tarot/' })
    expect((await assess(missing.id)).publish_post).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/None of the boards Pinterest lists for @natalmystic is at this address \(it lists “Natal Charts”, “Moon & Stars!”\).*secret board/s) })
    w.pinterest.boards.push({ id: '549755885177', name: 'Moon Stars', privacy: 'PUBLIC' })
    expect(await w.send({ title: 'The Moon', attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/has 2 boards whose name reads “moon-stars” in an address.*Rename one.*Nothing was sent/s) })
  })

  it('asks for a token once and keeps it in memory, asks again when it has a day left or Pinterest stops taking it, and says when the pair is refused', async () => {
    const w = await connected()
    const before = tokensAsked(w)
    expect(await w.send({ title: 'One', attachments: [picture()] })).toMatchObject({ status: 'confirmed' })
    expect(await w.send({ title: 'Two', attachments: [picture()] })).toMatchObject({ status: 'confirmed' })
    expect(tokensAsked(w)).toBe(before)
    // Pinterest withdraws the token before its time: the next request gets a new one and is made again.
    w.pinterest.withdrawTokens()
    expect(await w.send({ title: 'Three', attachments: [picture()] })).toMatchObject({ status: 'confirmed' })
    expect(tokensAsked(w)).toBe(before + 1)
    // Thirty days on the token has ended by the clock: a new one is asked for before the request.
    w.clock.advance(29.5 * DAY)
    expect(await w.send({ title: 'Four', attachments: [picture()] })).toMatchObject({ status: 'confirmed' })
    expect(tokensAsked(w)).toBe(before + 2)
    expect(w.pinterest.pins.map((p) => p.title)).toEqual(['Four', 'Three', 'Two', 'One'])
    // The app's secret key was reset on Pinterest: nothing is sent, and the sign-in check says what to do.
    w.pinterest.app.secret = 'anotherSecretKeyOfTheApp0123456789'
    w.pinterest.withdrawTokens()
    expect(await w.send({ title: 'Five', attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/does not accept the app id and the app secret key.*save them again.*Nothing was sent/s) })
    expect(await w.connector.checkLogin(w.ctx)).toMatchObject({ loggedIn: false, signal: expect.stringMatching(/does not accept the app id and the app secret key/) })
    expect(w.pinterest.pins).toHaveLength(4)
  })
})

describe('creating a pin', () => {
  it('sends one picture from this Mac with the title, the description and the link to the channel\'s board', async () => {
    const w = await connected()
    const out = await w.send({ title: 'What a natal chart shows', text: 'Twelve houses, ten planets.', link: 'https://natalmystic.com/chart', attachments: [picture('chart.jpg', 'image/jpeg', 300)] })
    expect(out).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^pin:\d+$/), url: expect.stringMatching(/^https:\/\/www\.pinterest\.com\/pin\/\d+\/$/) })
    expect(w.pinterest.pins[0]).toMatchObject({ board_id: '549755885175', title: 'What a natal chart shows', description: 'Twelve houses, ten planets.', link: 'https://natalmystic.com/chart', picture: { type: 'image/jpeg', bytes: 300 } })
    // A pin of a picture alone: no empty title, description or link is sent.
    expect(await w.send({ attachments: [picture()] })).toMatchObject({ status: 'confirmed' })
    expect(w.pinterest.calls.filter((c) => c.method === 'POST' && c.path === 'pins').at(-1)?.body).toEqual({ board_id: '549755885175', media_source: '[picture]' })
    expect(w.logged()).not.toContain(FAKE_PIN_SECRET)
  })

  it('sends one video with the post\'s picture as its cover: the upload is registered, the file goes where Pinterest said, and the pin is created once the video is processed', async () => {
    const w = await connected()
    w.pinterest.videoLooks = 2
    const asked = w.pinterest.calls.length
    const out = await w.send({ title: 'A chart in a minute', text: 'Twelve houses.', link: 'https://natalmystic.com/chart', attachments: [file('clip.mov', 'video/quicktime', 4000), picture('cover.jpg', 'image/jpeg', 300)] })
    expect(out).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^pin:\d+$/) })
    const id = [...w.pinterest.media.keys()][0] as string
    expect(w.pinterest.calls.slice(asked).map((c) => `${c.method} ${c.path} ${c.auth}`)).toEqual([
      'GET boards?page_size=100 bearer',
      'POST media bearer',
      // The file goes to the storage with no token, after every field Pinterest gave.
      'POST upload null',
      `GET media/${id} bearer`,
      `GET media/${id} bearer`,
      `GET media/${id} bearer`,
      'POST pins bearer'
    ])
    expect(w.pinterest.calls.find((c) => c.path === 'upload')?.body).toEqual(['x-amz-date', 'x-amz-signature', 'x-amz-security-token', 'x-amz-algorithm', 'key', 'policy', 'x-amz-credential', 'Content-Type', 'file'])
    expect(w.pinterest.pins[0]).toMatchObject({ board_id: '549755885175', title: 'A chart in a minute', description: 'Twelve houses.', link: 'https://natalmystic.com/chart', picture: { type: 'image/jpeg', bytes: 300 }, video: 'clip.mov' })
    expect(w.logged()).not.toContain(FAKE_PIN_SECRET)
  })

  it('creates no pin when the video is not taken: a refused upload, a video Pinterest cannot process, a lost answer before the pin', async () => {
    const w = await connected()
    const pins = () => w.pinterest.calls.filter((c) => c.method === 'POST' && c.path === 'pins').length
    const post = () => w.send({ title: 'A clip', attachments: [picture(), file('clip.mp4', 'video/mp4')] })
    w.pinterest.failsVideo = true
    expect(await post()).toMatchObject({ status: 'failed', error: expect.stringMatching(/Pinterest could not process the video “clip.mp4”\. Nothing was sent\./) })
    w.pinterest.failsVideo = false
    w.pinterest.videoLooks = 200
    expect(await post()).toMatchObject({ status: 'failed', error: expect.stringMatching(/still processing the video “clip.mp4” after ten minutes\. Nothing was sent\./) })
    w.pinterest.videoLooks = 0
    w.pinterest.withdrawTokens()
    w.pinterest.app.secret = 'anotherSecretKeyOfTheApp0123456789abcdef'
    expect(await post()).toMatchObject({ status: 'failed', error: expect.stringMatching(/Nothing was sent\./) })
    expect(pins()).toBe(0)
    expect(w.pinterest.pins).toHaveLength(0)
  })

  it('refuses before asking Pinterest what a pin cannot be, and says it before the approval', async () => {
    const w = await connected()
    const pins = () => w.pinterest.calls.filter((c) => c.method === 'POST' && c.path === 'pins').length
    expect(await w.send({ title: 'No picture' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/is 1 to 5 pictures.*this post has no picture\./) })
    // 2 to 5 pictures go out as a carousel pin (multiple_image_base64); 6 pictures or a video with 2 pictures are refused before sending.
    expect(await w.send({ attachments: [picture('a.png'), picture('b.png'), picture('c.png'), picture('d.png'), picture('e.png'), picture('f.png')] })).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/this post has 6 pictures\./)
    })
    expect(await w.send({ attachments: [picture('a.png'), picture('b.png'), file('clip.mp4', 'video/mp4')] })).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/this post has 2 pictures and one video\./)
    })
    // A video needs a picture as its cover; two videos, or a kind of video Pinterest does not take, are refused.
    expect(await w.send({ attachments: [file('clip.mp4', 'video/mp4')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/this post has no picture and one video\./) })
    expect(await w.send({ attachments: [picture(), file('a.mp4', 'video/mp4'), file('b.mp4', 'video/mp4')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/this post has one picture and 2 videos\./) })
    expect(await w.send({ attachments: [picture(), file('clip.webm', 'video/webm')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/takes an MP4, MOV or M4V video; “clip.webm” is none of them/) })
    expect(await w.send({ attachments: [picture(), { name: 'gone.mp4', path: '/nonexistent/gone.mp4', mime: 'video/mp4', sha256: 'x' }] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/The video “gone.mp4” could not be read from this Mac/) })
    expect(await w.send({ attachments: [picture('anim.gif', 'image/gif')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/“anim.gif” is neither/) })
    expect(await w.send({ attachments: [picture('ok.png'), picture('anim.gif', 'image/gif')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/“anim.gif” is neither/) })
    expect(await w.send({ title: 'x'.repeat(101), attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/at most 100 characters in a pin's title; this one has 101/) })
    expect(await w.send({ text: 'x'.repeat(801), attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/at most 800 characters in a pin's description; this one has 801/) })
    expect(await w.send({ link: 'natalmystic.com', attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/starts with http/) })
    expect(await w.send({ attachments: [picture('big.png', 'image/png', 21 * 1024 * 1024)] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/up to 20 MB; “big.png” is 21 MB/) })
    expect(await w.send({ attachments: [{ name: 'gone.png', path: '/nonexistent/gone.png', mime: 'image/png', sha256: 'x' }] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be read from this Mac/) })
    expect(await w.send({ kind: 'reply', parentExternalId: 'pin:1', text: 'Thanks!' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/has no comments.*Nothing was sent/s) })
    expect(pins()).toBe(0)
    expect(w.pinterest.media.size).toBe(0)

    // The owner reads before approving that a pin needs a picture; a video with its picture goes through the API.
    const ways = sendWays(w.core, undefined, w.channel)
    const video = renderForPlatform({ title: 'A clip', text: 'Words', link: null, attachments: [{ name: 'clip.mp4', mime: 'video/mp4' }] } as never, 'pinterest')
    expect(sendProblems('pinterest', video, ways).join(' ')).not.toMatch(/video is not sent/)
    const withCover = renderForPlatform({ title: 'A clip', text: 'Words', link: null, attachments: [{ name: 'cover.png', mime: 'image/png' }, { name: 'clip.mp4', mime: 'video/mp4' }] } as never, 'pinterest')
    expect(sendProblems('pinterest', withCover, ways)).toEqual([])
  })

  it('says what Pinterest refused, and that the outcome is unknown when its answer was lost or held no id', async () => {
    const w = await connected()
    w.pinterest.failNext = { status: 403, code: 29, message: 'You are not permitted to access that resource.' }
    expect(await w.send({ title: 'One', attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/does not allow it \(You are not permitted.*Nothing was sent/s) })
    w.pinterest.failNext = { status: 429, code: 8, message: 'You have exceeded your rate limit.' }
    expect(await w.send({ title: 'One', attachments: [picture()] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/asks to wait/) })
    w.pinterest.failNext = { status: 500, code: 0, message: 'Internal error' }
    expect(await w.send({ title: 'One', attachments: [picture()] })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/error of its own.*not known whether the pin was created/s) })
    w.pinterest.namesPins = false
    expect(await w.send({ title: 'No id', attachments: [picture()] })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/returned no id/) })
    w.pinterest.namesPins = true

    // The answer is lost after Pinterest made the pin: the pin is found among the account's newest by its board, title and description.
    w.pinterest.failNext = 'lost'
    const attemptedAt = w.core.clock.now().toISOString()
    const lost = { title: 'The lost one', text: 'It was made.', attachments: [picture()] }
    expect(await w.send(lost)).toMatchObject({ status: 'unknown', error: expect.stringMatching(/did not answer.*not known whether the pin was created/s) })
    const pin = w.pinterest.pins[0]
    expect(await w.connector.findPublished?.(w.ctx, w.request({ ...lost, attemptedAt }))).toEqual({ url: `https://www.pinterest.com/pin/${pin?.id}/`, externalId: `pin:${pin?.id}` })
    expect(await w.connector.findPublished?.(w.ctx, w.request({ ...lost, title: 'Another', attemptedAt }))).toBeNull()
    // A pin made before the attempt is not taken for it.
    w.clock.advance(DAY)
    expect(await w.connector.findPublished?.(w.ctx, w.request({ ...lost, attemptedAt: w.core.clock.now().toISOString() }))).toBeNull()
  })

  it('reads under each pin the reactions and comments since it was made and how often it was shown in the last 90 days', async () => {
    const w = await connected()
    const sent = (await w.send({ title: 'One', attachments: [picture()] })) as { externalId: string; url: string }
    const id = parseExternalId(sent.externalId) as string
    w.pinterest.numbers[id] = { IMPRESSION: 240, TOTAL_COMMENTS: 3, TOTAL_REACTIONS: 12 }
    const asked = [{ externalId: sent.externalId, url: sent.url }, { externalId: 'pin:999', url: null }, { externalId: 'li:urn:li:share:1', url: null }]
    expect(await w.connector.readPostNumbers?.(w.ctx, asked)).toEqual({ [sent.externalId]: { likes: 12, comments: 3, views: 240 } })
    const call = w.pinterest.calls.filter((c) => c.path.startsWith(`pins/${id}/analytics`)).at(-1)
    const today = w.core.clock.now()
    expect(call?.path).toContain(`start_date=${new Date(today.getTime() - 89 * DAY).toISOString().slice(0, 10)}&end_date=${today.toISOString().slice(0, 10)}`)
    expect(call?.path).toContain('pin_metrics=true')
    // The channel's page counts them as numbers the application reads itself.
    expect(await w.call('results.posts', { channelId: w.channel.id })).toMatchObject({ readable: true, byAi: false })
  })

  it('publishes 2 to 5 JPEG or PNG pictures as a carousel pin via multiple_image_base64 (DEC-097)', async () => {
    const w = await connected()
    const sent = await w.send({
      title: 'Five natal placements',
      text: 'Swipe through all slides.',
      link: 'https://natalmystic.com/guide',
      attachments: [picture('one.png', 'image/png', 100), picture('two.jpg', 'image/jpeg', 200), picture('three.png', 'image/png', 300)]
    })
    expect(sent).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^pin:\d+$/) })
    expect(w.pinterest.pins[0]).toMatchObject({
      title: 'Five natal placements',
      description: 'Swipe through all slides.',
      link: 'https://natalmystic.com/guide',
      pictures: [
        { type: 'image/png', bytes: 100 },
        { type: 'image/jpeg', bytes: 200 },
        { type: 'image/png', bytes: 300 }
      ]
    })
    // Markdown fit check accepts up to 5 pictures on Pinterest and rejects 6.
    const ways = sendWays(w.core, undefined, w.channel)
    const five = renderForPlatform(
      {
        title: 'Five',
        text: 'Words',
        link: null,
        markup: 'markdown',
        attachments: [1, 2, 3, 4, 5].map((n) => ({ name: `${n}.png`, path: `/${n}.png`, mime: 'image/png', sha256: `s${n}` }))
      },
      'pinterest'
    )
    expect(sendProblems('pinterest', five, ways)).toEqual([])
    const six = renderForPlatform(
      {
        title: 'Six',
        text: 'Words',
        link: null,
        markup: 'markdown',
        attachments: [1, 2, 3, 4, 5, 6].map((n) => ({ name: `${n}.png`, path: `/${n}.png`, mime: 'image/png', sha256: `s${n}` }))
      },
      'pinterest'
    )
    expect(sendProblems('pinterest', six, ways).join(' ')).toMatch(/at most 5 pictures; this post has 6/)
  })
})
