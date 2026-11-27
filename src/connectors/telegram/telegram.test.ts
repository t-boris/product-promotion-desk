import { afterEach, describe, expect, it } from 'vitest'
import { newId } from '../../core/db/database'
import { FakeKnowledge, makeClaim } from '../../core/pipeline/test-fixture'
import { makeTestCore, type TestCore } from '../../core/testing/fakes'
import { apiKeyKey, passwordKey } from '../../core/vault'
import type { MonitorService, SendingService } from '../../core/services'
import { UniversalConnector } from '../universal'
import { TelegramBotConnector, channelName, parseExternalId } from './connector'
import { CHANNEL_ID, FAKE_TOKEN, FakeTelegram, GROUP_ID } from './fake-telegram'

let t: TestCore | null = null
afterEach(async () => {
  await t?.core.shutdown()
  t = null
})

/** A core with the Telegram bot connector and a fake Telegram behind the network port; one product. */
function world(telegram = new FakeTelegram()) {
  t = makeTestCore({ connectors: [new TelegramBotConnector(), new UniversalConnector()], http: telegram })
  const core = t.core
  core.services.knowledge = Object.assign(new FakeKnowledge(), { approved: [makeClaim('c1', 'Natal Mystic builds a natal chart from your birth date, time and place.')] })
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goals_json, active_passport_version_id, analysis_status, created_at, updated_at, add_site_link) VALUES (?, ?, ?, ?, json_array(), ?, ?, ?, ?, 0)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)
  telegram.nowSeconds = Math.floor(core.clock.now().getTime() / 1000)
  return { core, telegram, productId, secrets: t.secrets, call: core.router.call.bind(core.router) as typeof core.router.call }
}

/** A bot account with its token saved and its channel connected, assessed and active. */
async function connected(telegram = new FakeTelegram()) {
  const w = world(telegram)
  const account = await w.call('accounts.create', { productId: w.productId, platform: 'telegram', label: 'Natal Mystic bot', access: 'api' })
  const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_TOKEN })
  const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: '@natalmystic' })
  await w.call('channels.assess', { channelId: channel.id })
  const active = await w.call('channels.activate', { channelId: channel.id })
  return { ...w, account: ready, channel: active, sending: w.core.services.sending as SendingService, monitor: w.core.services.monitor as MonitorService }
}

describe('addresses and ids', () => {
  it('takes a public channel name and nothing else', () => {
    expect(channelName('@natalmystic')).toBe('natalmystic')
    expect(channelName('https://t.me/natalmystic/')).toBe('natalmystic')
    expect(channelName('https://t.me/+AbCdEf123')).toBeNull()
    expect(channelName('https://reddit.com/r/astrology')).toBeNull()
    expect(parseExternalId('tg:-1001000000001:15')).toEqual({ chatId: '-1001000000001', messageId: 15 })
    expect(parseExternalId('t3_abc')).toBeNull()
  })
})

describe('a Telegram account that works through a bot (DEC-055)', () => {
  it('is offered for Telegram beside the browser account, and the bot connector is never chosen by an address alone', async () => {
    const w = world()
    const telegramInfo = (await w.call('platforms.list', undefined as never)).filter((p) => p.platform === 'telegram')
    expect(telegramInfo).toHaveLength(1)
    expect(telegramInfo[0]).toMatchObject({ connectorId: 'universal', api: { accountKind: 'bot', keyLabel: 'Bot token' } })
    expect(w.core.connectors.resolve('https://t.me/natalmystic')?.id).toBe('universal')

    // A browser account of Telegram keeps the browser way; an API account of a platform that has no API connector is refused.
    const browser = await w.call('accounts.create', { productId: w.productId, platform: 'telegram', label: 'My Telegram' })
    expect(browser.access).toBe('browser')
    expect((await w.call('channels.connect', { productId: w.productId, accountId: browser.id, target: '@natalmystic' })).connectorId).toBe('universal')
    await expect(w.call('accounts.create', { productId: w.productId, platform: 'instagram', label: 'x', access: 'api' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(w.call('vault.saveApiKey', { accountId: browser.id, key: FAKE_TOKEN })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('becomes ready when its token is saved and Telegram names the bot; the token is in the vault under its own entry only', async () => {
    const w = world()
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'telegram', label: 'Bot', access: 'api' })
    expect(account).toMatchObject({ access: 'api', status: 'login_required' })
    await expect(w.call('vault.saveApiKey', { accountId: account.id, key: 'not a token' })).rejects.toMatchObject({ code: 'invalid_input' })
    const ready = await w.call('vault.saveApiKey', { accountId: account.id, key: `  ${FAKE_TOKEN}  ` })
    expect(ready).toMatchObject({ status: 'ready', identity: '@natal_mystic_bot' })
    expect(w.secrets.values.get(apiKeyKey(account.id))).toBe(FAKE_TOKEN)
    expect(w.secrets.values.has(passwordKey(account.id))).toBe(false)
    expect(await w.call('vault.status', undefined as never)).toMatchObject({ accountIds: [], apiKeyAccountIds: [account.id] })
    expect(JSON.stringify(ready)).not.toContain(FAKE_TOKEN)

    // A token Telegram no longer accepts: the account asks for attention, and no line of the log holds the token.
    w.telegram.token = '987654321:BBnewTokenThatReplacedTheOldOne_0123456789'
    expect((await w.call('accounts.checkLogin', { accountId: account.id })).status).not.toBe('ready')
    const log = JSON.stringify(w.core.db.prepare('SELECT * FROM log_events').all())
    expect(log).not.toContain(FAKE_TOKEN)
  })

  it('says what the bot can do in the channel, and what the owner must do when it cannot', async () => {
    const telegram = new FakeTelegram()
    telegram.botInGroup = false
    telegram.botMayPost = false
    const w = world(telegram)
    const account = await w.call('accounts.create', { productId: w.productId, platform: 'telegram', label: 'Bot', access: 'api' })
    await w.call('vault.saveApiKey', { accountId: account.id, key: FAKE_TOKEN })
    const channel = await w.call('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://t.me/natalmystic' })
    expect(channel).toMatchObject({ connectorId: 'telegram-bot', target: '@natalmystic', reads: true, watchedInBrowser: false })
    const assessed = await w.call('channels.assess', { channelId: channel.id })
    const cap = (key: string) => assessed.capabilities.find((c) => c.key === key)
    expect(cap('publish_post')).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/administrator/) })
    expect(cap('read_comments')).toMatchObject({ status: 'needs_user', detail: expect.stringMatching(/discussion group/) })
    await expect(w.call('channels.connect', { productId: w.productId, accountId: account.id, target: 'https://t.me/+privateInvite1' })).rejects.toMatchObject({ code: 'platform_mismatch' })
  })
})

describe('posting through the bot', () => {
  it('sends an approved post by itself at its time, confirmed with Telegram\'s own message, with no browser', async () => {
    const w = await connected()
    const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text: 'Mercury turns direct today.' } })
    await w.call('publications.schedule', { id: opportunity.id, at: new Date(w.core.clock.now().getTime() + 60_000).toISOString() })
    await w.call('opportunities.approve', { id: opportunity.id })
    t!.clock.advance(2 * 60_000)
    expect(await w.sending.sendDuePublications()).toBe(1)
    const action = w.core.db.prepare('SELECT state, result_url AS url, result_external_id AS id, authorization_basis AS basis FROM send_actions').get() as { state: string; url: string; id: string; basis: string }
    expect(action).toMatchObject({ state: 'confirmed', url: expect.stringMatching(/^https:\/\/t\.me\/natalmystic\/\d+$/), id: expect.stringMatching(new RegExp(`^tg:${CHANNEL_ID}:\\d+$`)) })
    expect(w.telegram.calls.filter((c) => c.method === 'sendMessage')).toEqual([{ method: 'sendMessage', params: { chat_id: '@natalmystic', text: 'Mercury turns direct today.' }, files: [] }])
  })

  it('says a refusal as a failure and a lost answer as unknown, which is then found through the discussion group', async () => {
    const w = await connected()
    const make = async (text: string) => {
      const { opportunity } = await w.call('publications.create', { channelId: w.channel.id, draft: { title: null, text } })
      await w.call('opportunities.approve', { id: opportunity.id })
      return opportunity.id
    }
    w.telegram.failNext = { code: 403, description: 'Forbidden: bot is not a member of the channel chat' }
    const refused = await w.sending.send(await make('First.'))
    expect(refused).toMatchObject({ state: 'failed', error: expect.stringMatching(/Telegram refused it: Forbidden/) })

    w.telegram.failNext = 'lost'
    const lostId = await make('Second.')
    const lost = await w.sending.send(lostId)
    expect(lost).toMatchObject({ state: 'unknown', error: expect.stringMatching(/did not answer/) })
    // Telegram did make the post: its copy in the discussion group reaches the bot, and the re-check finds it.
    const settled = await w.sending.reconcile(lostId)
    expect(settled).toMatchObject({ state: 'confirmed', resultExternalId: expect.stringMatching(/^tg:/) })
  })
})

describe('comments and replies', () => {
  it('reads a comment from the discussion group as an item to answer, and answers inside the thread', async () => {
    const w = await connected()
    const post = w.telegram.ownerPosts('What does a natal chart show?')
    const comment = w.telegram.comment(post.message_id, 'Does it need the exact birth time?', { username: 'stargazer' })
    const run = await w.monitor.runChannel(w.channel.id)
    expect(run.status).toBe('ok')
    const items = w.core.db.prepare("SELECT o.id, o.kind, c.external_id AS comment, c.author, c.body FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE o.channel_id = ?").all(w.channel.id) as { id: string; kind: string; comment: string; author: string; body: string }[]
    expect(items).toEqual([expect.objectContaining({ comment: `tg:${GROUP_ID}:${comment.message_id}`, author: '@stargazer', body: 'Does it need the exact birth time?' })])

    // The owner's own post is nobody to answer: only the comment made an item.
    expect(w.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities WHERE channel_id = ?').get(w.channel.id)).toEqual({ n: 1 })

    const thread = await w.core.connectorContext(w.channel.id).connector.fetchThread(w.core.connectorContext(w.channel.id).ctx, `tg:${CHANNEL_ID}:${post.message_id}`)
    expect(thread?.comments.map((c) => c.parentExternalId)).toEqual([`tg:${CHANNEL_ID}:${post.message_id}`])
  })

  it('answers a comment where it stands, and refuses one it was never delivered', async () => {
    const w = await connected()
    const post = w.telegram.ownerPosts('Chart of the day.')
    const comment = w.telegram.comment(post.message_id, 'Lovely.', { first_name: 'Ann' })
    const { connector, ctx } = w.core.connectorContext(w.channel.id)
    await connector.fetchActivity(ctx, { limit: 25 })
    const ticket = { id: 't', actionId: 'a', contentHash: 'h', accountId: w.account.id, destination: w.channel.url, expiresAt: 0, signature: '' }
    const loose = { ...ctx, tickets: { assertValid: () => undefined } }
    const sent = await connector.publish(loose, ticket, { kind: 'reply', destination: w.channel.url, parentExternalId: `tg:${GROUP_ID}:${comment.message_id}`, title: null, text: 'Thank you!', link: null, attachments: [] })
    expect(sent).toMatchObject({ status: 'confirmed', url: expect.stringContaining(`/natalmystic/${post.message_id}?comment=`) })
    expect(w.telegram.calls.at(-1)).toMatchObject({ method: 'sendMessage', params: { chat_id: String(GROUP_ID), text: 'Thank you!', reply_parameters: { message_id: comment.message_id } } })
    const missing = await connector.publish(loose, ticket, { kind: 'reply', destination: w.channel.url, parentExternalId: `tg:${GROUP_ID}:99999`, title: null, text: 'Hi', link: null, attachments: [] })
    expect(missing).toMatchObject({ status: 'failed', error: expect.stringMatching(/not among those Telegram delivered/) })
    // The bot's own answer is its own: the next reading makes no item of it.
    const again = await connector.fetchThread(ctx, `tg:${CHANNEL_ID}:${post.message_id}`)
    expect(again?.comments.map((c) => c.author)).toEqual(['Ann', '@natal_mystic_bot'])
  })

  it('counts subscribers, and reads every waiting update once', async () => {
    const w = await connected()
    for (let i = 0; i < 3; i++) w.telegram.ownerPosts(`Post ${i}`)
    const { connector, ctx } = w.core.connectorContext(w.channel.id)
    expect((await connector.fetchActivity(ctx, { limit: 25 })).discussions.map((d) => d.body)).toEqual(['Post 2', 'Post 1', 'Post 0'])
    await connector.fetchActivity(ctx, { limit: 25 })
    expect(w.telegram.calls.filter((c) => c.method === 'getUpdates').at(-1)?.params.offset).toBe(w.telegram.updates.at(-1)!.update_id + 1)
    expect(await connector.fetchMetrics(ctx)).toEqual([{ key: 'subscribers', label: 'Subscribers', value: 1234, available: true }])
  })
})
