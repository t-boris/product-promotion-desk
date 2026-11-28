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
import { LinkedInApiConnector, parseExternalId, profileOf } from './connector'
import { FAKE_LI_TOKEN, FakeLinkedIn, LI_MEMBER_ID } from './fake-linkedin'

let t: TestCore | null = null
const dirs: string[] = []
afterEach(async () => {
  await t?.core.shutdown()
  t = null
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const PROFILE_URL = 'https://www.linkedin.com/in/ann-lee/'
const DAY = 24 * 3_600_000

/** A core with the LinkedIn API connector; a fake LinkedIn behind both of its hosts; one product. */
function world() {
  const linkedin = new FakeLinkedIn()
  t = makeTestCore({ connectors: [new LinkedInApiConnector(), new UniversalConnector()], http: byHost({ 'api.linkedin.com': linkedin, 'www.linkedin.com': linkedin }) })
  const core = t.core
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goals_json, active_passport_version_id, analysis_status, created_at, updated_at, add_site_link) VALUES (?, ?, ?, ?, json_array(), ?, ?, ?, ?, 0)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)
  const logged = (): string => JSON.stringify(core.db.prepare('SELECT * FROM log_events').all())
  return { core, linkedin, productId, secrets: t.secrets, clock: t.clock, logged, call: core.router.call.bind(core.router) as typeof core.router.call }
}

/** A LinkedIn account with its token saved and the profile connected, assessed and active. */
async function connected() {
  const w = world()
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'linkedin', label: 'Ann on LinkedIn', access: 'api' })
  const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_LI_TOKEN })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: PROFILE_URL })
  await w.call('channels.assess', { channelId: channel.id })
  const active = await w.call('channels.activate', { channelId: channel.id })
  const { connector, ctx } = w.core.connectorContext(active.id)
  const loose = { ...ctx, tickets: { assertValid: () => undefined } }
  const ticket = { id: 't', actionId: 'a', contentHash: 'h', accountId: ready.id, destination: active.url, expiresAt: 0, signature: '' }
  const send = (request: Partial<PublishRequest>) => connector.publish(loose, ticket, { kind: 'post', destination: active.url, parentExternalId: null, title: null, text: '', link: null, attachments: [], ...request })
  return { ...w, account: ready, channel: active, connector, ctx, send, monitor: w.core.services.monitor as MonitorService }
}

/** A file on this Mac of the given size (a video's size is read before it is sent). */
function file(name: string, mime: string, bytes = 12) {
  const dir = mkdtempSync(join(tmpdir(), 'ppd-li-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, 'x')
  truncateSync(path, bytes)
  return { name, path, mime, sha256: 'x' }
}
const picture = (name: string, mime = 'image/png') => file(name, mime)
const made = (w: { linkedin: FakeLinkedIn }, path: string) => w.linkedin.calls.filter((c) => c.method !== 'GET' && c.path.startsWith(path))

describe('the address of a LinkedIn profile', () => {
  it('is a personal profile, and never a company page, a post or a group', () => {
    expect(profileOf('https://www.linkedin.com/in/Ann-Lee/')).toBe('ann-lee')
    expect(profileOf('linkedin.com/in/ann-lee-1a2b3c')).toBe('ann-lee-1a2b3c')
    expect(profileOf('https://uk.linkedin.com/in/ann-lee?trk=x')).toBe('ann-lee')
    expect(profileOf('https://www.linkedin.com/company/natal-mystic/')).toBeNull()
    expect(profileOf('https://www.linkedin.com/feed/update/urn:li:share:1/')).toBeNull()
    expect(profileOf('https://www.linkedin.com/in/ann-lee/recent-activity/')).toBeNull()
    expect(profileOf('https://www.linkedin.com/groups/123/')).toBeNull()
    expect(profileOf('https://www.instagram.com/in/ann-lee/')).toBeNull()
    expect(parseExternalId('li:urn:li:share:7001')).toBe('urn:li:share:7001')
    expect(parseExternalId('li:urn:li:ugcPost:7001')).toBe('urn:li:ugcPost:7001')
    expect(parseExternalId('ig:m:1')).toBeNull()
  })
})

describe('a LinkedIn account that works through LinkedIn\'s API (DEC-084)', () => {
  it('is offered for LinkedIn beside the browser account, says what it does and that its key ends, and is never chosen by an address alone', async () => {
    const w = world()
    const info = (await w.call('platforms.list', undefined as never)).find((p) => p.platform === 'linkedin')
    expect(info).toMatchObject({ connectorId: 'universal', api: { accountKind: 'developer app', keyLabel: 'LinkedIn access token', keyDays: 60, work: expect.stringMatching(/posts on the personal profile.*no comments and no numbers/) } })
    expect(info?.api).not.toHaveProperty('renews')
    expect(info?.api).not.toHaveProperty('onceSecret')
    expect(w.core.connectors.resolve(PROFILE_URL)?.id).toBe('universal')
    const steps = guideSteps(info, { kind: null, access: 'api' })
    expect(steps.length).toBe(5)
    expect(steps.map((s) => s.text).join(' ')).toMatch(/LinkedIn Page.*Create app.*Share on LinkedIn.*Sign In with LinkedIn using OpenID Connect.*token generator.*openid, profile and w_member_social.*60 days.*a week before it ends/s)
  })

  it('keeps the token in the vault only, becomes ready under the member\'s name, and remembers the day the token ends', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'linkedin', label: 'Ann on LinkedIn', access: 'api' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: 'not a token' })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/does not look like a LinkedIn access token/) })
    const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: ` ${FAKE_LI_TOKEN} ` })
    expect(ready).toMatchObject({ status: 'ready', identity: 'Ann Lee' })
    expect(w.secrets.values.get(apiKeyKey(account.id))).toBe(FAKE_LI_TOKEN)
    const ends = new Date(w.core.clock.now().getTime() + 60 * DAY).toISOString()
    expect(await w.call('vault.status', undefined as never)).toMatchObject({ apiKeyAccountIds: [account.id], apiKeyEnds: { [account.id]: ends } })
    expect(w.logged()).toMatch(new RegExp(`A LinkedIn access token was saved for Ann on LinkedIn; it lasts until ${ends.slice(0, 10)}, and a new one must be saved before then`))
    expect(w.logged()).not.toContain(FAKE_LI_TOKEN)
    // Every request carries the token in its header and the protocol header LinkedIn requires.
    expect(w.linkedin.calls.every((c) => c.auth && c.headers['x-restli-protocol-version'] === '2.0.0')).toBe(true)
  })

  it('tells the owner in the Inbox a week before the token ends, and after it ended', async () => {
    const w = await connected()
    const items = async () => (await w.call('attention.list', undefined)).filter((item) => item.id === `key:${w.account.id}`)
    expect(await items()).toEqual([])
    w.clock.advance(52 * DAY)
    expect(await items()).toEqual([])
    w.clock.advance(2 * DAY)
    const ends = (await w.call('vault.status', undefined as never)).apiKeyEnds[w.account.id]?.slice(0, 10)
    expect(await items()).toMatchObject([{ kind: 'login', refType: 'account', refId: w.account.id, title: `The LinkedIn access token of Ann on LinkedIn ends on ${ends}`, detail: expect.stringMatching(/lasts 60 days and the platform does not renew it.*account's page/) }])
    w.clock.advance(10 * DAY)
    expect((await items())[0]?.title).toBe(`The LinkedIn access token of Ann on LinkedIn ended on ${ends}`)
    // A new token starts the count again.
    await w.call('vault.saveApiKey', { accountId: w.account.id, key: FAKE_LI_TOKEN })
    expect(await items()).toEqual([])
    // The renewal job has nothing to do for a key the platform does not renew.
    expect(await (w.core.services.keys as { renewDue(): Promise<number> }).renewDue()).toBe(0)
  })

  it('connects a personal profile as a channel for the owner\'s own posts: not read, not watched in a browser, and says so', async () => {
    const w = await connected()
    expect(w.channel).toMatchObject({ status: 'active', connectorId: 'linkedin-api', target: 'linkedin.com/in/ann-lee', url: PROFILE_URL, reads: false, watchedInBrowser: false, baselineDoneAt: null })
    const caps = Object.fromEntries((await w.call('channels.assess', { channelId: w.channel.id })).capabilities.map((c) => [c.key, c]))
    expect(caps.publish_post).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/go out as Ann Lee.*3000 characters.*1-9 pictures.*one MP4 video.*see on the first post that it is https:\/\/www\.linkedin\.com\/in\/ann-lee\//s) })
    for (const key of ['read_posts', 'read_comments', 'publish_reply', 'metrics']) expect(caps[key]).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/no reading of a profile's posts, comments or numbers/) })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: w.account.id, target: 'https://www.linkedin.com/company/natal-mystic/' })).rejects.toMatchObject({ code: 'platform_mismatch' })
    // A check of the channel asks LinkedIn for nothing it would refuse, and finds nothing to answer.
    const before = w.linkedin.calls.length
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    expect(w.linkedin.calls.slice(before).every((c) => c.path === 'v2/userinfo')).toBe(true)
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ?').get(w.channel.id)).toEqual({ n: 0 })
    expect(sendWays(w.core, undefined, w.channel)).toMatchObject({ aiBrowser: false, api: true })
    expect(await w.connector.fetchMetrics(w.ctx)).toEqual([])
  })
})

describe('posting as the member', () => {
  it('sends words as a post for everybody, and words that end with an address as an article share', async () => {
    const w = await connected()
    const out = await w.send({ text: 'What a natal chart shows.' })
    expect(out).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^li:urn:li:share:\d+$/), url: expect.stringMatching(/^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:share:\d+\/$/) })
    expect(w.linkedin.posts[0]).toMatchObject({ text: 'What a natal chart shows.', category: 'NONE', media: [], visibility: 'PUBLIC' })
    expect(made(w, 'v2/ugcPosts')[0]?.body).toMatchObject({ author: `urn:li:person:${LI_MEMBER_ID}`, lifecycleState: 'PUBLISHED' })

    // The form puts the link last in the words (DEC-036): LinkedIn is told the address too, so it shows the page's card.
    expect(await w.send({ text: 'Read how it is built.\n\nhttps://natalmystic.com/how' })).toMatchObject({ status: 'confirmed' })
    expect(w.linkedin.posts[0]).toMatchObject({ text: 'Read how it is built.\n\nhttps://natalmystic.com/how', category: 'ARTICLE', media: ['https://natalmystic.com/how'] })
    // An address in the middle of the words is words.
    expect(await w.send({ text: 'See https://natalmystic.com for more.' })).toMatchObject({ status: 'confirmed' })
    expect(w.linkedin.posts[0]).toMatchObject({ category: 'NONE' })
    expect(w.logged()).not.toContain(FAKE_LI_TOKEN)
  })

  it('uploads pictures from this Mac with the token, then makes one post with them in their order', async () => {
    const w = await connected()
    expect(await w.send({ text: 'Two charts.\n\nhttps://natalmystic.com', attachments: [picture('one.png'), picture('two.jpg', 'image/jpeg')] })).toMatchObject({ status: 'confirmed' })
    expect(w.linkedin.posts[0]).toMatchObject({ category: 'IMAGE', media: ['one.png', 'two.jpg'], text: 'Two charts.\n\nhttps://natalmystic.com' })
    const registered = made(w, 'v2/assets')
    expect(registered).toHaveLength(2)
    expect(registered[0]?.body).toMatchObject({ registerUploadRequest: { recipes: ['urn:li:digitalmediaRecipe:feedshare-image'], owner: `urn:li:person:${LI_MEMBER_ID}`, supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'] } })
    const uploads = w.linkedin.calls.filter((c) => c.method === 'PUT')
    expect(uploads.map((c) => [c.host, c.auth])).toEqual([
      ['api.linkedin.com', true],
      ['api.linkedin.com', true]
    ])
  })

  it('uploads one video without the token, waits until LinkedIn has prepared it, then makes the post', async () => {
    const w = await connected()
    w.linkedin.videoStates = ['PROCESSING', 'PROCESSING']
    expect(await w.send({ text: 'A minute about houses.', attachments: [file('houses.mp4', 'video/mp4', 4096)] })).toMatchObject({ status: 'confirmed' })
    expect(w.linkedin.posts[0]).toMatchObject({ category: 'VIDEO', media: ['houses.mp4'] })
    const upload = w.linkedin.calls.find((c) => c.method === 'PUT')
    expect(upload).toMatchObject({ host: 'www.linkedin.com', auth: false, headers: { 'media-type-family': 'VIDEO' } })
    expect(made(w, 'v2/assets')[0]?.body).not.toHaveProperty('registerUploadRequest.supportedUploadMechanism')
    expect(w.linkedin.calls.filter((c) => c.method === 'GET' && c.path.startsWith('v2/assets/'))).toHaveLength(3)
  })

  it('refuses before anything is asked of LinkedIn what it cannot carry, and says before the approval that pictures and a video do not go together', async () => {
    const w = await connected()
    const asked = w.linkedin.calls.length
    expect(await w.send({ kind: 'reply', parentExternalId: 'li:urn:li:share:1', text: 'Thank you.' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/no reading of a profile's posts, comments.*written on LinkedIn itself/) })
    expect(await w.send({ text: '  ' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/The post is empty/) })
    expect(await w.send({ text: 'a'.repeat(3001) })).toMatchObject({ status: 'failed', error: expect.stringMatching(/at most 3000 characters in a post; this one has 3001/) })
    expect(await w.send({ text: 'A.', attachments: [file('a.pdf', 'application/pdf')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/“a\.pdf” is neither/) })
    expect(await w.send({ text: 'A.', attachments: [file('a.mov', 'video/quicktime')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/an MP4 video.*“a\.mov” is neither/) })
    expect(await w.send({ text: 'A.', attachments: [file('a.mp4', 'video/mp4'), picture('a.png')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/one video, or pictures.*not both/) })
    expect(await w.send({ text: 'A.', attachments: Array.from({ length: 10 }, (_, i) => picture(`${i}.png`)) })).toMatchObject({ status: 'failed', error: expect.stringMatching(/at most 9 pictures in one post; this one has 10/) })
    expect(await w.send({ text: 'A.', attachments: [file('big.mp4', 'video/mp4', 201 * 1024 * 1024)] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/over 200 MB only in parts.*“big\.mp4” is 201 MB/) })
    expect(await w.send({ text: 'A.', attachments: [{ name: 'gone.mp4', path: '/nonexistent/gone.mp4', mime: 'video/mp4', sha256: 'x' }] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be read from this Mac/) })
    expect(w.linkedin.calls.length).toBe(asked)

    const rendered = renderForPlatform({ title: null, text: 'A.', link: null, attachments: [] } as never, 'linkedin')
    const ways = sendWays(w.core, undefined, w.channel)
    expect(sendProblems('linkedin', { ...rendered, attachments: [file('a.mp4', 'video/mp4'), picture('a.png')] }, ways).join(' ')).toMatch(/LinkedIn takes pictures or one video in a post through its API, not both/)
    expect(sendProblems('linkedin', { ...rendered, attachments: [picture('a.png'), picture('b.png')] }, ways)).toEqual([])
    expect(sendProblems('linkedin', { ...rendered, attachments: [file('a.mp4', 'video/mp4')] }, ways)).toEqual([])
    // In the account's browser the two go together as before.
    expect(sendProblems('linkedin', { ...rendered, attachments: [file('a.mp4', 'video/mp4'), picture('a.png')] }, { aiBrowser: true }).join(' ')).not.toMatch(/not both/)
  })

  it('publishes nothing when a file is not taken or a video is never ready, and says what LinkedIn said', async () => {
    const w = await connected()
    w.linkedin.failNext = { on: 'register', status: 403, message: 'Not enough permissions to access: assets.registerUpload' }
    expect(await w.send({ text: 'A.', attachments: [picture('a.png')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/LinkedIn does not allow it \(Not enough permissions.*Share on LinkedIn.*w_member_social.*Nothing was published/s) })
    w.linkedin.failNext = { on: 'upload', status: 400, message: 'The file is not an image' }
    expect(await w.send({ text: 'B.', attachments: [picture('b.png')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/LinkedIn did not take “b\.png”: The file is not an image\. Nothing was published/) })
    w.linkedin.videoStates = ['PROCESSING', 'CLIENT_ERROR']
    expect(await w.send({ text: 'C.', attachments: [file('c.mp4', 'video/mp4')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not prepare the video “c\.mp4” \(CLIENT_ERROR\)\. Nothing was published/) })
    w.linkedin.videoStates = Array.from({ length: 40 }, () => 'PROCESSING')
    expect(await w.send({ text: 'D.', attachments: [file('d.mp4', 'video/mp4')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/still preparing the video “d\.mp4” after five minutes/) })
    expect(w.linkedin.posts).toHaveLength(0)
    expect(made(w, 'v2/ugcPosts')).toHaveLength(0)
  })

  it('says a refusal as a failure, an ended token as one to make anew, and an error of LinkedIn\'s own side, a lost answer or a post without an id as unknown, which only the owner can settle', async () => {
    const w = await connected()
    w.linkedin.failNext = { status: 422, message: 'Content is a duplicate of urn:li:share:1' }
    expect(await w.send({ text: 'First.' })).toMatchObject({ status: 'failed', error: 'LinkedIn refused it: Content is a duplicate of urn:li:share:1 Nothing was sent.' })
    w.linkedin.failNext = { status: 500, message: 'Internal Server Error' }
    expect(await w.send({ text: 'Half.' })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/error of its own.*Look at the profile on LinkedIn/) })
    w.linkedin.failNext = 'lost'
    const request = { text: 'Second.' }
    expect(await w.send(request)).toMatchObject({ status: 'unknown', error: expect.stringMatching(/did not answer.*Look at the profile on LinkedIn/) })
    expect(w.linkedin.posts[0]?.text).toBe('Second.')
    const lost = { kind: 'post' as const, destination: w.channel.url, parentExternalId: null, title: null, link: null, attachments: [], attemptedAt: w.core.clock.now().toISOString(), ...request }
    await expect(w.connector.findPublished(w.ctx, lost)).rejects.toThrow(/no reading of a profile's posts.*say here whether the post is there/)
    w.linkedin.namesPosts = false
    expect(await w.send({ text: 'Third.' })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/returned no id/) })

    w.linkedin.tokens.clear()
    expect(await w.send({ text: 'Fourth.' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/does not accept the access token.*Make a new one.*Nothing was sent/) })
    expect((await w.call('accounts.checkLogin', { accountId: w.account.id })).status).not.toBe('ready')
  })
})
