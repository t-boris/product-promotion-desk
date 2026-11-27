// Themes (DEC-070).
import { afterEach, describe, expect, it } from 'vitest'
import { localDay } from '../../shared/seasonal'
import type { SendingService } from '../services'
import { buildPublicationPrompt } from './draft-prompt'
import { closeWorld, makeWorld, type World } from './test-fixture'
import { themeInForce } from './themes'

let world: World
afterEach(async () => closeWorld(world))
const DAY = 86_400_000
const day = (offset: number): string => localDay(world.clock.now().getTime() + offset * DAY)

describe('themes', () => {
  it('are kept by the owner, add up what went out in their days, and the running one is what the AI is given', async () => {
    world = makeWorld()
    const productId = world.product.id
    const call = world.core.router.call.bind(world.core.router)
    expect(await call('themes.list', { productId })).toEqual([])
    expect(themeInForce(world.core, productId)).toBeNull()
    await call('themes.save', { productId, name: 'Winter charts', message: 'What the winter sky says\nabout a chart.', from: day(10), to: day(16) })
    const list = await call('themes.save', { productId, name: '  First steps ', message: 'Reading a chart for the first time.', from: day(-1), to: day(5) })
    expect(list.map((t) => [t.name, t.state])).toEqual([['First steps', 'running'], ['Winter charts', 'ahead']])
    expect(themeInForce(world.core, productId)).toEqual({ name: 'First steps', message: 'Reading a chart for the first time.' })

    const { opportunity } = await call('publications.create', { channelId: world.channel.id, draft: { title: 'A post', text: 'A post of my own.' } })
    await call('opportunities.approve', { id: opportunity.id })
    const action = await (world.core.services.sending as SendingService).send(opportunity.id)
    world.core.db.prepare('UPDATE send_actions SET likes = 7, comments = 2, numbers_read_at = ? WHERE id = ?').run(world.clock.now().toISOString(), action.id)
    const [running, ahead] = await call('themes.list', { productId })
    expect(running!.recap).toEqual({ posts: 1, replies: 0, likes: 7, comments: 2 })
    expect(ahead!.recap).toEqual({ posts: 0, replies: 0, likes: 0, comments: 0 })

    // Changed days move it out of force; the recap stays with the days.
    const moved = await call('themes.save', { productId, id: running!.id, name: 'First steps', from: day(-9), to: day(-3) })
    expect(moved.find((t) => t.id === running!.id)).toMatchObject({ state: 'over', message: '', recap: { posts: 0 } })
    expect(themeInForce(world.core, productId)).toBeNull()

    await expect(call('themes.save', { productId, name: ' ', from: day(0), to: day(1) })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('themes.save', { productId, name: 'Back to front', from: day(3), to: day(1) })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('themes.save', { productId, id: 'nobody', name: 'x', from: day(0), to: day(1) })).rejects.toMatchObject({ code: 'not_found' })
    expect(await call('themes.remove', { id: ahead!.id })).toEqual({ removed: true })
    await expect(call('themes.remove', { id: ahead!.id })).rejects.toMatchObject({ code: 'not_found' })
    expect(world.engine.calls).toHaveLength(0)
  })

  it('reach the prompt of a proposed post as the owner\'s theme, quoted as data', () => {
    world = makeWorld()
    const base = { channel: { platform: 'reddit', target: 'r/x' } as never, product: { name: 'P', website: null, description: '' }, role: null as never, approved: [], prohibited: [], previousPosts: [], recentTitles: [] }
    const withTheme = buildPublicationPrompt({ ...base, theme: { name: 'First steps', message: 'Reading a chart for the first time.' } })
    expect(withTheme).toContain("The owner's theme for these days")
    expect(withTheme).toContain('"name":"First steps"')
    expect(buildPublicationPrompt(base)).not.toContain("The owner's theme")
  })
})
