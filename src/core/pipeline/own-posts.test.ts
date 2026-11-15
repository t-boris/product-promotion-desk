// A channel the app cannot read is a channel for the owner's own posts (DEC-034): it is activated without a first read, nothing observes it, no
// reply is prepared for it, and its posts go out through the same approval and gate as any other channel's.

import { afterEach, describe, expect, it } from 'vitest'
import { ChannelsStore } from '../channels/store'
import { reconcileChannels } from '../channels/reads'
import { toJson } from '../db/database'
import { FakeMetricsService } from './scheduler-fakes'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const OWN_POSTS = 'Your own posts only.'

/** A world whose only channel is one the app does not read, still in setup, as a freshly connected Instagram channel is. */
function ownPostsWorld(options: { status?: 'setup' | 'active' | 'paused' } = {}): World {
  const w = makeWorld({ mode: 'observe', baselineDone: false })
  w.connector.canRead = false
  const channel = w.addChannel({ reads: false, baselineDone: false, mode: 'observe', status: options.status ?? 'setup', target: '@brand' })
  w.channel = channel
  return w
}

const fetches = (): number => world.connector.calls.filter((c) => c.startsWith('fetchActivity')).length

describe('activating a channel the app does not read', () => {
  it('needs no first read: it becomes active at once and says what it is for', async () => {
    world = ownPostsWorld()
    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })
    expect(channel.status).toBe('active')
    expect(channel.statusDetail).toBe(OWN_POSTS)
    expect(channel.baselineDoneAt).toBeNull()
    expect(fetches()).toBe(0)
    expect(world.core.runs.list({ channelId: world.channel.id }).filter((r) => r.kind === 'monitor')).toEqual([])
  })

  it('does not ask for the ability to read comments', async () => {
    world = ownPostsWorld()
    const caps = world.channel.capabilities.map((c) => (c.key === 'read_comments' ? { ...c, status: 'unavailable' as const } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), world.channel.id)
    expect((await world.core.router.call('channels.activate', { channelId: world.channel.id })).status).toBe('active')
  })

  it('still needs a signed-in account, because its posts are made as that account', async () => {
    world = ownPostsWorld()
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'account_not_ready' })
    expect(world.refresh().status).toBe('setup')
  })

  it('is refused when posting itself is known to be impossible there', async () => {
    world = ownPostsWorld()
    const caps = world.channel.capabilities.map((c) => (c.key === 'publish_post' ? { ...c, status: 'unavailable' as const, detail: 'text only' } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), world.channel.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'publish_unavailable' })
    expect(world.refresh().status).toBe('setup')
  })

  it('is refused too when posting is restricted by the rules there', async () => {
    world = ownPostsWorld()
    const caps = world.channel.capabilities.map((c) => (c.key === 'publish_post' ? { ...c, status: 'restricted' as const, detail: 'no posts by new accounts' } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), world.channel.id)
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'publish_unavailable' })
    expect(world.refresh().status).toBe('setup')
  })

  it('does not activate a paused channel', async () => {
    world = ownPostsWorld({ status: 'paused' })
    await expect(world.core.router.call('channels.activate', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'channel_paused' })
  })

  it('asks the connector now, not what was stored: a channel stored as unread that the connector now reads is read first', async () => {
    world = ownPostsWorld()
    world.connector.canRead = true
    world.connector.addDiscussion({ externalId: 'd1' })
    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })
    expect(channel.reads).toBe(true)
    expect(channel.baselineDoneAt).not.toBeNull()
    expect(fetches()).toBe(1)
  })

  it('asks the connector now: a channel stored as read that the connector no longer reads is activated as own posts', async () => {
    world = makeWorld({ baselineDone: false })
    expect(world.channel.reads).toBe(true)
    world.connector.canRead = false
    const channel = await world.core.router.call('channels.activate', { channelId: world.channel.id })
    expect(channel).toMatchObject({ status: 'active', reads: false, statusDetail: OWN_POSTS })
    expect(fetches()).toBe(0)
  })
})

describe('what is never done to a channel the app does not read', () => {
  it('the monitor skips it without a failure, a read or a change of status', async () => {
    world = ownPostsWorld({ status: 'active' })
    const outcome = await world.monitor.runChannel(world.channel.id)
    expect(outcome).toMatchObject({ status: 'skipped', newOpportunities: 0 })
    expect(outcome.summary).toMatch(/does not read this channel/)
    expect(fetches()).toBe(0)
    expect(world.refresh()).toMatchObject({ status: 'active', lastRunAt: null, nextCheckAt: null })
  })

  it('"Check now" says there is nothing to check and starts no run', async () => {
    world = ownPostsWorld({ status: 'active' })
    await expect(world.core.router.call('channels.checkNow', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'not_read' })
    expect(world.core.runs.list({ channelId: world.channel.id })).toEqual([])
  })

  it('resuming a paused one puts it back to work, not back to setup', async () => {
    world = ownPostsWorld({ status: 'active' })
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    expect(world.refresh().status).toBe('paused')
    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed).toMatchObject({ status: 'active', statusDetail: OWN_POSTS })
  })

  it('a channel that was never started cannot be paused, and "resume" does not start it: that is what Activate is for', async () => {
    world = ownPostsWorld() // in setup, with a login that is not ready: Activate would refuse it
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    await expect(world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })).rejects.toMatchObject({ code: 'invalid_state' })
    expect(world.refresh().status).toBe('setup')
    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed).toMatchObject({ status: 'setup', statusDetail: '' })
  })

  it('no metrics are read for it, by the owner or by the sweep: no service call, no run, so no failed run', async () => {
    world = ownPostsWorld({ status: 'active' })
    const service = new FakeMetricsService()
    world.core.services.metrics = service
    await expect(world.core.router.call('results.refresh', { channelId: world.channel.id })).resolves.toEqual([])
    expect(service.calls).toEqual([])
    expect(world.core.runs.list({ channelId: world.channel.id })).toEqual([])
  })

  it('metrics of a channel the app reads are refreshed as before', async () => {
    world = makeWorld()
    const service = new FakeMetricsService()
    world.core.services.metrics = service
    await world.core.router.call('results.refresh', { channelId: world.channel.id })
    expect(service.calls).toEqual([world.channel.id])
    expect(world.core.runs.list({ channelId: world.channel.id }).filter((r) => r.kind === 'metrics')).toHaveLength(1)
  })

  it('resuming a channel the app reads, with no first read yet, still goes back to setup', async () => {
    world = makeWorld({ baselineDone: false })
    world.core.db.prepare("UPDATE channels SET status = 'active' WHERE id = ?").run(world.channel.id) // started, as one is when it was not read before
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    const resumed = await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect(resumed).toMatchObject({ status: 'setup', statusDetail: '' })
  })
})

describe('its own posts', () => {
  it('go through the same approval and gate and reach the platform from an active channel', async () => {
    world = ownPostsWorld()
    await world.core.router.call('channels.activate', { channelId: world.channel.id })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'Our first post. I work on this product.' } })
    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    const action = await world.sending.send(opportunity.id)
    expect(action.state).toBe('confirmed')
    expect(world.connector.published).toHaveLength(1)
    expect(world.connector.published[0].request.destination).toBe(world.channel.url)
  })

  it('are still refused while the channel has not been activated: that is what activating is for', async () => {
    world = ownPostsWorld()
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'A post' } })
    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    await expect(world.sending.send(opportunity.id)).rejects.toThrow(/not been activated/)
    expect(world.connector.published).toHaveLength(0)
  })
})

describe('the start of the application', () => {
  it('tells each channel again whether the app reads it, both ways', () => {
    world = makeWorld()
    const unread = world.addChannel({ target: 'r/unread' })
    expect(unread.reads).toBe(true)
    world.connector.canRead = false
    reconcileChannels(world.core, new ChannelsStore(world.core.db, world.core.clock, world.core.repos))
    expect(world.refresh(unread).reads).toBe(false)
    world.connector.canRead = true
    reconcileChannels(world.core, new ChannelsStore(world.core.db, world.core.clock, world.core.repos))
    expect(world.refresh(unread).reads).toBe(true)
  })

  it('calls a channel that was named by its address by its handle, once, and leaves every other name alone', () => {
    world = makeWorld()
    const store = new ChannelsStore(world.core.db, world.core.clock, world.core.repos)
    const set = (id: string, platform: string, target: string, url: string): void => {
      world.core.db.prepare('UPDATE channels SET platform = ?, target = ?, url = ? WHERE id = ?').run(platform, target, url, id)
    }
    const legacy = world.addChannel({ target: 'x' })
    set(legacy.id, 'instagram', 'www.instagram.com/boris_chart_notebook', 'https://www.instagram.com/boris_chart_notebook')
    const chosen = world.addChannel({ target: 'x' })
    set(chosen.id, 'instagram', 'My brand page', 'https://www.instagram.com/brandpage/')
    const group = world.addChannel({ target: 'x' })
    set(group.id, 'facebook', 'www.facebook.com/groups/astrologyclub', 'https://www.facebook.com/groups/astrologyclub')
    const reddit = world.addChannel({ target: 'r/test' })

    reconcileChannels(world.core, store)
    reconcileChannels(world.core, store) // safe to repeat

    expect(world.refresh(legacy).target).toBe('@boris_chart_notebook')
    expect(world.refresh(legacy).url).toBe('https://www.instagram.com/boris_chart_notebook') // the destination of a post is never touched
    expect(world.refresh(chosen).target).toBe('My brand page')
    expect(world.refresh(group).target).toBe('www.facebook.com/groups/astrologyclub')
    expect(world.refresh(reddit).target).toBe('r/test')
  })

  it('does not rename a channel into a name another channel of the same account already has', () => {
    world = makeWorld()
    const store = new ChannelsStore(world.core.db, world.core.clock, world.core.repos)
    const taken = world.addChannel({ target: '@brand' })
    world.core.db.prepare("UPDATE channels SET platform = 'instagram', url = 'https://www.instagram.com/brand/' WHERE id = ?").run(taken.id)
    const legacy = world.addChannel({ target: 'x' })
    world.core.db.prepare("UPDATE channels SET platform = 'instagram', target = 'www.instagram.com/brand', url = 'https://www.instagram.com/brand' WHERE id = ?").run(legacy.id)
    reconcileChannels(world.core, store)
    expect(world.refresh(legacy).target).toBe('www.instagram.com/brand')
    // The database would refuse the same name twice anyway; the point is that nothing is attempted and nothing is logged at every start.
    expect(world.core.log.list(100, 'warn').filter((e) => /Could not bring/.test(e.message))).toEqual([])
  })
})
