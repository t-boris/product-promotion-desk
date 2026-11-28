import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/db/database'
import { FakeKnowledge, makeClaim } from '../../core/pipeline/test-fixture'
import { makeTestCore, type TestCore } from '../../core/testing/fakes'
import { apiKeyKey } from '../../core/vault'
import type { MonitorService, SendingService } from '../../core/services'
import type { PublishRequest } from '../../core/ports'
import { DEFAULT_PERIODIC, PeriodicTasks } from '../../core/pipeline/scheduler-periodic'
import { RecordingSink } from '../../core/pipeline/scheduler-harness'
import { guideSteps } from '../../shared/connection-guide'
import { renderForPlatform, sendProblems } from '../../shared/post-format'
import { UniversalConnector } from '../universal'
import { ThreadsApiConnector, handleOf, parseExternalId } from './connector'
import { FAKE_APP_SECRET, FAKE_LONG_TOKEN, FAKE_SHORT_TOKEN, FakeThreads, PROFILE_ID } from './fake-threads'

let t: TestCore | null = null
afterEach(async () => {
  await t?.core.shutdown()
  t = null
})

const PROFILE_URL = 'https://www.threads.net/@natalmystic'
const DAY = 24 * 3_600_000

/** A core with the Threads API connector and a fake Threads behind the network port; one product. */
function world(threads = new FakeThreads()) {
  t = makeTestCore({ connectors: [new ThreadsApiConnector(), new UniversalConnector()], http: threads })
  const core = t.core
  core.services.knowledge = Object.assign(new FakeKnowledge(), { approved: [makeClaim('c1', 'Natal Mystic builds a natal chart from your birth date, time and place.')] })
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goals_json, active_passport_version_id, analysis_status, created_at, updated_at, add_site_link) VALUES (?, ?, ?, ?, json_array(), ?, ?, ?, ?, 0)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)
  threads.startAt(core.clock.now().getTime())
  const logged = (): string => JSON.stringify(core.db.prepare('SELECT * FROM log_events').all())
  return { core, threads, productId, secrets: t.secrets, clock: t.clock, logged, call: core.router.call.bind(core.router) as typeof core.router.call }
}

/** A Threads account with its token saved and the profile connected, assessed and active. */
async function connected(threads = new FakeThreads()) {
  const w = world(threads)
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'threads', label: 'Natal Mystic on Threads', access: 'api' })
  const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_LONG_TOKEN })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: PROFILE_URL })
  await w.call('channels.assess', { channelId: channel.id })
  const active = await w.call('channels.activate', { channelId: channel.id })
  const { connector, ctx } = w.core.connectorContext(active.id)
  const loose = { ...ctx, tickets: { assertValid: () => undefined } }
  const ticket = { id: 't', actionId: 'a', contentHash: 'h', accountId: ready.id, destination: active.url, expiresAt: 0, signature: '' }
  const send = (request: Partial<PublishRequest>) => connector.publish(loose, ticket, { kind: 'post', destination: active.url, parentExternalId: null, title: null, text: '', link: null, attachments: [], ...request })
  return { ...w, account: ready, channel: active, connector, ctx, send, sending: w.core.services.sending as SendingService, monitor: w.core.services.monitor as MonitorService }
}

const picture = (name: string) => ({ name, path: `/tmp/${name}`, mime: 'image/jpeg', sha256: 'x' })
const made = (w: { threads: FakeThreads }) => w.threads.calls.filter((c) => c.method === 'POST')

describe('the address of a Threads profile', () => {
  it('is the profile itself, on either of Threads\' hosts or as a handle, and never a post', () => {
    expect(handleOf('https://www.threads.net/@NatalMystic')).toBe('natalmystic')
    expect(handleOf('threads.com/@natal.mystic/')).toBe('natal.mystic')
    expect(handleOf('@natal_mystic')).toBe('natal_mystic')
    expect(handleOf('https://www.threads.net/@natalmystic/post/Abc')).toBeNull()
    expect(handleOf('https://www.threads.net/search?q=x')).toBeNull()
    expect(handleOf('https://www.instagram.com/natalmystic')).toBeNull()
    expect(parseExternalId('th:17900000000000001')).toBe('17900000000000001')
    expect(parseExternalId('fb:1_2')).toBeNull()
  })
})

describe('a Threads account that works through the Threads API (DEC-080)', () => {
  it('is offered for Threads beside the browser account, with the steps that get the token and a secret asked once; the API connector is never chosen by an address alone', async () => {
    const w = world()
    const info = (await w.call('platforms.list', undefined as never)).find((p) => p.platform === 'threads')
    expect(info).toMatchObject({ connectorId: 'universal', api: { accountKind: 'developer app', keyLabel: 'Threads access token', onceSecret: { label: 'Threads app secret' } } })
    expect(w.core.connectors.resolve(PROFILE_URL)?.id).toBe('universal')
    const steps = guideSteps(info, { kind: null, access: 'api' })
    expect(steps.length).toBe(8)
    expect(steps.filter((s) => s.url).every((s) => s.link)).toBe(true)
    expect(steps.map((s) => s.text).join(' ')).toMatch(/Access the Threads API.*threads_content_publish.*Threads Tester.*Threads app secret.*Go live/s)
  })

  it('keeps a token that lasts as it is, and becomes ready under the profile\'s name', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'threads', label: 'Threads', access: 'api' })
    expect(account).toMatchObject({ access: 'api', status: 'login_required' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: 'not a token' })).rejects.toMatchObject({ code: 'invalid_input' })
    const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: ` ${FAKE_LONG_TOKEN} ` })
    expect(ready).toMatchObject({ status: 'ready', identity: '@natalmystic' })
    expect(w.secrets.values.get(apiKeyKey(account.id))).toBe(FAKE_LONG_TOKEN)
    expect(w.logged()).toMatch(/it lasts until \d{4}-\d{2}-\d{2} and the application renews it by itself/)
    expect(w.logged()).not.toContain(FAKE_LONG_TOKEN)
  })

  it('refuses a token of an hour without the secret, and with the secret exchanges it for the 60-day token that is kept; the secret is kept nowhere', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'threads', label: 'Threads', access: 'api' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_SHORT_TOKEN })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/short one.*Threads app secret/s) })
    expect(w.secrets.values.has(apiKeyKey(account.id))).toBe(false)
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_SHORT_TOKEN, secret: 'the-other-secret-of-the-app' })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/did not exchange the token.*Invalid client secret/s) })
    expect(w.secrets.values.has(apiKeyKey(account.id))).toBe(false)

    const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_SHORT_TOKEN, secret: ` ${FAKE_APP_SECRET} ` })
    expect(ready).toMatchObject({ status: 'ready', identity: '@natalmystic' })
    const kept = w.secrets.values.get(apiKeyKey(account.id)) as string
    expect(kept).toMatch(/^THfakeMintedToken001/)
    expect(w.threads.tokens.get(kept)?.expiresAt).toBe(w.threads.nowMs + 60 * DAY)
    // Nothing the application keeps or writes holds the secret or a token.
    expect([...w.secrets.values.values()].join(' ')).not.toContain(FAKE_APP_SECRET)
    const everything = w.logged() + JSON.stringify(ready) + JSON.stringify(w.core.db.prepare('SELECT * FROM accounts').all())
    for (const hidden of [FAKE_APP_SECRET, FAKE_SHORT_TOKEN, kept]) expect(everything).not.toContain(hidden)
  })

  it('says an ended token in words, and keeps a token Threads says nothing about as it is', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'threads', label: 'Threads', access: 'api' })
    w.threads.tokens.set(FAKE_SHORT_TOKEN, { issuedAt: w.threads.nowMs - 2 * 3_600_000, expiresAt: w.threads.nowMs - 3_600_000 })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_SHORT_TOKEN, secret: FAKE_APP_SECRET })).rejects.toMatchObject({ message: expect.stringMatching(/does not accept this token/) })
    w.threads.tellsTokenFacts = false
    expect(await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_LONG_TOKEN })).toMatchObject({ status: 'ready' })
    expect(w.secrets.values.get(apiKeyKey(account.id))).toBe(FAKE_LONG_TOKEN)
  })

  it('renews the token by itself once less than 45 days are left of it, puts the new one into the vault, and leaves an ended one for the account\'s page to say', async () => {
    const w = await connected()
    const keys = w.core.services.keys as { renewDue(): Promise<number> }
    // 58 days left: nothing to do.
    expect(await keys.renewDue()).toBe(0)
    expect(w.secrets.values.get(apiKeyKey(w.account.id))).toBe(FAKE_LONG_TOKEN)

    w.clock.advance(20 * DAY)
    w.threads.nowMs = w.core.clock.now().getTime()
    expect(await keys.renewDue()).toBe(1)
    const renewed = w.secrets.values.get(apiKeyKey(w.account.id)) as string
    expect(renewed).not.toBe(FAKE_LONG_TOKEN)
    expect(w.threads.tokens.get(renewed)?.expiresAt).toBe(w.threads.nowMs + 60 * DAY)
    expect(w.logged()).toMatch(/The Threads access token of Natal Mystic on Threads was renewed; it lasts until/)
    expect(w.logged()).not.toContain(renewed)
    // The renewed token works, and one made an hour ago is not renewed again.
    expect((await w.call('accounts.checkLogin', { accountId: w.account.id })).status).toBe('ready')
    expect(await keys.renewDue()).toBe(0)

    w.clock.advance(61 * DAY)
    w.threads.nowMs = w.core.clock.now().getTime()
    expect(await keys.renewDue()).toBe(0)
    expect(w.secrets.values.get(apiKeyKey(w.account.id))).toBe(renewed)
    expect(w.logged()).toMatch(/could not be renewed: Threads does not accept the access token/)
    expect((await w.call('accounts.checkLogin', { accountId: w.account.id })).status).not.toBe('ready')
  })

  it('is looked at for renewal by the scheduler every six hours, also while automation is paused', async () => {
    const w = await connected()
    const tasks = new PeriodicTasks(w.core, DEFAULT_PERIODIC, new RecordingSink())
    await tasks.reconcileAtStartup()
    const asked = (): number => w.threads.calls.filter((c) => c.path === 'debug_token').length
    const before = asked()
    const now = w.core.clock.now().getTime()
    tasks.tick(now, true)
    await tasks.idle()
    expect(asked()).toBe(before + 1)
    tasks.tick(now + 3_600_000, true)
    await tasks.idle()
    expect(asked()).toBe(before + 1)
    tasks.tick(now + 6 * 3_600_000, false)
    await tasks.idle()
    expect(asked()).toBe(before + 2)
  })

  it('checks that the token is of the profile that was connected, and reads its posts and replies before saying it can', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'threads', label: 'Threads', access: 'api' })
    await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_LONG_TOKEN })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://www.threads.net/@natalmystic/post/Abc' })).rejects.toMatchObject({ code: 'platform_mismatch' })

    const other = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: '@someoneelse' })
    const wrong = await w.call('channels.assess', { channelId: other.id })
    expect(wrong.capabilities.find((c) => c.key === 'publish_post')).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/belongs to the profile @natalmystic/) })

    const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: 'threads.com/@NatalMystic' })
    expect(channel).toMatchObject({ connectorId: 'threads-api', target: '@natalmystic', url: 'https://www.threads.net/@natalmystic', reads: true, watchedInBrowser: false })
    const cap = async (key: string) => (await w.call('channels.assess', { channelId: channel.id })).capabilities.find((c) => c.key === key)
    expect(await cap('read_posts')).toMatchObject({ status: 'verified' })
    expect(await cap('read_comments')).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/no post yet/) })
    w.threads.ownerPosts('Hello.')
    expect(await cap('read_comments')).toMatchObject({ status: 'verified' })
    // A send is proven by a send, never by a check.
    expect(await cap('publish_post')).toMatchObject({ status: 'needs_check', detail: expect.stringMatching(/Go live/) })
  })
})

describe('posting as the profile', () => {
  it('sends an approved post with its topic by itself at its time: a container, then the request that publishes it, confirmed with the post Threads made', async () => {
    const w = await connected()
    const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text: 'Mercury turns direct today.', topicTag: 'Astrology' } })
    await w.call('publications.schedule', { id: opportunity.id, at: new Date(w.core.clock.now().getTime() + 60_000).toISOString() })
    await w.call('opportunities.approve', { id: opportunity.id })
    w.clock.advance(2 * 60_000)
    expect(await w.sending.sendDuePublications()).toBe(1)
    const action = w.core.db.prepare('SELECT state, result_url AS url, result_external_id AS id FROM send_actions').get() as { state: string; url: string; id: string }
    expect(action).toMatchObject({ state: 'confirmed', url: expect.stringMatching(/^https:\/\/www\.threads\.com\/@natalmystic\/post\/p\d+$/), id: expect.stringMatching(/^th:\d+$/) })
    const container = w.threads.containers[0]?.id
    expect(made(w)).toEqual([
      { method: 'POST', path: `${PROFILE_ID}/threads`, params: { media_type: 'TEXT', text: 'Mercury turns direct today.', topic_tag: 'Astrology' } },
      { method: 'POST', path: `${PROFILE_ID}/threads_publish`, params: { creation_id: container } }
    ])
    expect(w.threads.posts[0]).toMatchObject({ text: 'Mercury turns direct today.', topic: 'Astrology' })
  })

  it('puts the link last in the words, and waits while Threads prepares the post', async () => {
    const w = await connected()
    w.threads.containerStates = ['IN_PROGRESS', 'IN_PROGRESS']
    expect(await w.send({ text: 'Read the guide.', link: 'https://natalmystic.com/guide' })).toMatchObject({ status: 'confirmed' })
    expect(made(w)[0]?.params).toEqual({ media_type: 'TEXT', text: 'Read the guide.\n\nhttps://natalmystic.com/guide' })
    expect(w.threads.calls.filter((c) => c.params.fields === 'status,error_message')).toHaveLength(3)
  })

  it('publishes nothing when Threads could not prepare the post, or never finished preparing it', async () => {
    const w = await connected()
    w.threads.containerStates = ['ERROR']
    expect(await w.send({ text: 'One.' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not prepare the post \(UNKNOWN\)\. Nothing was published/) })
    w.threads.containerStates = Array.from({ length: 12 }, () => 'IN_PROGRESS')
    expect(await w.send({ text: 'Two.' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/still preparing the post after a minute/) })
    expect(w.threads.posts).toHaveLength(0)
    expect(made(w).filter((c) => c.path.endsWith('threads_publish'))).toHaveLength(0)
  })

  it('refuses a picture, a video and an empty post before anything is asked of Threads, and says the picture before the owner approves', async () => {
    const w = await connected()
    const asked = w.threads.calls.length
    const video = { name: 'a.mp4', path: '/tmp/a.mp4', mime: 'video/mp4', sha256: 'x' }
    expect(await w.send({ text: 'A chart.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/only from a public address.*Nothing was sent/s) })
    expect(await w.send({ text: 'A reel.', attachments: [video] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/Nothing was sent/) })
    expect(await w.send({ text: '  ' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/empty/) })
    expect(w.threads.calls.length).toBe(asked)
    const rendered = renderForPlatform({ title: null, text: 'A chart.', link: null, attachments: [] } as never, 'threads')
    expect(sendProblems('threads', { ...rendered, attachments: [picture('a.jpg')] }, { aiBrowser: false, api: true }).join(' ')).toMatch(/A picture is not sent to Threads through its API/)
    expect(sendProblems('threads', { ...rendered, attachments: [video] }, { aiBrowser: false, api: true }).join(' ')).toMatch(/A video is not sent to Threads through its API/)
    // The browser way of Threads carries a picture as before.
    expect(sendProblems('threads', { ...rendered, attachments: [picture('a.jpg')] }, { aiBrowser: true, api: false }).join(' ')).not.toMatch(/through its API/)
    expect(sendProblems('facebook', { ...rendered, attachments: [picture('a.jpg')] }, { aiBrowser: false, api: true }).join(' ')).not.toMatch(/picture is not sent/)
  })

  it('says a refusal as a failure, an error of Threads\' own side and a lost answer as unknown, and finds the lost post among the profile\'s posts', async () => {
    const w = await connected()
    const make = async (text: string) => {
      const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text } })
      await w.call('opportunities.approve', { id: opportunity.id })
      return opportunity.id
    }
    w.threads.failNext = { code: 10, message: 'Application does not have permission for this action' }
    expect(await w.sending.send(await make('First.'))).toMatchObject({ state: 'failed', error: expect.stringMatching(/Threads refused it: Application does not have permission.*Nothing was sent/) })
    expect(w.threads.posts).toHaveLength(0)

    w.threads.failNext = { status: 500, code: 2, message: 'An unexpected error has occurred.' }
    expect(await w.send({ text: 'Half.' })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/error of its own/) })

    w.threads.failNext = 'lost'
    const lostId = await make('Second.')
    expect(await w.sending.send(lostId)).toMatchObject({ state: 'unknown', error: expect.stringMatching(/did not answer/) })
    // Threads did make the post: the re-check finds it among the profile's posts.
    expect(await w.sending.reconcile(lostId)).toMatchObject({ state: 'confirmed', resultExternalId: expect.stringMatching(/^th:/) })
  })
})

describe('replies and numbers', () => {
  it('reads a reply under the profile\'s post as an item to answer, answers it under the reply, and takes the profile\'s own words as nobody to answer', async () => {
    const w = await connected()
    const post = w.threads.ownerPosts('What does a natal chart show?')
    w.threads.reposts('Somebody else\'s post.')
    const reply = w.threads.reply(post.id, 'Does it need the exact birth time?', 'ann.lee')
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    const items = w.core.db.prepare('SELECT c.external_id AS comment, c.author, c.body FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE o.channel_id = ?').all(w.channel.id)
    expect(items).toEqual([{ comment: `th:${reply.id}`, author: '@ann.lee', body: 'Does it need the exact birth time?' }])
    // The repost is not the profile's own post: it is not read as one.
    expect(w.threads.calls.filter((c) => c.path.endsWith('/conversation')).map((c) => c.path)).not.toContain(`${w.threads.posts[0]?.id}/conversation`)

    const sent = await w.send({ kind: 'reply', parentExternalId: `th:${reply.id}`, text: 'An hour either way changes the houses.', topicTag: 'Astrology' })
    expect(sent).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^th:\d+$/) })
    // A reply names what it answers and carries no topic.
    expect(made(w).at(-2)?.params).toEqual({ media_type: 'TEXT', text: 'An hour either way changes the houses.', reply_to_id: reply.id })
    const thread = await w.connector.fetchThread(w.ctx, `th:${post.id}`)
    expect(thread?.comments.map((c) => [c.author, c.parentExternalId])).toEqual([
      ['@ann.lee', `th:${post.id}`],
      ['@natalmystic', `th:${reply.id}`]
    ])
    await w.monitor.runChannel(w.channel.id)
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ?').get(w.channel.id)).toEqual({ n: 1 })
  })

  it('names nobody for a private profile, does not ask for the replies of a post that has none, and refuses a reply to what it never read', async () => {
    const w = await connected()
    const quiet = w.threads.ownerPosts('No replies here.')
    const post = w.threads.ownerPosts('Chart of the day.')
    w.threads.reply(post.id, 'Lovely.', null)
    const batch = await w.connector.fetchActivity(w.ctx, { limit: 10 })
    expect(batch.discussions.map((d) => [d.body, d.comments.map((c) => c.author)])).toEqual([
      ['Chart of the day.', ['Somebody on Threads']],
      ['No replies here.', []]
    ])
    expect(w.threads.calls.some((c) => c.path === `${quiet.id}/conversation`)).toBe(false)
    expect(await w.connector.fetchThread(w.ctx, 'th:1')).toBeNull()
    expect(await w.send({ kind: 'reply', parentExternalId: 'fb:1_2', text: 'Hi' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/was not read through the Threads API/) })
  })

  it('finds a reply whose answer was lost among the profile\'s own replies, under what it answered', async () => {
    const w = await connected()
    const post = w.threads.ownerPosts('Chart of the day.')
    const reply = w.threads.reply(post.id, 'Which house system?', 'bo')
    w.threads.failNext = 'lost'
    const request = { kind: 'reply' as const, parentExternalId: `th:${reply.id}`, text: 'Placidus.' }
    expect(await w.send(request)).toMatchObject({ status: 'unknown' })
    const attemptedAt = w.core.clock.now().toISOString()
    const whole = { destination: w.channel.url, title: null, link: null, attachments: [], attemptedAt, ...request }
    expect(await w.connector.findPublished?.(w.ctx, whole)).toMatchObject({ externalId: expect.stringMatching(/^th:\d+$/) })
    expect(await w.connector.findPublished?.(w.ctx, { ...whole, parentExternalId: `th:${post.id}` })).toBeNull()
  })

  it('counts likes, replies and views under a post through the Results reading, and followers as the channel\'s number', async () => {
    const w = await connected()
    const sent = await w.send({ text: 'Full moon tonight.' })
    if (sent.status !== 'confirmed') throw new Error('not sent')
    const id = sent.externalId.slice(3)
    const post = w.threads.posts.find((p) => p.id === id)
    if (!post) throw new Error('no post')
    post.likes = 7
    post.views = 140
    w.threads.reply(id, 'Beautiful.', 'ann')
    const asked = [{ externalId: sent.externalId, url: sent.url }, { externalId: 'th:1', url: null }, { externalId: 't3_x', url: null }]
    expect(await w.connector.readPostNumbers?.(w.ctx, asked)).toEqual({ [sent.externalId]: { likes: 7, comments: 1, views: 140 } })
    expect(await w.call('results.posts', { channelId: w.channel.id })).toMatchObject({ readable: true, byAi: false })
    expect(await w.connector.fetchMetrics(w.ctx)).toEqual([{ key: 'followers', label: 'Followers', value: 120, available: true }])
  })
})
