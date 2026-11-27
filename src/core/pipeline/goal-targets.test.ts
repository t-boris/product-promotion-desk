// A goal's number and date (DEC-067): the application counts, the AI is not asked.
import { afterEach, describe, expect, it } from 'vitest'
import { localDay } from '../../shared/seasonal'
import type { SendingService } from '../services'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))

const DAY = 86_400_000
const sending = (): SendingService => world.core.services.sending as SendingService
const day = (offsetDays: number): string => localDay(world.clock.now().getTime() + offsetDays * DAY)

async function sentPost(title: string, numbers?: { likes: number; comments: number }) {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: 'A post of my own.' } })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  const action = await sending().send(opportunity.id)
  expect(action.state).toBe('confirmed')
  if (numbers) world.core.db.prepare('UPDATE send_actions SET likes = ?, comments = ?, numbers_read_at = ? WHERE id = ?').run(numbers.likes, numbers.comments, world.clock.now().toISOString(), action.id)
}

describe('a goal with a number and a date', () => {
  it('counts from the moment it is set, to its day, and says reached or not', async () => {
    world = makeWorld()
    const productId = world.product.id
    const call = world.core.router.call.bind(world.core.router)
    await sentPost('Before the target')
    const product = await call('products.saveGoal', { id: productId, goal: { targetAction: 'Create a chart', successMetrics: [], notes: '' } })
    const goalId = product.goals[product.goals.length - 1]!.id
    expect(await call('goals.progress', { productId })).toEqual([])

    world.clock.advance(60_000)
    const set = await call('goals.setTarget', { productId, goalId, target: { measure: 'posts', number: 2, by: day(7) } })
    expect(set).toMatchObject([{ goalId, measure: 'posts', number: 2, count: 0, state: 'running' }])

    world.clock.advance(60_000)
    await sentPost('The first after', { likes: 30, comments: 4 })
    expect((await call('goals.progress', { productId }))[0]).toMatchObject({ count: 1, state: 'running' })

    // A changed number or day keeps the count; a changed measure starts it over.
    const since = set[0]!.since
    expect((await call('goals.setTarget', { productId, goalId, target: { measure: 'posts', number: 1, by: day(3) } }))[0]).toMatchObject({ since, count: 1, state: 'reached' })
    world.clock.advance(60_000)
    const likes = await call('goals.setTarget', { productId, goalId, target: { measure: 'likes', number: 50, by: day(1) } })
    expect(likes[0]!.since).not.toBe(since)
    expect(likes[0]).toMatchObject({ count: 0, state: 'running' })
    // Past the account's hourly limit of sends.
    world.clock.advance(2 * 3600_000)
    await sentPost('The second after', { likes: 12, comments: 1 })
    expect((await call('goals.progress', { productId }))[0]).toMatchObject({ count: 12, state: 'running' })
    world.clock.advance(3 * DAY)
    expect((await call('goals.progress', { productId }))[0]).toMatchObject({ count: 12, state: 'missed', daysLeft: 0 })

    await expect(call('goals.setTarget', { productId, goalId, target: { measure: 'posts', number: 0, by: day(7) } })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('goals.setTarget', { productId, goalId, target: { measure: 'posts', number: 3, by: day(-2) } })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('goals.setTarget', { productId, goalId: 'nobody', target: null })).rejects.toMatchObject({ code: 'not_found' })

    // A removed goal takes its target with it.
    await call('products.removeGoal', { id: productId, goalId })
    expect(await call('goals.progress', { productId })).toEqual([])
    expect(world.core.db.prepare('SELECT COUNT(*) AS n FROM goal_targets').get()).toEqual({ n: 0 })
    expect(world.engine.calls).toHaveLength(0)
  })
})
