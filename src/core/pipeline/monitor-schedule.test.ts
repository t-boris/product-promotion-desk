import { afterEach, describe, expect, it } from 'vitest'
import { jitterWindowMs, nextCheckFor } from './scheduler-timing'
import { closeWorld, makeWorld, type World } from './test-fixture'

// When the monitor plans the next check of a channel (DEC-040): through nextCheckFor, the same function as the scheduler.

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const MINUTE = 60_000

describe('monitor: the next check after a cycle', () => {
  it('is exactly the interval later when jitter is off (the default of every test)', async () => {
    world = makeWorld({ settings: { checkIntervalMin: 45 } })
    expect(world.core.scheduleJitter).toBe(false)

    await world.monitor.runChannel(world.channel.id)

    expect(world.refresh().nextCheckAt).toBe(new Date(world.clock.now().getTime() + 45 * MINUTE).toISOString())
  })

  it('is the time nextCheckFor gives when jitter is on, inside the window, and different for each channel', async () => {
    world = makeWorld({ scheduleJitter: true, settings: { checkIntervalMin: 45 } })
    const channels = [world.channel, ...Array.from({ length: 5 }, () => world.addChannel())]
    const offsets: number[] = []
    for (const channel of channels) {
      const before = world.refresh(channel)
      const outcome = await world.monitor.runChannel(channel.id)
      expect(outcome.status).toBe('ok')

      const planned = world.refresh(channel).nextCheckAt
      expect(planned).toBe(nextCheckFor(before, world.clock.now().getTime(), true))
      const offset = Date.parse(planned!) - (world.clock.now().getTime() + 45 * MINUTE)
      expect(Math.abs(offset)).toBeLessThanOrEqual(jitterWindowMs(45))
      offsets.push(offset)
    }
    expect(new Set(offsets).size).toBe(channels.length)
  })

  it('is planned by the same function when the channel is suspended', async () => {
    world = makeWorld({ scheduleJitter: true, settings: { checkIntervalMin: 60 } })
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    const before = world.refresh()

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('suspended')
    expect(world.refresh().nextCheckAt).toBe(nextCheckFor(before, world.clock.now().getTime(), true))
  })

  it('is exact for a suspended channel when jitter is off', async () => {
    world = makeWorld({ settings: { checkIntervalMin: 60 } })
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)

    await world.monitor.runChannel(world.channel.id)

    expect(world.refresh().nextCheckAt).toBe(new Date(world.clock.now().getTime() + 60 * MINUTE).toISOString())
  })

  it.each([false, true])('keeps its own shorter retry after a failure (jitter %s)', async (scheduleJitter) => {
    world = makeWorld({ scheduleJitter, settings: { checkIntervalMin: 180 } })
    world.connector.fetchActivityError = new Error('layout changed unexpectedly')

    const outcome = await world.monitor.runChannel(world.channel.id)

    expect(outcome.status).toBe('failed')
    expect(world.refresh().nextCheckAt).toBe(new Date(world.clock.now().getTime() + 10 * MINUTE).toISOString())
  })
})

describe('activation and "Check now" plan the next check the same way', () => {
  it.each([false, true])('channels.activate: through nextCheckFor (jitter %s)', async (scheduleJitter) => {
    world = makeWorld({ scheduleJitter, baselineDone: false, settings: { checkIntervalMin: 180 } })
    world.connector.addDiscussion({ externalId: 'd1' })
    const before = world.refresh()

    await world.core.router.call('channels.activate', { channelId: world.channel.id })

    const now = world.clock.now().getTime()
    expect(world.refresh().nextCheckAt).toBe(nextCheckFor(before, now, scheduleJitter))
    if (!scheduleJitter) expect(world.refresh().nextCheckAt).toBe(new Date(now + 180 * MINUTE).toISOString())
  })

  it.each([false, true])('channels.checkNow: through nextCheckFor (jitter %s)', async (scheduleJitter) => {
    world = makeWorld({ scheduleJitter, settings: { checkIntervalMin: 60 } })
    const before = world.refresh()

    await world.core.router.call('channels.checkNow', { channelId: world.channel.id })

    expect(world.refresh().nextCheckAt).toBe(nextCheckFor(before, world.clock.now().getTime(), scheduleJitter))
  })
})
