// The people met (DEC-066).
import { afterEach, describe, expect, it } from 'vitest'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const pid = (): string => world.product.id
const call: World['core']['router']['call'] = (method, args) => world.core.router.call(method, args)

describe('the people met', () => {
  it('are kept by the owner\'s hand, those owed something first, and the AI is never asked', async () => {
    world = makeWorld()
    expect(await call('people.list', { productId: pid() })).toEqual([])
    const a = await call('people.save', { productId: pid(), handle: '  u/moon_reader ', platform: 'reddit', where: 'r/beginnerastrology', note: 'Asked about birth times.\nLiked the answer.' })
    expect(a).toMatchObject({ handle: 'u/moon_reader', where: 'r/beginnerastrology', note: 'Asked about birth times. Liked the answer.', owed: '', permission: 'none' })
    world.clock.advance(60_000)
    const b = await call('people.save', { productId: pid(), handle: '@clay', testimonial: 'The first chart I understood.', testimonialSource: 'https://www.instagram.com/p/x', permission: 'given' })
    expect(b).toMatchObject({ testimonial: 'The first chart I understood.', testimonialSource: 'https://www.instagram.com/p/x', permission: 'given' })
    expect((await call('people.list', { productId: pid() })).map((p) => p.handle)).toEqual(['@clay', 'u/moon_reader'])

    // Something owed puts a person first; a permission without words is not kept.
    world.clock.advance(60_000)
    const changed = await call('people.save', { productId: pid(), id: a.id, handle: 'u/moon_reader', owed: 'Send the guide', permission: 'given' })
    expect(changed).toMatchObject({ id: a.id, owed: 'Send the guide', permission: 'none', note: '' })
    expect((await call('people.list', { productId: pid() })).map((p) => p.handle)).toEqual(['u/moon_reader', '@clay'])

    await expect(call('people.save', { productId: pid(), handle: ' ' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('people.save', { productId: pid(), handle: 'x', testimonial: 'Good', testimonialSource: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('people.save', { productId: pid(), id: 'nobody', handle: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    expect(await call('people.remove', { id: b.id })).toEqual({ removed: true })
    await expect(call('people.remove', { id: b.id })).rejects.toMatchObject({ code: 'not_found' })
    expect(await call('people.list', { productId: pid() })).toHaveLength(1)
    expect(world.engine.calls).toHaveLength(0)
  })
})
