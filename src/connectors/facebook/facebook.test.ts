import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/db/database'
import { FakeKnowledge, makeClaim } from '../../core/pipeline/test-fixture'
import { makeTestCore, type TestCore } from '../../core/testing/fakes'
import { apiKeyKey } from '../../core/vault'
import type { MonitorService, SendingService } from '../../core/services'
import type { PublishRequest } from '../../core/ports'
import { guideSteps } from '../../shared/connection-guide'
import { renderForPlatform, sendProblems } from '../../shared/post-format'
import { contentHash } from '../../core/pipeline/hash'
import { UniversalConnector } from '../universal'
import { FacebookPageConnector, pageOf, parseExternalId } from './connector'
import { FAKE_PAGE_TOKEN, FAKE_USER_TOKEN, FakeFacebook, PAGE_ID } from './fake-facebook'

let t: TestCore | null = null
afterEach(async () => {
  await t?.core.shutdown()
  t = null
})

const PAGE_URL = 'https://www.facebook.com/natalmystic'

/** A core with the Facebook Page connector and a fake Graph API behind the network port; one product. */
function world(facebook = new FakeFacebook()) {
  t = makeTestCore({ connectors: [new FacebookPageConnector(), new UniversalConnector()], http: facebook })
  const core = t.core
  core.services.knowledge = Object.assign(new FakeKnowledge(), { approved: [makeClaim('c1', 'Natal Mystic builds a natal chart from your birth date, time and place.')] })
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goals_json, active_passport_version_id, analysis_status, created_at, updated_at, add_site_link) VALUES (?, ?, ?, ?, json_array(), ?, ?, ?, ?, 0)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)
  facebook.nowMs = core.clock.now().getTime()
  return { core, facebook, productId, secrets: t.secrets, clock: t.clock, call: core.router.call.bind(core.router) as typeof core.router.call }
}

/** A Page account with its token saved and the Page connected, assessed and active. */
async function connected(facebook = new FakeFacebook()) {
  const w = world(facebook)
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'facebook', label: 'Natal Mystic Page', access: 'api' })
  const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_PAGE_TOKEN })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: PAGE_URL })
  await w.call('channels.assess', { channelId: channel.id })
  const active = await w.call('channels.activate', { channelId: channel.id })
  const { connector, ctx } = w.core.connectorContext(active.id)
  const loose = { ...ctx, tickets: { assertValid: () => undefined } }
  const ticket = { id: 't', actionId: 'a', contentHash: 'h', accountId: ready.id, destination: active.url, expiresAt: 0, signature: '' }
  const send = (request: Partial<PublishRequest>) => connector.publish(loose, ticket, { kind: 'post', destination: active.url, parentExternalId: null, title: null, text: '', link: null, attachments: [], ...request })
  return { ...w, account: ready, channel: active, connector, ctx, send, sending: w.core.services.sending as SendingService, monitor: w.core.services.monitor as MonitorService }
}

const picture = (name: string) => ({ name, path: `/tmp/${name}`, mime: 'image/jpeg', sha256: 'x' })

describe('the address of a Page', () => {
  it('is the Page\'s own address, by name or by number, and nothing else on Facebook', () => {
    expect(pageOf('https://www.facebook.com/NatalMystic/')).toBe('natalmystic')
    expect(pageOf('facebook.com/natal.mystic')).toBe('natal.mystic')
    expect(pageOf('https://www.facebook.com/profile.php?id=100200300400')).toBe('100200300400')
    expect(pageOf('https://www.facebook.com/people/Natal-Mystic/100200300400/')).toBe('100200300400')
    expect(pageOf('https://www.facebook.com/p/Natal-Mystic-100200300400/')).toBe('100200300400')
    expect(pageOf('https://m.facebook.com/Natal-Mystic-100200300400')).toBe('100200300400')
    expect(pageOf('https://www.facebook.com/share/19h1CygGyN')).toBeNull()
    expect(pageOf('https://www.facebook.com/groups/astrologyclub')).toBeNull()
    expect(pageOf('https://www.facebook.com/natalmystic/posts/123')).toBeNull()
    expect(pageOf('https://www.instagram.com/natalmystic')).toBeNull()
    expect(parseExternalId('fb:100200300400_5001')).toBe('100200300400_5001')
    expect(parseExternalId('tg:-100:5')).toBeNull()
  })
})

describe('a Facebook account that works through a Page\'s access token (DEC-076)', () => {
  it('is offered for Facebook beside the browser account, with the steps that get the token; the Page connector is never chosen by an address alone', async () => {
    const w = world()
    const info = (await w.call('platforms.list', undefined as never)).find((p) => p.platform === 'facebook')
    expect(info).toMatchObject({ connectorId: 'universal', api: { accountKind: 'Page', keyLabel: 'Page access token' } })
    // A Page's token does not end: nothing is said about renewing it.
    expect(info?.api).not.toHaveProperty('renews')
    expect(w.core.connectors.resolve(PAGE_URL)?.id).toBe('universal')
    const steps = guideSteps(info, { kind: null, access: 'api' })
    expect(steps.length).toBe(8)
    expect(steps.filter((s) => s.url).every((s) => s.url?.startsWith('https://developers.facebook.com/') && s.link)).toBe(true)
    expect(steps.map((s) => s.text).join(' ')).toMatch(/pages_manage_posts.*me\/accounts.*Go live/s)
    // A browser account of Facebook keeps its browser and the steps of its kind.
    const browser = await w.call('accounts.create', { productId: w.productId, platform: 'facebook', label: 'My profile', kind: 'profile' })
    expect(browser).toMatchObject({ access: 'browser', kind: 'profile' })
    expect(guideSteps(info, browser)[0]?.text).toMatch(/Sign in to Facebook/)
  })

  it('becomes ready under the Page\'s name when its token is saved; a person\'s token and an ended one are said in words, and no line holds the token', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'facebook', label: 'Page', access: 'api' })
    expect(account).toMatchObject({ access: 'api', status: 'login_required' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: 'not a token' })).rejects.toMatchObject({ code: 'invalid_input' })
    const person = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_USER_TOKEN })
    expect(person.status).not.toBe('ready')
    const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: `  ${FAKE_PAGE_TOKEN} ` })
    expect(ready).toMatchObject({ status: 'ready', identity: 'Natal Mystic' })
    expect(w.secrets.values.get(apiKeyKey(account.id))).toBe(FAKE_PAGE_TOKEN)
    expect(JSON.stringify(ready)).not.toContain(FAKE_PAGE_TOKEN)

    w.facebook.token = 'EAAanotherTokenThatReplacedTheOldOne0123456789abcdefghijklmnopqrstuv'
    expect((await w.call('accounts.checkLogin', { accountId: account.id })).status).not.toBe('ready')
    const log = JSON.stringify(w.core.db.prepare('SELECT * FROM log_events').all())
    expect(log).not.toContain(FAKE_PAGE_TOKEN)
    expect(log).not.toContain(FAKE_USER_TOKEN)
    expect(log).toMatch(/not the token of a Page/)
  })

  it('checks that the token is of the Page that was connected, and reads its posts and comments before saying it can', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'facebook', label: 'Page', access: 'api' })
    await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_PAGE_TOKEN })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://www.facebook.com/share/19h1CygGyN' })).rejects.toMatchObject({ code: 'platform_mismatch' })

    const other = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://www.facebook.com/someoneelse' })
    const wrong = await w.call('channels.assess', { channelId: other.id })
    expect(wrong.capabilities.find((c) => c.key === 'publish_post')).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/belongs to the Page “Natal Mystic”/) })

    const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: `https://www.facebook.com/profile.php?id=${PAGE_ID}` })
    expect(channel).toMatchObject({ connectorId: 'facebook-page', target: `facebook.com/${PAGE_ID}`, reads: true, watchedInBrowser: false })
    const cap = async (key: string) => (await w.call('channels.assess', { channelId: channel.id })).capabilities.find((c) => c.key === key)
    expect(await cap('read_posts')).toMatchObject({ status: 'verified' })
    expect(await cap('read_comments')).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/no post yet/) })
    w.facebook.ownerPosts('Hello.')
    expect(await cap('read_comments')).toMatchObject({ status: 'verified' })
    // A send is proven by a send, never by a check.
    expect(await cap('publish_post')).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/Go live/) })
  })
})

describe('posting as the Page', () => {
  it('sends an approved post by itself at its time, confirmed with the post Facebook made, with no browser', async () => {
    const w = await connected()
    const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text: 'Mercury turns direct today.' } })
    await w.call('publications.schedule', { id: opportunity.id, at: new Date(w.core.clock.now().getTime() + 60_000).toISOString() })
    await w.call('opportunities.approve', { id: opportunity.id })
    w.clock.advance(2 * 60_000)
    expect(await w.sending.sendDuePublications()).toBe(1)
    const action = w.core.db.prepare('SELECT state, result_url AS url, result_external_id AS id FROM send_actions').get() as { state: string; url: string; id: string }
    expect(action).toMatchObject({ state: 'confirmed', url: expect.stringMatching(/^https:\/\/www\.facebook\.com\/natalmystic\/posts\/\d+$/), id: expect.stringMatching(new RegExp(`^fb:${PAGE_ID}_\\d+$`)) })
    expect(w.facebook.calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: `${PAGE_ID}/feed`, params: { message: 'Mercury turns direct today.' }, files: [] }])
  })

  it('gives Facebook the link as the link of the post, one photo as a photo with the words, and several photos as one post', async () => {
    const w = await connected()
    expect(await w.send({ text: 'Read the guide.', link: 'https://natalmystic.com/guide' })).toMatchObject({ status: 'confirmed' })
    expect(w.facebook.calls.at(-2)).toMatchObject({ path: `${PAGE_ID}/feed`, params: { message: 'Read the guide.\n\nhttps://natalmystic.com/guide', link: 'https://natalmystic.com/guide' } })

    expect(await w.send({ text: 'Chart of the day.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(new RegExp(`^fb:${PAGE_ID}_`)) })
    expect(w.facebook.calls.at(-2)).toMatchObject({ path: `${PAGE_ID}/photos`, params: { caption: 'Chart of the day.' }, files: ['source:a.jpg'] })

    const before = w.facebook.posts.length
    expect(await w.send({ text: 'Three charts.', attachments: [picture('a.jpg'), picture('b.jpg'), picture('c.jpg')] })).toMatchObject({ status: 'confirmed' })
    expect(w.facebook.posts.length).toBe(before + 1)
    expect(w.facebook.posts[0]).toMatchObject({ message: 'Three charts.', photos: 3 })
    expect(w.facebook.calls.filter((c) => c.params.published === 'false')).toHaveLength(3)
  })

  it('sends one video with the post\'s words in one request, and takes the post Facebook makes of it from the Page\'s posts', async () => {
    const w = await connected()
    const video = { name: 'a.mp4', path: '/tmp/a.mp4', mime: 'video/mp4', sha256: 'x' }
    // Facebook answers with the number of the video and shows the post only when it has processed it: here, at the third look.
    w.facebook.videoLooks = 2
    const asked = w.facebook.calls.length
    const sent = await w.send({ text: 'A reel.', attachments: [video] })
    const post = w.facebook.posts[0]
    expect(sent).toEqual({ status: 'confirmed', url: `https://www.facebook.com/natalmystic/posts/${post?.id.split('_')[1]}`, externalId: `fb:${post?.id}` })
    const calls = w.facebook.calls.slice(asked)
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: `${PAGE_ID}/videos`, params: { description: 'A reel.' }, files: ['source:a.mp4'] }])
    expect([...w.facebook.videos.values()]).toEqual(['a.mp4'])
    expect(calls.filter((c) => c.method === 'GET' && c.path === `${PAGE_ID}/feed`)).toHaveLength(3)
    // The number of the video is never taken for the number of the post.
    expect([...w.facebook.videos.keys()]).not.toContain(post?.id.split('_')[1])
  })

  it('leaves a video whose post has not appeared in three minutes as not known, and finds it on the next look; a refusal of the video is a failure', async () => {
    const w = await connected()
    const video = { name: 'long.mp4', path: '/tmp/long.mp4', mime: 'video/mp4', sha256: 'x' }
    const request = { kind: 'post' as const, destination: w.channel.url, parentExternalId: null, title: null, text: 'A long reel.', link: null, attachments: [video], attemptedAt: w.core.clock.now().toISOString() }
    // Facebook shows the post at the 38th look: the send looks 36 times.
    w.facebook.videoLooks = 37
    const asked = w.facebook.calls.length
    const sent = await w.send(request)
    expect(sent).toMatchObject({ status: 'unknown', error: expect.stringMatching(/Facebook took the video, and the post is not on the Page yet/) })
    expect(w.facebook.calls.filter((c) => c.path === `${PAGE_ID}/videos`)).toHaveLength(1)
    expect(w.facebook.calls.slice(asked).filter((c) => c.method === 'GET' && c.path === `${PAGE_ID}/feed`)).toHaveLength(36)
    // Not found yet: nothing is concluded from that.
    expect(await w.connector.findPublished(w.ctx, request)).toBeNull()
    expect(await w.connector.findPublished(w.ctx, request)).toMatchObject({ externalId: `fb:${w.facebook.posts[0]?.id}` })

    w.facebook.failNext = { code: 100, message: '(#100) The video file is not supported' }
    const before = w.facebook.posts.length
    expect(await w.send({ text: 'Another.', attachments: [video] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/Nothing was sent/) })
    w.facebook.failNext = 'lost'
    expect(await w.send({ text: 'A third.', attachments: [video] })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/not known whether it took the video/) })
    expect(w.facebook.posts.length).toBe(before + 1)
  })

  it('refuses a video with photos, two videos and an empty post before anything is asked of Facebook, and says the mix before the owner approves', async () => {
    const w = await connected()
    const asked = w.facebook.calls.length
    const video = { name: 'a.mp4', path: '/tmp/a.mp4', mime: 'video/mp4', sha256: 'x' }
    expect(await w.send({ text: 'A reel.', attachments: [video, picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/photos or one video, not both and not two videos/) })
    expect(await w.send({ text: 'A reel.', attachments: [video, { ...video, name: 'b.mp4' }] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/not two videos/) })
    expect(await w.send({ text: 'A reel.', attachments: [video], publishAt: new Date(w.core.clock.now().getTime() + 3_600_000).toISOString() })).toMatchObject({ status: 'failed', error: expect.stringMatching(/not given to Facebook's own schedule/) })
    expect(await w.send({ text: '  ' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/empty/) })
    expect(w.facebook.calls.length).toBe(asked)
    const rendered = { ...renderForPlatform({ title: null, text: 'A reel.', link: null, attachments: [] } as never, 'facebook'), attachments: [video] }
    // One video goes through the Page's API; a video beside a photo does not, and the preview says so.
    expect(sendProblems('facebook', rendered, { aiBrowser: false, api: true })).toEqual([])
    expect(sendProblems('facebook', { ...rendered, attachments: [video, picture('a.jpg')] }, { aiBrowser: false, api: true }).join(' ')).toMatch(/Facebook takes pictures or one video in a post through its API, not both/)
    expect(sendProblems('telegram', { ...rendered, attachments: [video] }, { aiBrowser: false, api: true }).join(' ')).not.toMatch(/video is not sent/)
    // A post with a video is not given to Facebook's own schedule; one without a video is.
    const request = { kind: 'post' as const, destination: w.channel.url, parentExternalId: null, title: null, text: 'A reel.', link: null, attachments: [video] }
    expect(w.connector.ownSchedule?.takes?.(request)).toBe(false)
    expect(w.connector.ownSchedule?.takes?.({ ...request, attachments: [picture('a.jpg')] })).toBe(true)
  })

  it('says a refusal as a failure, an error of Facebook\'s own side and a lost answer as unknown, and finds the lost post in the Page\'s feed', async () => {
    const w = await connected()
    const make = async (text: string) => {
      const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text } })
      await w.call('opportunities.approve', { id: opportunity.id })
      return opportunity.id
    }
    w.facebook.failNext = { code: 200, message: '(#200) The user hasn\'t authorized the application to perform this action' }
    expect(await w.sending.send(await make('First.'))).toMatchObject({ state: 'failed', error: expect.stringMatching(/no permission for this.*Nothing was sent/) })

    w.facebook.failNext = { status: 500, code: 2, message: 'An unexpected error has occurred. Please retry your request later.' }
    expect(await w.send({ text: 'Half.' })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/error of its own/) })

    w.facebook.failNext = 'lost'
    const lostId = await make('Second.')
    expect(await w.sending.send(lostId)).toMatchObject({ state: 'unknown', error: expect.stringMatching(/did not answer/) })
    // Facebook did make the post: the re-check finds it among the Page's posts.
    expect(await w.sending.reconcile(lostId)).toMatchObject({ state: 'confirmed', resultExternalId: expect.stringMatching(/^fb:/) })

    // A photo that fails among several leaves nothing published, and that is a plain failure.
    const posts = w.facebook.posts.length
    w.facebook.failNext = { code: 100, message: '(#100) Invalid image' }
    expect(await w.send({ text: 'Two.', attachments: [picture('a.jpg'), picture('b.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/Nothing was published/) })
    expect(w.facebook.posts.length).toBe(posts)
  })
})

describe('comments, replies and numbers', () => {
  it('reads a comment under the Page\'s post as an item to answer, and the Page\'s own words as nobody to answer', async () => {
    const w = await connected()
    const post = w.facebook.ownerPosts('What does a natal chart show?')
    const comment = w.facebook.comment(post.id, 'Does it need the exact birth time?', 'Ann Lee')
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    const items = w.core.db.prepare('SELECT c.external_id AS comment, c.author, c.body FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE o.channel_id = ?').all(w.channel.id)
    expect(items).toEqual([{ comment: `fb:${comment.id}`, author: 'Ann Lee', body: 'Does it need the exact birth time?' }])
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ?').get(w.channel.id)).toEqual({ n: 1 })

    const sent = await w.send({ kind: 'reply', parentExternalId: `fb:${comment.id}`, text: 'An hour either way changes the houses.' })
    expect(sent).toMatchObject({ status: 'confirmed', url: expect.stringContaining('comment_id=') })
    expect(w.facebook.calls.at(-2)).toMatchObject({ method: 'POST', path: `${comment.id}/comments`, params: { message: 'An hour either way changes the houses.' } })
    const thread = await w.connector.fetchThread(w.ctx, `fb:${post.id}`)
    expect(thread?.comments.map((c) => [c.author, c.parentExternalId])).toEqual([
      ['Ann Lee', `fb:${post.id}`],
      ['Natal Mystic', `fb:${comment.id}`]
    ])
    // The Page's own answer makes no item at the next reading.
    await w.monitor.runChannel(w.channel.id)
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ?').get(w.channel.id)).toEqual({ n: 1 })
  })

  it('names nobody when Facebook leaves the commenter out, says a long thread is not whole, and refuses a reply to what it never read', async () => {
    const w = await connected()
    const post = w.facebook.ownerPosts('Chart of the day.')
    w.facebook.namesAuthors = false
    for (let i = 0; i < 101; i++) w.facebook.comment(post.id, `Comment ${i}`, 'Bo')
    const thread = await w.connector.fetchThread(w.ctx, `fb:${post.id}`)
    expect(thread).toMatchObject({ incomplete: true, author: 'Natal Mystic' })
    expect(thread?.comments).toHaveLength(100)
    expect(thread?.comments[0]?.author).toBe('Somebody on Facebook')
    expect(await w.connector.fetchThread(w.ctx, 'fb:100200300400_1')).toBeNull()
    expect(await w.send({ kind: 'reply', parentExternalId: 't1_abc', text: 'Hi' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/was not read through the Page/) })
    expect(await w.send({ kind: 'reply', parentExternalId: `fb:${post.id}`, text: 'Hi', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/words only/) })
  })

  it('counts reactions, comments and views under a post through the Results reading, and followers as the channel\'s number', async () => {
    const w = await connected()
    const sent = await w.send({ text: 'Full moon tonight.' })
    if (sent.status !== 'confirmed') throw new Error('not sent')
    const graphId = sent.externalId.slice(3)
    w.facebook.react(graphId, 7)
    const first = w.facebook.comment(graphId, 'Beautiful.', 'Ann')
    w.facebook.comment(graphId, 'Agreed.', 'Bo', first.id)
    w.facebook.seen(graphId, 140)
    const asked = [{ externalId: sent.externalId, url: sent.url }, { externalId: 'fb:100200300400_1', url: null }, { externalId: 't3_x', url: null }]
    expect(await w.connector.readPostNumbers?.(w.ctx, asked)).toEqual({ [sent.externalId]: { likes: 7, comments: 2, views: 140 } })
    expect(w.facebook.calls.find((c) => c.path.endsWith('/insights'))?.params).toEqual({ metric: 'post_media_view' })
    expect(await w.call('results.posts', { channelId: w.channel.id })).toMatchObject({ readable: true, byAi: false })
    expect(await w.connector.fetchMetrics(w.ctx)).toEqual([{ key: 'followers', label: 'Followers', value: 321, available: true }])
  })

  it('reads reactions and comments all the same when Facebook does not give views, and asks for views once in a reading', async () => {
    const w = await connected()
    const one = await w.send({ text: 'One.' })
    const two = await w.send({ text: 'Two.' })
    if (one.status !== 'confirmed' || two.status !== 'confirmed') throw new Error('not sent')
    w.facebook.react(two.externalId.slice(3), 3)
    w.facebook.givesViews = false
    w.facebook.calls.length = 0
    expect(await w.connector.readPostNumbers?.(w.ctx, [{ externalId: one.externalId, url: one.url }, { externalId: two.externalId, url: two.url }])).toEqual({
      [one.externalId]: { likes: 0, comments: 0, views: null },
      [two.externalId]: { likes: 3, comments: 0, views: null }
    })
    expect(w.facebook.calls.filter((c) => c.path.endsWith('/insights'))).toHaveLength(1)
  })
})

describe('a post given to Facebook\'s own schedule (DEC-077)', () => {
  const HOUR = 3_600_000
  const later = (w: { core: { clock: { now(): Date } } }, ms: number) => new Date(w.core.clock.now().getTime() + ms).toISOString()
  const scheduledPost = async (w: Awaited<ReturnType<typeof connected>>, text: string, at: string, attachments: ReturnType<typeof picture>[] = []) => {
    const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text, attachments } as never })
    await w.call('publications.schedule', { id: opportunity.id, at })
    await w.call('opportunities.approve', { id: opportunity.id })
    return opportunity.id
  }
  const stateOf = (w: Awaited<ReturnType<typeof connected>>, id: string) => (w.core.db.prepare('SELECT state, reason FROM opportunities WHERE id = ?').get(id) as { state: string; reason: string })

  it('is made unpublished with its time in seconds; Facebook publishes it with this application doing nothing, and it is recorded with Facebook\'s address', async () => {
    const w = await connected()
    const at = later(w, 3 * HOUR)
    const id = await scheduledPost(w, 'Venus enters Capricorn.', at)

    expect(await w.sending.keepOwnSchedules()).toBe(1)
    expect(w.facebook.calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', path: `${PAGE_ID}/feed`, params: { message: 'Venus enters Capricorn.', published: 'false', scheduled_publish_time: String(Math.floor(Date.parse(at) / 1000)) }, files: [] }
    ])
    expect(w.facebook.kept).toHaveLength(1)
    expect(stateOf(w, id)).toEqual({ state: 'ready', reason: 'Facebook keeps this post and publishes it at its time, even with this Mac off. Change or cancel it here and it is taken back first.' })

    w.clock.advance(3 * HOUR + 60_000)
    w.facebook.nowMs = w.core.clock.now().getTime()
    w.facebook.runSchedule()
    expect(await w.sending.sendDuePublications()).toBe(0)
    await w.sending.keepOwnSchedules()

    expect(stateOf(w, id).state).toBe('confirmed')
    const action = w.core.db.prepare('SELECT state, attempted_at AS at, result_url AS url FROM send_actions').get() as { state: string; at: string; url: string }
    expect(action).toMatchObject({ state: 'confirmed', at, url: expect.stringMatching(/^https:\/\/www\.facebook\.com\/natalmystic\/posts\/\d+$/) })
    expect(w.facebook.posts).toHaveLength(1)
  })

  it('is recorded from the Page\'s own posts when Facebook gave the published post another number', async () => {
    const w = await connected()
    const id = await scheduledPost(w, 'Venus enters Capricorn.', later(w, 3 * HOUR))
    await w.sending.keepOwnSchedules()
    w.clock.advance(3 * HOUR + 60_000)
    w.facebook.nowMs = w.core.clock.now().getTime()
    w.facebook.runSchedule({ renumbered: true })

    await w.sending.keepOwnSchedules()

    expect(stateOf(w, id).state).toBe('confirmed')
    expect(w.facebook.posts).toHaveLength(1)
  })

  it('with a video: the post is not given to Facebook, and goes out from this application at its time', async () => {
    const w = await connected()
    const at = later(w, 3 * HOUR)
    const folder = mkdtempSync(join(tmpdir(), 'facebook-test-'))
    // A draft's video is a real file: the application reads it when the draft is saved.
    writeFileSync(join(folder, 'a.mp4'), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]))
    const id = await scheduledPost(w, 'A reel.', at, [{ name: 'a.mp4', path: join(folder, 'a.mp4'), mime: 'video/mp4', sha256: 'a.mp4' }])
    const asked = w.facebook.calls.length

    expect(await w.sending.keepOwnSchedules()).toBe(0)
    expect(await w.sending.keepOwnSchedules()).toBe(0)
    expect(w.facebook.calls.length).toBe(asked)
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM platform_schedules').get()).toEqual({ n: 0 })
    expect(stateOf(w, id).state).toBe('ready')

    w.clock.advance(3 * HOUR + 60_000)
    w.facebook.nowMs = w.core.clock.now().getTime()
    expect(await w.sending.sendDuePublications()).toBe(1)
    expect(stateOf(w, id).state).toBe('confirmed')
    expect(w.facebook.calls.slice(asked).filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: `${PAGE_ID}/videos`, params: { description: 'A reel.' }, files: ['source:a.mp4'] }])
  })

  it('with photos: each photo is uploaded as a temporary unpublished one, and the post names them as a scheduled post', async () => {
    const w = await connected()
    const at = later(w, 3 * HOUR)
    // A draft's pictures are real files: the application reads them when the draft is saved.
    const folder = mkdtempSync(join(tmpdir(), 'facebook-test-'))
    const file = (name: string) => {
      writeFileSync(join(folder, name), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(name)]))
      return { ...picture(name), path: join(folder, name), sha256: name }
    }
    await scheduledPost(w, 'Two charts.', at, [file('a.jpg'), file('b.jpg')])

    expect(await w.sending.keepOwnSchedules()).toBe(1)

    const made = w.facebook.calls.filter((c) => c.method === 'POST')
    expect(made.slice(0, 2).map((c) => ({ path: c.path, params: c.params }))).toEqual([
      { path: `${PAGE_ID}/photos`, params: { published: 'false', temporary: 'true' } },
      { path: `${PAGE_ID}/photos`, params: { published: 'false', temporary: 'true' } }
    ])
    expect(made[2]?.params).toMatchObject({ message: 'Two charts.', published: 'false', scheduled_publish_time: String(Math.floor(Date.parse(at) / 1000)), unpublished_content_type: 'SCHEDULED' })
    expect(w.facebook.kept[0]?.photos).toBe(2)
  })

  it('is deleted on Facebook when the owner edits the post, so only the new words can go out', async () => {
    const w = await connected()
    const id = await scheduledPost(w, 'First words.', later(w, 3 * HOUR))
    await w.sending.keepOwnSchedules()

    await w.call('opportunities.saveDraft', { id, draft: { title: null, text: 'Second words.' } })
    await w.sending.keepOwnSchedules()
    expect(w.facebook.kept).toHaveLength(0)
    expect(w.facebook.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)

    await w.call('opportunities.approve', { id })
    await w.sending.keepOwnSchedules()
    expect(w.facebook.kept.map((p) => p.message)).toEqual(['Second words.'])
  })

  it('that Facebook will not delete stays said on the item, and Send is refused: the post is never sent a second time', async () => {
    const w = await connected()
    const id = await scheduledPost(w, 'First words.', later(w, 3 * HOUR))
    await w.sending.keepOwnSchedules()
    w.facebook.refusesDelete = true

    const refused = await w.sending.send(id).catch((error: unknown) => error as { block?: { code: string; reasons: string[] } })

    expect((refused as { block?: { code: string } }).block?.code).toBe('kept_by_platform')
    expect(stateOf(w, id).reason).toMatch(/Facebook still keeps an earlier version of a post .* could not be taken back.*Delete it among Facebook's scheduled posts/)
    expect(w.facebook.posts.filter((p) => p.published)).toHaveLength(0)
    expect(w.facebook.kept).toHaveLength(1)
  })

  it('whose answer was lost is found among the Page\'s scheduled posts by its time and words, and not made twice', async () => {
    const w = await connected()
    await scheduledPost(w, 'Venus enters Capricorn.', later(w, 3 * HOUR))
    w.facebook.failNext = 'lost'
    expect(await w.sending.keepOwnSchedules()).toBe(0)
    expect(w.facebook.kept).toHaveLength(1)

    w.clock.advance(6 * 60_000)
    await w.sending.keepOwnSchedules()

    expect(w.core.db.prepare('SELECT external_id AS id, problem FROM platform_schedules').get()).toEqual({ id: `fb:${w.facebook.kept[0]?.id}`, problem: null })
    expect(w.facebook.kept).toHaveLength(1)
  })

  it('is not asked of Facebook for a post nearer than a quarter of an hour: that one goes out from this application at its time', async () => {
    const w = await connected()
    await scheduledPost(w, 'Soon.', later(w, 12 * 60_000))
    expect(await w.sending.keepOwnSchedules()).toBe(0)
    expect(w.facebook.calls.filter((c) => c.method === 'POST')).toEqual([])
    w.clock.advance(13 * 60_000)
    expect(await w.sending.sendDuePublications()).toBe(1)
    expect(w.facebook.posts.filter((p) => p.published).map((p) => p.message)).toEqual(['Soon.'])
  })
})

describe('a Reel on a Facebook Page (DEC-092)', () => {
  const makeVideoFile = (name = 'vertical.mp4', size = 64) => {
    const folder = mkdtempSync(join(tmpdir(), 'facebook-reel-test-'))
    const path = join(folder, name)
    const content = size === 0 ? Buffer.alloc(0) : Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(Math.max(0, size - 12))])
    writeFileSync(path, content)
    return { name, path, mime: 'video/mp4', sha256: `${name}-${size}`, bytes: content.length }
  }

  it('publishes a Reel in three steps (start, upload to rupload, finish) and waits until Facebook says published', async () => {
    const w = await connected()
    const clip = makeVideoFile('chart-reel.mp4', 80)
    w.facebook.reelLooks = 3
    const { opportunity } = await w.call('publications.create', {
      channelId: w.channel.id,
      draft: { title: null, text: 'Watch how a transit shifts.', attachments: [{ name: clip.name, path: clip.path, mime: clip.mime, sha256: clip.sha256 }], videoAs: 'reel' }
    })
    expect(w.core.repos.latestDraft(opportunity.id)?.videoAs).toBe('reel')
    await w.call('opportunities.approve', { id: opportunity.id })
    const asked = w.facebook.calls.length

    const action = await w.sending.send(opportunity.id)
    expect(action).toMatchObject({ state: 'confirmed', resultUrl: expect.stringMatching(/^https:\/\/www\.facebook\.com\/reel\/\d+\/$/), resultExternalId: expect.stringMatching(/^fb:\d+$/) })
    const calls = w.facebook.calls.slice(asked)
    const videoId = action.resultExternalId!.slice(3)
    expect(calls.filter((c) => c.method === 'POST')).toEqual([
      { method: 'POST', path: `${PAGE_ID}/video_reels`, params: { upload_phase: 'start' }, files: [] },
      { method: 'POST', path: `rupload/${videoId}`, params: { offset: '0', file_size: String(clip.bytes) }, files: ['chart-reel.mp4'] },
      { method: 'POST', path: `${PAGE_ID}/video_reels`, params: { upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: 'Watch how a transit shifts.' }, files: [] }
    ])
    expect(calls.filter((c) => c.method === 'GET' && c.path === videoId && c.params.fields === 'status')).toHaveLength(3)
    expect(JSON.stringify(w.core.db.prepare('SELECT * FROM log_events').all())).not.toContain(FAKE_PAGE_TOKEN)
  })

  it('fails with Facebook\'s processing error, fails cleanly before finish, and reconciles a slow or lost finish from video_reels', async () => {
    const w = await connected()
    const clip = makeVideoFile('bad-ratio.mp4', 72)

    // Facebook refuses the video during processing: named in Facebook's words, nothing published.
    w.facebook.reelLooks = 2
    w.facebook.reelError = 'Video aspect ratio must be 9:16 for Reels.'
    expect(await w.send({ text: 'Wrong shape.', attachments: [clip], videoAs: 'reel' })).toMatchObject({
      status: 'failed',
      error: 'Facebook did not publish the Reel: Video aspect ratio must be 9:16 for Reels. Nothing was published.'
    })

    // Upload fails before finish -> definite failure, nothing sent.
    w.facebook.reelError = null
    w.facebook.reelLooks = 1
    w.facebook.failNext = { code: 100, message: '(#100) Reel start refused' }
    expect(await w.send({ text: 'Start refused.', attachments: [clip], videoAs: 'reel' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/Nothing was sent/) })

    // Lost answer on finish -> unknown, reconciled via GET /{page-id}/video_reels.
    const { opportunity } = await w.call('publications.create', {
      channelId: w.channel.id,
      draft: { title: null, text: 'Lost finish reel.', attachments: [{ name: clip.name, path: clip.path, mime: clip.mime, sha256: clip.sha256 }], videoAs: 'reel' }
    })
    await w.call('opportunities.approve', { id: opportunity.id })
    const orig = w.facebook.request.bind(w.facebook)
    let lostOnce = false
    w.facebook.request = async (req) => {
      if (!lostOnce && req.method === 'POST' && req.form?.upload_phase === 'finish') {
        lostOnce = true
        w.facebook.failNext = 'lost'
      }
      return orig(req)
    }
    expect(await w.sending.send(opportunity.id)).toMatchObject({ state: 'unknown', error: expect.stringMatching(/not known whether the Reel is published/) })
    expect(await w.sending.reconcile(opportunity.id)).toMatchObject({ state: 'confirmed', resultUrl: expect.stringMatching(/^https:\/\/www\.facebook\.com\/reel\/\d+\/$/) })
    w.facebook.request = orig

    // Processing takes longer than 60 looks -> unknown, found on next look.
    w.facebook.reelLooks = 62
    const slowReq: PublishRequest = { kind: 'post', destination: w.channel.url, parentExternalId: null, title: null, text: 'Slow reel.', link: null, attachments: [clip], videoAs: 'reel', attemptedAt: w.core.clock.now().toISOString() }
    expect(await w.send(slowReq)).toMatchObject({ status: 'unknown', error: expect.stringMatching(/Facebook took the Reel and has not published it yet/) })
    // Still processing (looksLeft is 2 -> not yet ready in video_reels), then after status completes it is found.
    const slowReel = [...w.facebook.reels.values()].find((r) => r.description === 'Slow reel.')!
    slowReel.published = true
    expect(await w.connector.findPublished(w.ctx, slowReq)).toMatchObject({ url: `https://www.facebook.com/reel/${slowReel.id}/`, externalId: `fb:${slowReel.id}` })
  })

  it('refuses a Reel with a picture beside it, a Reel on a reply, a Reel for Facebook\'s schedule, and unreadable or empty files before asking Facebook', async () => {
    const w = await connected()
    const clip = makeVideoFile('ok.mp4', 64)
    const empty = makeVideoFile('empty.mp4', 0)
    const asked = w.facebook.calls.length

    expect(await w.send({ text: 'Mix.', attachments: [clip, picture('a.jpg')], videoAs: 'reel' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/A Reel is one video with no picture beside it.*Nothing was sent/) })
    expect(await w.send({ text: 'No video.', attachments: [picture('a.jpg')], videoAs: 'reel' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/A Reel is one video.*Nothing was sent/) })
    expect(await w.send({ kind: 'reply', parentExternalId: `fb:${PAGE_ID}_1`, text: 'Hi', videoAs: 'reel' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/A reply is not a Reel.*Nothing was sent/) })
    expect(await w.send({ text: 'Scheduled.', attachments: [clip], videoAs: 'reel', publishAt: new Date(w.core.clock.now().getTime() + 3_600_000).toISOString() })).toMatchObject({ status: 'failed', error: expect.stringMatching(/not given to Facebook's own schedule/) })
    expect(await w.send({ text: 'Missing.', attachments: [{ ...clip, path: '/nonexistent/missing.mp4' }], videoAs: 'reel' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not be read/) })
    expect(await w.send({ text: 'Empty.', attachments: [empty], videoAs: 'reel' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/is empty/) })
    expect(w.facebook.calls.length).toBe(asked)
    expect(w.connector.ownSchedule?.takes?.({ kind: 'post', destination: w.channel.url, parentExternalId: null, title: null, text: 'Reel.', link: null, attachments: [clip], videoAs: 'reel' })).toBe(false)
  })

  it('does not give a scheduled Reel to Facebook\'s own schedule and sends it as a Reel from this Mac at its time', async () => {
    const w = await connected()
    const clip = makeVideoFile('later-reel.mp4', 64)
    const at = new Date(w.core.clock.now().getTime() + 3 * 3_600_000).toISOString()
    const { opportunity } = await w.call('publications.create', {
      channelId: w.channel.id,
      draft: { title: null, text: 'Scheduled reel.', attachments: [{ name: clip.name, path: clip.path, mime: clip.mime, sha256: clip.sha256 }], videoAs: 'reel' }
    })
    await w.call('publications.schedule', { id: opportunity.id, at })
    await w.call('opportunities.approve', { id: opportunity.id })
    const asked = w.facebook.calls.length

    expect(await w.sending.keepOwnSchedules()).toBe(0)
    expect(w.facebook.calls.length).toBe(asked)
    w.clock.advance(3 * 3_600_000 + 60_000)
    w.facebook.nowMs = w.core.clock.now().getTime()
    expect(await w.sending.sendDuePublications()).toBe(1)
    expect(w.facebook.calls.slice(asked).some((c) => c.path === `${PAGE_ID}/video_reels` && c.params.upload_phase === 'finish')).toBe(true)
    expect(w.core.db.prepare('SELECT state FROM opportunities WHERE id = ?').get(opportunity.id)).toEqual({ state: 'confirmed' })
  })

  it('binds videoAs in the approval hash, carries it across text edits while the video stays, refuses it on other channels and replies, and shows it in the preview', async () => {
    const w = await connected()
    const clip = makeVideoFile('keep.mp4', 64)
    const picFolder = mkdtempSync(join(tmpdir(), 'facebook-pic-test-'))
    const picPath = join(picFolder, 'p.jpg')
    writeFileSync(picPath, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('pic')]))
    const videoAtt = { name: clip.name, path: clip.path, mime: clip.mime, sha256: clip.sha256 }
    const picAtt = { name: 'p.jpg', path: picPath, mime: 'image/jpeg', sha256: 'p.jpg' }

    // sendWays exposes reels only for a Facebook Page API channel.
    expect(await w.call('channels.sendWays', { channelId: w.channel.id })).toMatchObject({ api: true, reels: true })
    const browserAcc = await w.call('accounts.create', { productId: w.productId, platform: 'facebook', label: 'Profile', kind: 'profile' })
    const browserCh = await w.call('channels.connect', { productId: w.productId, accountId: browserAcc.id, target: 'https://www.facebook.com/personalprofile' })
    expect(await w.call('channels.sendWays', { channelId: browserCh.id })).not.toHaveProperty('reels')

    // Refused on a channel that does not publish Reels, and when a picture is beside the video.
    await expect(w.call('publications.create', { channelId: browserCh.id, draft: { title: null, text: 'No.', attachments: [videoAtt], videoAs: 'reel' } })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/does not publish a Reel/) })
    await expect(w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text: 'Mix.', attachments: [videoAtt, picAtt], videoAs: 'reel' } })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/A Reel is one video with no picture beside it/) })

    // Refused on a reply.
    const post = w.facebook.ownerPosts('A post.')
    w.facebook.comment(post.id, 'A comment?', 'Ann')
    await w.monitor.runChannel(w.channel.id)
    const reply = w.core.db.prepare("SELECT id FROM opportunities WHERE kind = 'reply' LIMIT 1").get() as { id: string }
    await expect(w.call('opportunities.saveDraft', { id: reply.id, draft: { text: 'Answer.', attachments: [videoAtt], videoAs: 'reel' } })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/A reply is not a Reel/) })

    // Kept across a text rewrite while the video stays, cleared when choosing Video post or taking the video off, and invalidates approval on change.
    const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text: 'First words.', attachments: [videoAtt], videoAs: 'reel' } })
    await w.call('opportunities.approve', { id: opportunity.id })
    expect(w.core.repos.latestDraft(opportunity.id)?.videoAs).toBe('reel')
    await w.call('opportunities.saveDraft', { id: opportunity.id, draft: { title: null, text: 'Rewritten words.', attachments: [videoAtt] } })
    expect(w.core.repos.latestDraft(opportunity.id)?.videoAs).toBe('reel')
    await w.call('opportunities.approve', { id: opportunity.id })
    await w.call('opportunities.saveDraft', { id: opportunity.id, draft: { title: null, text: 'Rewritten words.', attachments: [videoAtt], videoAs: null } })
    expect(w.core.repos.latestDraft(opportunity.id)?.videoAs).toBeNull()
    expect((w.core.db.prepare('SELECT state FROM opportunities WHERE id = ?').get(opportunity.id) as { state: string }).state).not.toBe('ready')

    // Re-set to reel, then remove video -> videoAs not carried over.
    await w.call('opportunities.saveDraft', { id: opportunity.id, draft: { title: null, text: 'Rewritten words.', attachments: [videoAtt], videoAs: 'reel' } })
    await w.call('opportunities.saveDraft', { id: opportunity.id, draft: { title: null, text: 'Words only.', attachments: [] } })
    expect(w.core.repos.latestDraft(opportunity.id)?.videoAs).toBeNull()

    // Hash binds videoAs only when set.
    const base = { title: null, text: 'Clip.', link: null, attachments: [videoAtt] }
    const acc = { id: w.account.id, identity: w.account.identity }
    const plain = contentHash(base, acc, w.channel.url, 'facebook')
    expect(contentHash({ ...base, videoAs: null }, acc, w.channel.url, 'facebook')).toBe(plain)
    expect(contentHash({ ...base, videoAs: 'reel' }, acc, w.channel.url, 'facebook')).not.toBe(plain)

    // Preview note says Reel on Facebook, nothing for a usual video post, and nothing when previewed as another platform.
    expect(renderForPlatform({ title: null, text: 'Clip.', link: null, attachments: [videoAtt], markup: 'markdown', videoAs: 'reel' }, 'facebook').notes).toContain('The video goes out as a Reel on Facebook.')
    expect(renderForPlatform({ title: null, text: 'Clip.', link: null, attachments: [videoAtt], markup: 'legacy', videoAs: 'reel' }, 'facebook').notes).toContain('The video goes out as a Reel on Facebook.')
    expect(renderForPlatform({ title: null, text: 'Clip.', link: null, attachments: [videoAtt], markup: 'markdown', videoAs: null }, 'facebook').notes).not.toContain('The video goes out as a Reel on Facebook.')
    expect(renderForPlatform({ title: null, text: 'Clip.', link: null, attachments: [videoAtt], markup: 'markdown', videoAs: 'reel' }, 'reddit').notes.join(' ')).not.toMatch(/Reel/)
  })
})
