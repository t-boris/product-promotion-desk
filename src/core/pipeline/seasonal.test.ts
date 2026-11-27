// The seasonal calendar of a product (DEC-060).
import { afterEach, describe, expect, it } from 'vitest'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const pid = (): string => world.product.id
const call: World['core']['router']['call'] = (method, args) => world.core.router.call(method, args)

describe('the seasonal calendar', () => {
  it('shows nothing until the owner chooses calendars or adds a date; then the dates ahead with each channel\'s lead time', async () => {
    world = makeWorld()
    world.clock.set('2026-11-27T12:00:00.000Z')
    expect(await call('seasonal.get', { productId: pid() })).toMatchObject({ kinds: [], own: [], events: [] })
    expect((await call('attention.list', undefined)).some((i) => i.id.startsWith('seasonal:'))).toBe(false)

    let view = await call('seasonal.setKinds', { productId: pid(), kinds: ['gifts', 'gifts'] })
    expect(view.kinds).toEqual(['gifts'])
    const names = view.events.map((e) => e.name)
    expect(names).toContain('Christmas')
    expect(names).toEqual(['Black Friday', 'Cyber Monday', 'Christmas', 'New Year’s Day'])
    expect(names).not.toContain('Thanksgiving')
    const christmas = view.events.find((e) => e.name === 'Christmas')!
    expect(christmas).toMatchObject({ key: 'gift:christmas:2026', days: 28, skipped: false })
    expect(christmas.channels).toEqual([{ channelId: world.channel.id, target: world.channel.target, platform: world.channel.platform, leadDays: 7, due: false, opportunityId: null }])
    await expect(call('seasonal.setKinds', { productId: pid(), kinds: ['tides' as never] })).rejects.toMatchObject({ code: 'invalid_input' })

    view = await call('seasonal.addDate', { productId: pid(), name: '  Shop   birthday ', month: 12, day: 1 })
    expect(view.own).toMatchObject([{ name: 'Shop birthday', month: 12, day: 1, year: null }])
    const own = view.events.find((e) => e.kind === 'own')!
    expect(own).toMatchObject({ name: 'Shop birthday', days: 4 })
    expect(own.channels[0]!.due).toBe(true)
    await expect(call('seasonal.addDate', { productId: pid(), name: 'x', month: 2, day: 30 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('seasonal.addDate', { productId: pid(), name: 'x', month: 2, day: 29, year: 2027 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('seasonal.addDate', { productId: pid(), name: ' ', month: 2, day: 2 })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('asks once in the Inbox when it is time, prepares a draft for a date and a channel on the owner\'s press, and stops asking when prepared or skipped', async () => {
    world = makeWorld()
    world.clock.set('2026-11-27T12:00:00.000Z')
    let view = await call('seasonal.addDate', { productId: pid(), name: 'Shop birthday', month: 12, day: 1 })
    const key = view.events[0]!.key
    const item = async () => (await call('attention.list', undefined)).find((i) => i.id === `seasonal:${pid()}`)
    expect((await item())?.title).toBe('A date is coming: Shop birthday (Dec 1)')

    view = await call('seasonal.skip', { productId: pid(), eventKey: key, skipped: true })
    expect(view.events[0]!.skipped).toBe(true)
    expect(await item()).toBeUndefined()
    await call('seasonal.skip', { productId: pid(), eventKey: key, skipped: false })
    expect(await item()).toBeDefined()

    world.engine.on('draft.publication', JSON.stringify({ topic: 'Birthday', title: 'A year of charts', text: 'A natal chart is built from your birth date, time and place.', link: null, rationale: 'from c1', usedClaimIds: ['c1'] }))
    const card = await call('seasonal.prepare', { productId: pid(), eventKey: key, channelId: world.channel.id })
    expect(card.opportunity).toMatchObject({ kind: 'standalone', state: 'draft' })
    expect(card.opportunity.reason).toMatch(/For Shop birthday on Dec 1/)
    const prompt = world.engine.calls.at(-1)!.prompt
    expect(prompt).toContain('"Shop birthday"')
    expect(prompt).toContain('in 4 days')
    expect(world.connector.published).toHaveLength(0)
    view = await call('seasonal.get', { productId: pid() })
    expect(view.events[0]!.channels[0]!.opportunityId).toBe(card.opportunity.id)
    expect(await item()).toBeUndefined()
    await expect(call('seasonal.prepare', { productId: pid(), eventKey: key, channelId: world.channel.id })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(call('seasonal.prepare', { productId: pid(), eventKey: 'own:none:2026', channelId: world.channel.id })).rejects.toMatchObject({ code: 'not_found' })

    // The date removed, nothing of it is ahead.
    view = await call('seasonal.removeDate', { id: view.own[0]!.id })
    expect(view).toMatchObject({ own: [], events: [] })
  })
})
