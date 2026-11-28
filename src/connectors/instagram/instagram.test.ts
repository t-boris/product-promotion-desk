import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/db/database'
import { FAKE_STORE_PLACE, FAKE_STORE_SECRET, FakeStore, byHost } from '../../core/net/fake-s3'
import { FakeKnowledge, makeClaim } from '../../core/pipeline/test-fixture'
import { sendWays } from '../../core/pipeline/send-ways'
import { makeTestCore, type TestCore } from '../../core/testing/fakes'
import { apiKeyKey } from '../../core/vault'
import type { MonitorService } from '../../core/services'
import type { ImageShrinker, PublishRequest } from '../../core/ports'
import { guideSteps } from '../../shared/connection-guide'
import { renderForPlatform, sendProblems } from '../../shared/post-format'
import { UniversalConnector } from '../universal'
import { InstagramApiConnector, handleOf, parseExternalId } from './connector'
import { FAKE_IG_TOKEN, FakeInstagram, IG_ACCOUNT_ID } from './fake-instagram'

let t: TestCore | null = null
afterEach(async () => {
  await t?.core.shutdown()
  t = null
})

const PROFILE_URL = 'https://www.instagram.com/natalmystic/'
const DAY = 24 * 3_600_000

/** A core with the Instagram API connector; one network with a fake Instagram and a fake store behind it; one product. */
function world(instagram = new FakeInstagram(), shrinker: ImageShrinker | undefined = undefined) {
  const store = new FakeStore()
  // Instagram reads a file at the moment it is given its address: only an address the store serves right then is taken.
  instagram.reads = (url) => store.serves(url)
  t = makeTestCore({ connectors: [new InstagramApiConnector(), new UniversalConnector()], http: byHost({ 'graph.instagram.com': instagram, 'store.example.com': store }), imageShrinker: shrinker })
  const core = t.core
  core.services.knowledge = Object.assign(new FakeKnowledge(), { approved: [makeClaim('c1', 'Natal Mystic builds a natal chart from your birth date, time and place.')] })
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goals_json, active_passport_version_id, analysis_status, created_at, updated_at, add_site_link) VALUES (?, ?, ?, ?, json_array(), ?, ?, ?, ?, 0)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)
  instagram.startAt(core.clock.now().getTime())
  const logged = (): string => JSON.stringify(core.db.prepare('SELECT * FROM log_events').all())
  return { core, instagram, store, productId, secrets: t.secrets, clock: t.clock, logged, call: core.router.call.bind(core.router) as typeof core.router.call }
}

/** An Instagram account with its token saved and the profile connected, assessed and active; `place` also saves a place for files. */
async function connected(options: { place?: boolean; instagram?: FakeInstagram; shrinker?: ImageShrinker } = {}) {
  const w = world(options.instagram, options.shrinker)
  if (options.place !== false) await w.call('filePlace.save', { ...FAKE_STORE_PLACE, secret: FAKE_STORE_SECRET })
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'Natal Mystic on Instagram', access: 'api' })
  const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_IG_TOKEN })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: PROFILE_URL })
  await w.call('channels.assess', { channelId: channel.id })
  const active = await w.call('channels.activate', { channelId: channel.id })
  const { connector, ctx } = w.core.connectorContext(active.id)
  const loose = { ...ctx, tickets: { assertValid: () => undefined } }
  const ticket = { id: 't', actionId: 'a', contentHash: 'h', accountId: ready.id, destination: active.url, expiresAt: 0, signature: '' }
  const send = (request: Partial<PublishRequest>) => connector.publish(loose, ticket, { kind: 'post', destination: active.url, parentExternalId: null, title: null, text: '', link: null, attachments: [], ...request })
  return { ...w, account: ready, channel: active, connector, ctx, send, monitor: w.core.services.monitor as MonitorService }
}

const picture = (name: string, mime = 'image/jpeg') => ({ name, path: `/tmp/${name}`, mime, sha256: 'x' })
const video = (name: string) => ({ name, path: `/tmp/${name}`, mime: 'video/mp4', sha256: 'x' })
const made = (w: { instagram: FakeInstagram }) => w.instagram.calls.filter((c) => c.method === 'POST')

describe('the address of an Instagram profile', () => {
  it('is the profile itself, as an address or a handle, and never a post or a page of Instagram', () => {
    expect(handleOf('https://www.instagram.com/NatalMystic/')).toBe('natalmystic')
    expect(handleOf('instagram.com/natal.mystic')).toBe('natal.mystic')
    expect(handleOf('@natal_mystic')).toBe('natal_mystic')
    expect(handleOf('https://www.instagram.com/p/Cabc123/')).toBeNull()
    expect(handleOf('https://www.instagram.com/explore/')).toBeNull()
    expect(handleOf('https://www.instagram.com/reel/Cabc/')).toBeNull()
    expect(handleOf('https://www.threads.net/@natalmystic')).toBeNull()
    expect(parseExternalId('ig:m:17900000000000001')).toEqual({ kind: 'post', id: '17900000000000001' })
    expect(parseExternalId('ig:c:17900000000000002')).toEqual({ kind: 'comment', id: '17900000000000002' })
    expect(parseExternalId('th:1')).toBeNull()
  })
})

describe('an Instagram account that works through the Instagram API (DEC-082)', () => {
  it('is offered for Instagram beside the browser account, with the steps that get the token; the API connector is never chosen by an address alone', async () => {
    const w = world()
    const info = (await w.call('platforms.list', undefined as never)).find((p) => p.platform === 'instagram')
    expect(info).toMatchObject({ connectorId: 'universal', api: { accountKind: 'developer app', keyLabel: 'Instagram access token', renews: true } })
    expect(info?.api).not.toHaveProperty('onceSecret')
    expect(w.core.connectors.resolve(PROFILE_URL)?.id).toBe('universal')
    const steps = guideSteps(info, { kind: null, access: 'api' })
    expect(steps.length).toBe(8)
    expect(steps.filter((s) => s.url).every((s) => s.link)).toBe(true)
    expect(steps.map((s) => s.text).join(' ')).toMatch(/professional.*API setup with Instagram login.*instagram_business_content_publish.*Generate token.*Go live.*A place for files/s)
  })

  it('keeps the token in the vault only, and becomes ready under the profile\'s name, whichever of its two shapes Instagram answers in', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'Instagram', access: 'api' })
    expect(account).toMatchObject({ access: 'api', status: 'login_required' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: 'not a token' })).rejects.toMatchObject({ code: 'invalid_input' })
    const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: ` ${FAKE_IG_TOKEN} ` })
    expect(ready).toMatchObject({ status: 'ready', identity: '@natalmystic' })
    expect(w.secrets.values.get(apiKeyKey(account.id))).toBe(FAKE_IG_TOKEN)
    expect(w.logged()).not.toContain(FAKE_IG_TOKEN)
    w.instagram.profileInList = true
    expect(await w.call('accounts.checkLogin', { accountId: account.id })).toMatchObject({ status: 'ready', identity: '@natalmystic' })
    // A read carries the token as a parameter, as Meta's pages show it.
    expect(w.instagram.calls.every((c) => c.auth === 'query')).toBe(true)
  })

  it('renews the token a day after it was saved and a week after each renewal, by the times the application remembers', async () => {
    const w = await connected()
    const keys = w.core.services.keys as { renewDue(): Promise<number> }
    const now = (): void => {
      w.instagram.nowMs = w.core.clock.now().getTime()
    }
    // Saved a moment ago: Instagram renews only a token that is at least a day old.
    expect(await keys.renewDue()).toBe(0)
    w.clock.advance(DAY + 60_000)
    now()
    expect(await keys.renewDue()).toBe(1)
    const first = w.secrets.values.get(apiKeyKey(w.account.id)) as string
    expect(first).not.toBe(FAKE_IG_TOKEN)
    expect(w.logged()).toMatch(/The Instagram access token of Natal Mystic on Instagram was renewed; it lasts until/)
    expect(w.logged()).not.toContain(first)
    expect((await w.call('accounts.checkLogin', { accountId: w.account.id })).status).toBe('ready')
    // Not again for a week.
    w.clock.advance(6 * DAY)
    now()
    expect(await keys.renewDue()).toBe(0)
    w.clock.advance(2 * DAY)
    now()
    expect(await keys.renewDue()).toBe(1)
    const second = w.secrets.values.get(apiKeyKey(w.account.id)) as string
    expect(second).not.toBe(first)
    // A Mac that was off for longer than the token lasts: the account's page says it, the key stays.
    w.clock.advance(61 * DAY)
    now()
    expect(await keys.renewDue()).toBe(0)
    expect(w.secrets.values.get(apiKeyKey(w.account.id))).toBe(second)
    expect(w.logged()).toMatch(/could not be renewed: Instagram does not accept the access token/)
    // What is remembered of a key goes with its account.
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM api_key_times').get()).toEqual({ n: 1 })
  })

  it('checks that the token is of the profile that was connected, and reads its posts and comments before saying it can', async () => {
    const w = await connected()
    const caps = Object.fromEntries((await w.call('channels.assess', { channelId: w.channel.id })).capabilities.map((c) => [c.key, c]))
    expect(caps.read_posts).toMatchObject({ status: 'verified' })
    expect(caps.read_comments).toMatchObject({ status: 'needs_check' })
    expect(caps.publish_post?.detail).toMatch(/one picture, one video.*place for files.*JPEG copy of a PNG.*Go live/s)
    expect(w.channel).toMatchObject({ status: 'active', connectorId: 'instagram-api', reads: true })
    // The publishing addresses carry the id of the professional account, not the id inside the app.
    expect(w.instagram.calls.some((c) => c.path === `${IG_ACCOUNT_ID}/media`)).toBe(true)

    w.instagram.profile = { ...w.instagram.profile, username: 'somebodyelse' }
    const other = await w.call('channels.assess', { channelId: w.channel.id })
    expect(other.capabilities.find((c) => c.key === 'publish_post')).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/belongs to the profile @somebodyelse/) })
  })
})

describe('posting as the account', () => {
  it('puts one picture on its address, makes a container with the caption, publishes it, and deletes the file', async () => {
    const w = await connected()
    expect(sendWays(w.core, undefined, w.channel)).toMatchObject({ api: true, publicFiles: true })
    const out = await w.send({ text: 'A chart for the full moon.\n\nLink in bio', link: 'https://natalmystic.com', attachments: [picture('chart one.jpg')] })
    expect(out).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^ig:m:\d+$/), url: expect.stringMatching(/^https:\/\/www\.instagram\.com\/p\//) })
    const post = w.instagram.media[0]
    // The link is never put into a caption: Instagram does not make it one.
    expect(post).toMatchObject({ caption: 'A chart for the full moon.\n\nLink in bio', kind: 'IMAGE' })
    expect(post?.files).toMatchObject([{ kind: 'IMAGE', url: expect.stringMatching(/^https:\/\/store\.example\.com\/my-files\/ppd\/[^/]+\/chart-one\.jpg\?X-Amz-Algorithm=/) }])
    // A write carries the token in its header and a JSON body, as Meta's publishing page shows it.
    expect(made(w).map((c) => [c.path, c.auth])).toEqual([
      [`${IG_ACCOUNT_ID}/media`, 'bearer'],
      [`${IG_ACCOUNT_ID}/media_publish`, 'bearer']
    ])
    expect(Object.keys(made(w)[0]?.params ?? {}).sort()).toEqual(['caption', 'image_url'])
    expect(w.store.everPut).toHaveLength(1)
    expect(w.store.objects.size).toBe(0)
    expect(w.logged()).not.toContain(FAKE_IG_TOKEN)
    expect(w.logged()).not.toContain('X-Amz-Signature')
  })

  it('sends one video as a reel that is in the feed too, and several files as one post in their order', async () => {
    const w = await connected()
    w.instagram.containerStates = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']
    expect(await w.send({ text: 'A reel.', attachments: [video('a.mp4')] })).toMatchObject({ status: 'confirmed' })
    expect(w.instagram.media[0]).toMatchObject({ kind: 'VIDEO', inFeed: true, caption: 'A reel.' })
    expect(made(w).find((c) => c.params.media_type === 'REELS')?.params).toMatchObject({ share_to_feed: true })

    expect(await w.send({ text: 'Three.', attachments: [picture('1.jpg'), video('2.mp4'), picture('3.jpg')] })).toMatchObject({ status: 'confirmed' })
    const post = w.instagram.media[0]
    expect(post).toMatchObject({ kind: 'CAROUSEL_ALBUM', caption: 'Three.' })
    expect(post?.files.map((f) => f.kind)).toEqual(['IMAGE', 'VIDEO', 'IMAGE'])
    expect(post?.files.map((f) => w.store.keyOf(f.url)?.split('/').pop())).toEqual(['1.jpg', '2.mp4', '3.jpg'])
    const items = made(w).filter((c) => c.params.is_carousel_item === true)
    expect(items).toHaveLength(3)
    expect(items.every((c) => c.params.caption === undefined)).toBe(true)
    expect(made(w).find((c) => c.params.media_type === 'CAROUSEL')?.params.children).toMatch(/^\d+,\d+,\d+$/)
    expect(w.store.objects.size).toBe(0)
  })

  it('sends a JPEG copy of a picture that is not JPEG, made for the send and deleted after it; and says in words when no copy can be made', async () => {
    const copies: string[] = []
    const shrinker: ImageShrinker = {
      shrink: async (source, maxBytes, outDir) => {
        if (source.endsWith('.webp')) throw new Error('The picture could not be read.')
        expect(maxBytes).toBe(8 * 1024 * 1024)
        const path = join(outDir, 'picture.jpg')
        writeFileSync(path, 'jpeg bytes')
        copies.push(path)
        return path
      }
    }
    const w = await connected({ shrinker })
    expect(await w.send({ text: 'Made by the AI.', attachments: [picture('chart.png', 'image/png'), picture('photo.jpg')] })).toMatchObject({ status: 'confirmed' })
    // The store was given a JPEG under the picture's own name; the JPEG that was one already went as it is.
    expect(w.store.everPut.map((key) => key.split('/').pop())).toEqual(['chart.jpg', 'photo.jpg'])
    expect(copies).toHaveLength(1)
    expect(existsSync(copies[0] as string)).toBe(false)
    expect(w.instagram.media[0]?.files.map((f) => w.store.keyOf(f.url)?.split('/').pop())).toEqual(['chart.jpg', 'photo.jpg'])

    const asked = w.instagram.calls.length
    expect(await w.send({ text: 'A.', attachments: [picture('a.webp', 'image/webp')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/“a\.webp” is not a JPEG picture, and a JPEG copy of it could not be made \(The picture could not be read\.\) Save it as JPEG or PNG.*Nothing was sent/) })
    expect(w.store.objects.size).toBe(0)
    expect(made(w).filter((c) => c.path.endsWith('/media')).length).toBe(made({ instagram: { calls: w.instagram.calls.slice(0, asked) } as FakeInstagram }).filter((c) => c.path.endsWith('/media')).length)
    // A build with no picture tools says so instead of sending a file Instagram would refuse.
    const bare = await connected()
    expect(await bare.send({ text: 'A.', attachments: [picture('a.png', 'image/png')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/this build of the application cannot make one/) })
  })

  it('refuses before anything is asked of Instagram: words alone, a file that is no picture, too many hashtags, no place for files; and says it before the owner approves', async () => {
    const w = await connected({ place: false })
    const asked = w.instagram.calls.length
    expect(await w.send({ text: 'Words only.' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/no post of words only/) })
    expect(await w.send({ text: 'A chart.', attachments: [picture('a.pdf', 'application/pdf')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/takes a picture and an MP4 or MOV video.*“a\.pdf” is neither/) })
    expect(await w.send({ text: Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' '), attachments: [picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/at most 30 hashtags in a caption; this one has 31/) })
    expect(await w.send({ text: 'A chart.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/no place for files is set up.*Nothing was sent/s) })
    expect(w.instagram.calls.length).toBe(asked)
    expect(w.store.everPut).toHaveLength(0)

    const rendered = renderForPlatform({ title: null, text: 'A chart.', link: null, attachments: [] } as never, 'instagram')
    const without = sendWays(w.core, undefined, w.channel)
    expect(without).toMatchObject({ api: true, publicFiles: false })
    expect(sendProblems('instagram', { ...rendered, attachments: [picture('a.jpg')] }, without).join(' ')).toMatch(/Set up “A place for files” in Settings/)
    const withPlace = { aiBrowser: false, api: true, publicFiles: true }
    expect(sendProblems('instagram', { ...rendered, attachments: [picture('a.webp', 'image/webp')] }, withPlace).join(' ')).toMatch(/only as a JPEG file\. The application makes one from a PNG by itself, and “a\.webp” is neither/)
    expect(sendProblems('instagram', { ...rendered, attachments: [picture('a.jpg'), picture('a.png', 'image/png')] }, withPlace).join(' ')).not.toMatch(/JPEG|place for files/)
    // In the account's browser any picture goes as before, and Threads takes its own kinds through its API.
    expect(sendProblems('instagram', { ...rendered, attachments: [picture('a.webp', 'image/webp')] }, { aiBrowser: true }).join(' ')).not.toMatch(/JPEG/)
    expect(sendProblems('threads', { ...rendered, attachments: [picture('a.webp', 'image/webp')] }, withPlace).join(' ')).not.toMatch(/JPEG/)
  })

  it('publishes nothing and deletes the files when Instagram could not prepare the post, never finished, or could not read the file; its own words for a person are given', async () => {
    const w = await connected()
    w.instagram.containerStates = ['ERROR']
    expect(await w.send({ text: 'A.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/could not prepare the post \(Error: the aspect ratio of the picture is not supported\)\. Nothing was published/) })
    w.instagram.containerStates = Array.from({ length: 40 }, () => 'IN_PROGRESS')
    expect(await w.send({ text: 'B.', attachments: [picture('b.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/still preparing the post after a minute/) })
    w.instagram.containerStates = []
    w.instagram.reads = () => false
    expect(await w.send({ text: 'C.', attachments: [picture('c.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/Instagram refused it: The media could not be fetched from this URI Nothing was sent/) })
    expect(w.instagram.media).toHaveLength(0)
    expect(made(w).filter((c) => c.path.endsWith('media_publish'))).toHaveLength(0)
    expect(w.store.everPut).toHaveLength(3)
    expect(w.store.objects.size).toBe(0)
  })

  it('says a refusal as a failure, an error of Instagram\'s own side and a lost answer as unknown, finds the lost post by its caption, and does not call a post without its caption published', async () => {
    const w = await connected()
    w.instagram.failNext = { code: 10, message: 'Application does not have permission for this action' }
    expect(await w.send({ text: 'First.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/Instagram refused it: Application does not have permission.*Nothing was sent/) })

    w.instagram.failNext = { status: 500, code: 2, message: 'An unexpected error has occurred.' }
    expect(await w.send({ text: 'Half.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/error of its own/) })

    w.instagram.failNext = 'lost'
    const request = { text: 'Second.', attachments: [picture('a.jpg')] }
    expect(await w.send(request)).toMatchObject({ status: 'unknown', error: expect.stringMatching(/did not answer/) })
    const lost = { kind: 'post' as const, destination: w.channel.url, parentExternalId: null, title: null, link: null, attemptedAt: w.core.clock.now().toISOString(), ...request }
    expect(await w.connector.findPublished(w.ctx, lost)).toMatchObject({ externalId: `ig:m:${w.instagram.media[0]?.id}`, url: expect.stringMatching(/instagram\.com\/p\//) })
    expect(await w.connector.findPublished(w.ctx, { ...lost, text: 'Never sent.' })).toBeNull()

    w.instagram.losesCaption = true
    expect(await w.send({ text: 'Third.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'unknown', error: expect.stringMatching(/published the post and says its caption was not attached/) })
    expect(w.store.objects.size).toBe(0)
  })
})

describe('comments and numbers', () => {
  it('reads a comment under the account\'s post as an item to answer, answers it under the comment, and takes the account\'s own words as nobody to answer', async () => {
    const w = await connected()
    const post = w.instagram.ownerPosts('What does a natal chart show?')
    const first = w.instagram.comment(post.id, 'Does it need the exact birth time?', 'ann.lee')
    w.instagram.nowMs += 60_000
    const second = w.instagram.comment(post.id, 'Beautiful.', 'bo')
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    const items = w.core.db.prepare('SELECT c.external_id AS comment, c.author FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE o.channel_id = ? ORDER BY c.external_id').all(w.channel.id)
    expect(items).toEqual([
      { comment: `ig:c:${first.id}`, author: '@ann.lee' },
      { comment: `ig:c:${second.id}`, author: '@bo' }
    ])

    const sent = await w.send({ kind: 'reply', parentExternalId: `ig:c:${first.id}`, text: 'An hour either way changes the houses.' })
    expect(sent).toMatchObject({ status: 'confirmed', externalId: expect.stringMatching(/^ig:c:\d+$/) })
    expect(made(w).at(-1)).toMatchObject({ path: `${first.id}/replies`, params: { message: 'An hour either way changes the houses.' } })
    // A comment of the account's own under its post goes to the post's comments.
    expect(await w.send({ kind: 'reply', parentExternalId: `ig:m:${post.id}`, text: 'Thank you all.' })).toMatchObject({ status: 'confirmed' })
    expect(made(w).at(-1)?.path).toBe(`${post.id}/comments`)

    // The conversation is kept in the order it was written, a reply under its comment.
    const thread = await w.connector.fetchThread(w.ctx, `ig:m:${post.id}`)
    expect(thread?.comments.map((c) => [c.author, c.parentExternalId])).toEqual([
      ['@ann.lee', `ig:m:${post.id}`],
      ['@natalmystic', `ig:c:${first.id}`],
      ['@bo', `ig:m:${post.id}`],
      ['@natalmystic', `ig:m:${post.id}`]
    ])
    await w.monitor.runChannel(w.channel.id)
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ?').get(w.channel.id)).toEqual({ n: 2 })
  })

  it('does not ask for the comments of a post that has none, says when Instagram gave only its 50 newest, and refuses a reply to what it never read or one with a picture', async () => {
    const w = await connected()
    const quiet = w.instagram.ownerPosts('Quiet.')
    const busy = w.instagram.ownerPosts('Busy.')
    for (let i = 0; i < 55; i += 1) w.instagram.comment(busy.id, `Comment ${i}`, `user${i}`)
    const batch = await w.connector.fetchActivity(w.ctx, { limit: 10 })
    expect(w.instagram.calls.filter((c) => c.path === `${quiet.id}/comments`)).toHaveLength(0)
    expect(batch.discussions.find((d) => d.externalId === `ig:m:${busy.id}`)).toMatchObject({ incomplete: true })
    expect(batch.discussions.find((d) => d.externalId === `ig:m:${busy.id}`)?.comments).toHaveLength(50)
    expect(batch.discussions.find((d) => d.externalId === `ig:m:${quiet.id}`)).not.toHaveProperty('incomplete')

    expect(await w.send({ kind: 'reply', parentExternalId: 't1_abc', text: 'Hello.' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/was not read through the Instagram API/) })
    expect(await w.send({ kind: 'reply', parentExternalId: `ig:m:${quiet.id}`, text: 'Look.', attachments: [picture('a.jpg')] })).toMatchObject({ status: 'failed', error: expect.stringMatching(/words only/) })
    expect(await w.connector.fetchThread(w.ctx, 'ig:m:1')).toBeNull()
  })

  it('finds a reply whose answer was lost under the comment it answered', async () => {
    const w = await connected()
    const post = w.instagram.ownerPosts('A post.')
    const comment = w.instagram.comment(post.id, 'A question?', 'ann')
    w.instagram.failNext = 'lost'
    const request = { kind: 'reply' as const, parentExternalId: `ig:c:${comment.id}`, text: 'An answer.' }
    expect(await w.send(request)).toMatchObject({ status: 'unknown' })
    const lost = { destination: w.channel.url, title: null, link: null, attachments: [], attemptedAt: w.core.clock.now().toISOString(), ...request }
    expect(await w.connector.findPublished(w.ctx, lost)).toMatchObject({ externalId: expect.stringMatching(/^ig:c:\d+$/) })
    expect(await w.connector.findPublished(w.ctx, { ...lost, text: 'Another answer.' })).toBeNull()
  })

  it('counts likes and comments from the post and views from its insights, gives no views when Instagram refuses them, and followers as the channel\'s number', async () => {
    const w = await connected()
    const sent = await w.send({ text: 'Full moon tonight.', attachments: [picture('moon.jpg')] })
    if (sent.status !== 'confirmed') throw new Error('not sent')
    const post = w.instagram.media[0]
    if (!post) throw new Error('no post')
    post.likes = 7
    post.views = 140
    w.instagram.comment(post.id, 'Beautiful.', 'ann')
    const asked = [{ externalId: sent.externalId, url: sent.url }, { externalId: 'ig:m:1', url: null }, { externalId: 'ig:c:5', url: null }, { externalId: 't3_x', url: null }]
    expect(await w.connector.readPostNumbers?.(w.ctx, asked)).toEqual({ [sent.externalId]: { likes: 7, comments: 1, views: 140 } })
    w.instagram.givesInsights = false
    expect(await w.connector.readPostNumbers?.(w.ctx, asked)).toEqual({ [sent.externalId]: { likes: 7, comments: 1, views: null } })
    expect(await w.call('results.posts', { channelId: w.channel.id })).toMatchObject({ readable: true, byAi: false })
    expect(await w.connector.fetchMetrics(w.ctx)).toEqual([{ key: 'followers', label: 'Followers', value: 340, available: true }])
  })

  it('reads an ended token as a sign-in problem of the account', async () => {
    const w = await connected()
    w.instagram.tokens.clear()
    await expect(w.connector.fetchActivity(w.ctx, { limit: 5 })).rejects.toMatchObject({ name: 'LoginRequiredError', message: expect.stringMatching(/does not accept the access token/) })
    expect((await w.call('accounts.checkLogin', { accountId: w.account.id })).status).not.toBe('ready')
  })
})

describe('hiding a comment (DEC-089)', () => {
  it('hides a comment or a reply under the account\'s post on the owner\'s press and shows it again; what Instagram says of a hidden comment is kept', async () => {
    const w = await connected()
    const post = w.instagram.ownerPosts('What does a natal chart show?')
    const top = w.instagram.comment(post.id, 'Buy followers at example.com', 'spam.bot')
    const under = w.instagram.comment(post.id, 'Me too.', 'bo', top.id)
    expect((await w.monitor.runChannel(w.channel.id)).status).toBe('ok')
    const item = (commentId: string): string => (w.core.db.prepare('SELECT o.id FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE c.external_id = ?').get(`ig:c:${commentId}`) as { id: string }).id

    expect(await w.call('opportunities.get', { id: item(top.id) })).toMatchObject({ commentHiding: 'alone', comment: { hidden: false } })
    expect(await w.call('opportunities.get', { id: item(under.id) })).toMatchObject({ commentHiding: 'alone' })

    expect(await w.call('opportunities.hideComment', { id: item(top.id), hidden: true })).toMatchObject({ comment: { hidden: true } })
    expect(w.instagram.calls.at(-1)).toEqual({ method: 'POST', path: top.id, params: { hide: true }, auth: 'bearer' })
    expect(top.hidden).toBe(true)

    w.instagram.failNext = { code: 10, message: '(#10) Application does not have permission for this action' }
    await expect(w.call('opportunities.hideComment', { id: item(under.id), hidden: true })).rejects.toThrow(/Instagram refused it: .*The comment is as it was on Instagram\./)
    expect(under.hidden).toBeUndefined()

    expect(await w.call('opportunities.hideComment', { id: item(top.id), hidden: false })).toMatchObject({ comment: { hidden: false } })
    expect(top.hidden).toBe(false)

    // Hidden on Instagram itself: the next reading of the account says so here.
    under.hidden = true
    await w.monitor.runChannel(w.channel.id)
    expect(await w.call('opportunities.get', { id: item(under.id) })).toMatchObject({ comment: { hidden: true } })
  })
})

describe('daily publishing limit on Instagram (DEC-096)', () => {
  it('reads the 24-hour publishing quota through channels.publishingQuota, and returns supported:false for browser channels', async () => {
    const w = await connected()
    w.instagram.quotaUsage = 14
    w.instagram.quotaTotal = 100
    const info = await w.call('channels.publishingQuota', { channelId: w.channel.id })
    expect(info).toEqual({
      supported: true,
      problem: null,
      quota: { used: 14, limit: 100, windowHours: 24, readAt: w.core.clock.now().toISOString() }
    })
    expect(w.instagram.calls.at(-1)).toMatchObject({ method: 'GET', path: `${IG_ACCOUNT_ID}/content_publishing_limit` })

    const browserAcc = await w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'IG Browser' })
    const browserCh = await w.call('channels.connect', { productId: w.productId, accountId: browserAcc.id, target: 'https://www.instagram.com/browserbrand/' })
    expect(await w.call('channels.publishingQuota', { channelId: browserCh.id })).toEqual({ supported: false, quota: null, problem: null })
  })
})
