// The owner's choices about how a product is worked (DEC-071).
import { afterEach, describe, expect, it } from 'vitest'
import { limitLine } from '../../shared/product-choices'
import type { SendingService } from '../services'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const DAY = 86_400_000
const POST = { topic: 'Charts', title: 'How charts work, again', text: 'A natal chart is built from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'] }
const run = (): Promise<number> => world.core.services.mix!.runDue()
const standalone = (): { reason: string }[] => world.core.db.prepare("SELECT reason FROM opportunities WHERE kind = 'standalone' AND state = 'draft' ORDER BY rowid").all() as { reason: string }[]

describe('the owner\'s choices about how a product is worked', () => {
  it('are all off at first; the limit is a number that is shown, and a venue keeps the owner\'s ticks', async () => {
    world = makeWorld()
    const productId = world.product.id
    const call = world.core.router.call.bind(world.core.router)
    expect(await call('choices.get', { productId })).toMatchObject({ channelLimit: null, lowTime: false, software: false, inWork: 1 })
    expect(await call('choices.set', { productId, channelLimit: 2, software: true })).toMatchObject({ channelLimit: 2, lowTime: false, software: true })
    expect(await call('choices.set', { productId, channelLimit: null })).toMatchObject({ channelLimit: null, software: true })
    await expect(call('choices.set', { productId, channelLimit: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(limitLine(6, 2)).toBe('6 in work · your limit is 2 (4 over)')
    expect(limitLine(2, 2)).toBe('2 in work · your limit is 2')
    expect(limitLine(6, null)).toBe('6 in work')

    expect((await call('choices.venues', { productId })).every((v) => v.done.length === 0)).toBe(true)
    await call('choices.tickVenue', { productId, venue: 'showhn', step: 'rules', done: true })
    const ticked = await call('choices.tickVenue', { productId, venue: 'showhn', step: 'day', done: true })
    expect(ticked.find((v) => v.venue === 'showhn')!.done).toEqual(['rules', 'day'])
    expect((await call('choices.tickVenue', { productId, venue: 'showhn', step: 'rules', done: false })).find((v) => v.venue === 'showhn')!.done).toEqual(['day'])
    await expect(call('choices.tickVenue', { productId, venue: 'elsewhere', step: 'rules', done: true })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(world.engine.calls).toHaveLength(0)
  })

  it('in a week with no time the mix prepares only a re-cut of an earlier post, once a week, as a draft, and only where a post went out', async () => {
    world = makeWorld({ mode: 'approval' })
    world.engine.on('draft.publication', JSON.stringify(POST))
    world.setSettings(world.channel.id, { mix: [{ kind: 'product_post', enabled: true, everyDays: 1 }] })
    await world.core.router.call('choices.set', { productId: world.product.id, lowTime: true })
    // Nothing was sent in the channel yet: there is nothing to re-cut, and the usual mix rests.
    world.clock.advance(30 * DAY)
    expect(await run()).toBe(0)
    expect(standalone()).toHaveLength(0)

    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'A post', text: 'A post of my own.' } })
    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    await (world.core.services.sending as SendingService).send(opportunity.id)
    world.clock.advance(30 * DAY)
    expect(await run()).toBe(1)
    expect(standalone()).toHaveLength(1)
    expect(standalone()[0]!.reason).toContain('a week with no time')
    expect(world.engine.calls.at(-1)!.prompt).toContain('a week when the owner has no time')
    expect(world.connector.published).toHaveLength(1)
    // Not again within the week.
    world.clock.advance(2 * DAY)
    expect(await run()).toBe(0)

    // Switched off: the usual mix is back.
    await world.core.router.call('choices.set', { productId: world.product.id, lowTime: false })
    world.clock.advance(30 * DAY)
    expect(await run()).toBe(1)
    expect(standalone().at(-1)!.reason).not.toContain('a week with no time')
  })
})
