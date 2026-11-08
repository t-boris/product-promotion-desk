import { afterEach, describe, expect, it } from 'vitest'
import { TakeoverError } from '../ports'
import { FakeConnector } from '../testing/fake-connector'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const count = (w: World, sql: string, ...params: unknown[]): number => (w.core.db.prepare(sql).get(...params) as { c: number }).c

describe('monitor: baseline (REQ-003 criterion 1, SRC-001 section 3 step 8)', () => {
  it('stores everything of the first cycle as baseline and creates no opportunities', async () => {
    world = makeWorld({ baselineDone: false })
    const { connector, channel } = world
    connector.addDiscussion({ externalId: 'd1' })
    connector.addComment('d1', { externalId: 'c1', body: 'old question' })
    connector.addComment('d1', { externalId: 'c2', body: 'another old one' })

    const outcome = await world.monitor.runChannel(channel.id)

    expect(outcome.status).toBe('ok')
    expect(outcome.newOpportunities).toBe(0)
    expect(count(world, 'SELECT COUNT(*) c FROM comments WHERE baseline = 1')).toBe(2)
    expect(count(world, 'SELECT COUNT(*) c FROM comments WHERE baseline = 0')).toBe(0)
    expect(count(world, 'SELECT COUNT(*) c FROM opportunities')).toBe(0)
    expect(world.refresh().baselineDoneAt).not.toBeNull()
  })

  it('persists run progress so a restart resumes correctly', async () => {
    world = makeWorld({ baselineDone: false, settings: { checkIntervalMin: 45 } })
    world.connector.addDiscussion({ externalId: 'd1' })
    await world.monitor.runChannel(world.channel.id)

    const channel = world.refresh()
    const now = world.clock.now()
    expect(channel.lastRunAt).toBe(now.toISOString())
    expect(channel.lastSuccessAt).toBe(now.toISOString())
    expect(channel.nextCheckAt).toBe(new Date(now.getTime() + 45 * 60_000).toISOString())
  })

  it('treats comments after the baseline as new events', async () => {
    world = makeWorld({ baselineDone: false })
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'old', body: 'old' })
    await world.monitor.runChannel(world.channel.id)

    const opp = await world.newOpportunity({ commentId: 'fresh', body: 'a new question' })

    expect(opp.state).toBe('discovered')
    expect(opp.kind).toBe('reply')
    expect(count(world, 'SELECT COUNT(*) c FROM opportunities')).toBe(1)
    const fresh = world.core.db.prepare("SELECT baseline FROM comments WHERE external_id = 'fresh'").get() as { baseline: number }
    expect(fresh.baseline).toBe(0)
  })
})

describe('monitor: deduplication and own comments (REQ-003 criterion 1)', () => {
  it('a rediscovered comment updates its row and never creates a second opportunity', async () => {
    world = makeWorld()
    const first = await world.newOpportunity({ commentId: 'c1' })
    const firstSeen = world.core.db.prepare("SELECT last_seen_at FROM comments WHERE external_id = 'c1'").get() as { last_seen_at: string }

    for (let i = 0; i < 3; i++) {
      world.clock.advance(60_000)
      const outcome = await world.monitor.runChannel(world.channel.id)
      expect(outcome.status).toBe('ok')
      expect(outcome.newOpportunities).toBe(0)
    }

    expect(count(world, 'SELECT COUNT(*) c FROM opportunities')).toBe(1)
    expect(count(world, 'SELECT COUNT(*) c FROM comments WHERE external_id = ?', 'c1')).toBe(1)
    const later = world.core.db.prepare("SELECT last_seen_at FROM comments WHERE external_id = 'c1'").get() as { last_seen_at: string }
    expect(later.last_seen_at > firstSeen.last_seen_at).toBe(true)
    expect(world.opportunity(first.id).state).toBe('discovered')
  })

  it('stores the account\'s own comments as own and never queues work for them', async () => {
    world = makeWorld()
    const { connector } = world
    connector.addDiscussion({ externalId: 'd1' })
    connector.addComment('d1', { externalId: 'own1', author: 'Brand_Account', body: 'my earlier reply' })
    connector.addComment('d1', { externalId: 'own2', author: 'u/BRAND_account', body: 'another own reply' })
    connector.addComment('d1', { externalId: 'other', author: 'someone', body: 'hello' })

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.newOpportunities).toBe(1)
    const own = world.core.db.prepare("SELECT external_id FROM comments WHERE is_own = 1 ORDER BY external_id").all() as { external_id: string }[]
    expect(own.map((r) => r.external_id)).toEqual(['own1', 'own2'])
    expect(count(world, 'SELECT COUNT(*) c FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE c.is_own = 1')).toBe(0)
  })

  it('does not start an automatic reply chain with its own published reply', async () => {
    world = makeWorld({ mode: 'approval' })
    const opp = await world.readyReply()
    await world.sending.send(opp.id)
    expect(world.opportunity(opp.id).state).toBe('confirmed')

    // The platform now shows our reply as a new comment under the original one.
    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.newOpportunities).toBe(0)
    expect(count(world, 'SELECT COUNT(*) c FROM comments WHERE is_own = 1')).toBe(1)
    expect(count(world, 'SELECT COUNT(*) c FROM opportunities')).toBe(1)
  })

  it('also recognises its own reply by the recorded platform id when the author name does not match', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await world.sending.send(opp.id)
    // The platform reports the author under a display name the account identity does not match.
    world.connector.discussions[0].comments.at(-1)!.author = 'Brand Display Name'

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.newOpportunities).toBe(0)
    expect(count(world, 'SELECT COUNT(*) c FROM comments WHERE is_own = 1')).toBe(1)
  })

  it('creates no opportunities while the account identity is unknown, because own comments cannot be told apart', async () => {
    world = makeWorld({ identity: null })
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'c1' })

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('ok')
    expect(outcome.newOpportunities).toBe(0)
    expect(count(world, 'SELECT COUNT(*) c FROM comments')).toBe(1)
    expect(world.refresh().statusDetail).toMatch(/identity is unknown/)
  })
})

describe('monitor: changed comments (SRC-001 section 4: thread changes before sending are honored)', () => {
  it('sends an approved opportunity back to review with an explanation and invalidates the approval', async () => {
    world = makeWorld({ mode: 'approval' })
    const opp = await world.readyReply({})
    expect(world.opportunity(opp.id).state).toBe('ready')

    world.connector.editComment('d1', world.core.repos.comment(opp.commentId as string).externalId, 'Actually, a completely different question')
    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('ok')
    const after = world.opportunity(opp.id)
    expect(after.state).toBe('awaiting_approval')
    expect(after.reason).toMatch(/edited/)
    const card = world.card(opp.id)
    expect(card.approval).toBeNull()
    expect(card.comment?.body).toBe('Actually, a completely different question')
    const invalidated = world.core.db.prepare('SELECT invalidated_at, invalid_reason FROM approvals').get() as { invalidated_at: string | null; invalid_reason: string }
    expect(invalidated.invalidated_at).not.toBeNull()
    expect(invalidated.invalid_reason).toMatch(/edited/)
  })

  it('returns a no-draft item to discovered so it is evaluated against the new text', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity({ commentId: 'c1', body: 'first text' })
    world.core.db.prepare("UPDATE opportunities SET state = 'no_reply', reason = 'nothing to say' WHERE id = ?").run(opp.id)

    world.connector.editComment('d1', 'c1', 'second text, now a real question?')
    await world.monitor.runChannel(world.channel.id)

    expect(world.opportunity(opp.id).state).toBe('discovered')
  })

  it('leaves an already confirmed send untouched', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await world.sending.send(opp.id)

    world.connector.editComment('d1', world.core.repos.comment(opp.commentId as string).externalId, 'edited after we replied')
    await world.monitor.runChannel(world.channel.id)

    expect(world.opportunity(opp.id).state).toBe('confirmed')
    expect(world.core.repos.lastAction(opp.id)?.state).toBe('confirmed')
  })
})

describe('monitor: failures never throw and never affect other channels (REQ-005)', () => {
  it('suspends the channel and marks the account when the login expired', async () => {
    world = makeWorld()
    world.connector.fetchActivityError = new Error('redirected to login')
    world.connector.login = { loggedIn: false, identity: null, captcha: false }

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('suspended')
    expect(world.refresh().status).toBe('needs_user')
    expect(world.refresh().statusDetail).toMatch(/sign/i)
    expect(world.core.repos.account(world.account.id).status).toBe('login_required')
  })

  it('suspends on a CAPTCHA and records it on the account', async () => {
    world = makeWorld()
    world.connector.fetchActivityError = new Error('blocked')
    world.connector.login = { loggedIn: true, identity: 'brand_account', captcha: true }

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('suspended')
    expect(world.core.repos.account(world.account.id).status).toBe('captcha')
    expect(world.refresh().status).toBe('needs_user')
  })

  it('suspends without touching the account when the user took control of the browser', async () => {
    world = makeWorld()
    world.browser.session(world.account).takeControl()

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('suspended')
    expect(world.core.repos.account(world.account.id).status).toBe('ready')
    expect(world.refresh().status).toBe('needs_user')
  })

  it('suspends when a connector reports a takeover itself', async () => {
    world = makeWorld()
    world.connector.fetchActivityError = new TakeoverError()
    const outcome = await world.monitor.runChannel(world.channel.id)
    expect(outcome.status).toBe('suspended')
  })

  it('reports other errors as a failure with the reason on the channel', async () => {
    world = makeWorld()
    world.connector.fetchActivityError = new Error('layout changed unexpectedly')

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('failed')
    expect(world.refresh().status).toBe('error')
    expect(world.refresh().statusDetail).toMatch(/layout changed unexpectedly/)
    expect(world.refresh().lastRunAt).not.toBeNull()
    expect(world.refresh().lastSuccessAt).toBeNull()
  })

  it('does not run on an account that needs login, and resumes after the user signs in', async () => {
    world = makeWorld()
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    world.connector.addDiscussion({ externalId: 'd1' })

    const suspended = await world.monitor.runChannel(world.channel.id)
    expect(suspended.status).toBe('suspended')
    expect(world.connector.calls).not.toContain('fetchActivity')
    expect(world.core.repos.account(world.account.id).status).toBe('login_required')

    world.core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(world.account.id)
    const resumed = await world.monitor.runChannel(world.channel.id)
    expect(resumed.status).toBe('ok')
    expect(world.refresh().status).toBe('active')
    expect(world.refresh().statusDetail).toBe('')
  })

  it("one channel's failure does not stop another channel", async () => {
    world = makeWorld()
    const broken = new FakeConnector({ id: 'broken', identity: 'other_account' })
    broken.fetchActivityError = new Error('site is down')
    world.core.connectors.register(broken)
    const second = world.addAccount({ label: 'Second', identity: 'other_account' })
    const failing = world.addChannel({ accountId: second.id, connectorId: 'broken', target: 'r/broken' })
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'c1' })

    const [bad, good] = await Promise.all([world.monitor.runChannel(failing.id), world.monitor.runChannel(world.channel.id)])

    expect(bad.status).toBe('failed')
    expect(good.status).toBe('ok')
    expect(good.newOpportunities).toBe(1)
    expect(world.refresh(failing).status).toBe('error')
    expect(world.refresh().status).toBe('active')
  })

  it('skips a paused channel and a channel that is already being checked', async () => {
    world = makeWorld()
    world.core.db.prepare("UPDATE channels SET status = 'paused' WHERE id = ?").run(world.channel.id)
    expect((await world.monitor.runChannel(world.channel.id)).status).toBe('skipped')

    world.core.db.prepare("UPDATE channels SET status = 'active' WHERE id = ?").run(world.channel.id)
    let release!: () => void
    world.connector.fetchActivityError = null
    const originalFetch = world.connector.fetchActivity.bind(world.connector)
    world.connector.fetchActivity = async (ctx, options) => {
      await new Promise<void>((resolve) => (release = resolve))
      return originalFetch(ctx, options)
    }
    const running = world.monitor.runChannel(world.channel.id)
    await Promise.resolve()
    expect((await world.monitor.runChannel(world.channel.id)).status).toBe('skipped')
    release()
    expect((await running).status).toBe('ok')
  })

  it('returns a failed outcome instead of throwing for a missing channel', async () => {
    world = makeWorld()
    const outcome = await world.monitor.runChannel('does-not-exist')
    expect(outcome.status).toBe('failed')
  })
})

describe('older discussions (channels.discussions / channels.selectOlder)', () => {
  const setup = async (): Promise<void> => {
    world = makeWorld({ baselineDone: false })
    world.connector.addDiscussion({ externalId: 'd1', title: 'Old thread' })
    world.connector.addDiscussion({ externalId: 'd2', title: 'Other thread' })
    world.connector.addComment('d1', { externalId: 'a', author: 'alice', body: 'old question A' })
    world.connector.addComment('d1', { externalId: 'b', author: 'brand_account', body: 'my own old reply' })
    world.connector.addComment('d1', { externalId: 'c', author: 'carol', body: 'old question C' })
    world.connector.addComment('d2', { externalId: 'e', author: 'erin', body: 'unrelated' })
    await world.monitor.runChannel(world.channel.id)
  }

  it('lists discussions and turns the selected one\'s non-own baseline comments into opportunities', async () => {
    await setup()
    const list = await world.core.router.call('channels.discussions', { channelId: world.channel.id })
    expect(list.map((d) => d.title).sort()).toEqual(['Old thread', 'Other thread'])
    expect(list.every((d) => !d.selectedForProcessing)).toBe(true)
    expect(count(world, 'SELECT COUNT(*) c FROM opportunities')).toBe(0)

    const d1 = list.find((d) => d.externalId === 'd1')!
    const after = await world.core.router.call('channels.selectOlder', { channelId: world.channel.id, discussionIds: [d1.id], selected: true })

    expect(after.find((d) => d.id === d1.id)?.selectedForProcessing).toBe(true)
    const opps = world.core.db.prepare("SELECT c.external_id, o.state FROM opportunities o JOIN comments c ON c.id = o.comment_id ORDER BY c.external_id").all() as { external_id: string; state: string }[]
    expect(opps).toEqual([
      { external_id: 'a', state: 'discovered' },
      { external_id: 'c', state: 'discovered' }
    ])
  })

  it('is idempotent and withdraws untouched opportunities when unselected', async () => {
    await setup()
    const [d1] = (await world.core.router.call('channels.discussions', { channelId: world.channel.id })).filter((d) => d.externalId === 'd1')
    const args = { channelId: world.channel.id, discussionIds: [d1.id] }
    await world.core.router.call('channels.selectOlder', { ...args, selected: true })
    await world.core.router.call('channels.selectOlder', { ...args, selected: true })
    expect(count(world, 'SELECT COUNT(*) c FROM opportunities')).toBe(2)

    // One of them gets worked on, the other does not.
    const worked = world.core.db.prepare("SELECT o.id FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE c.external_id = 'a'").get() as { id: string }
    await world.core.router.call('opportunities.saveDraft', { id: worked.id, draft: { text: 'my own answer' } })

    await world.core.router.call('channels.selectOlder', { ...args, selected: false })

    const left = world.core.db.prepare('SELECT id FROM opportunities').all() as { id: string }[]
    expect(left.map((r) => r.id)).toEqual([worked.id])
  })

  it('refuses to select while the account identity is unknown', async () => {
    world = makeWorld({ baselineDone: false, identity: null })
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'a' })
    await world.monitor.runChannel(world.channel.id)
    const [d1] = await world.core.router.call('channels.discussions', { channelId: world.channel.id })
    await expect(world.core.router.call('channels.selectOlder', { channelId: world.channel.id, discussionIds: [d1.id], selected: true })).rejects.toMatchObject({ code: 'identity_unknown' })
  })
})
