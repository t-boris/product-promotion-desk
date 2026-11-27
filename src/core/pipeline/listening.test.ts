// Wider listening (DEC-062).
import { afterEach, describe, expect, it } from 'vitest'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const pid = (): string => world.product.id
const call: World['core']['router']['call'] = (method, args) => world.core.router.call(method, args)
const find = (over: Record<string, unknown>) => ({ kind: 'mention', url: 'https://forum.test/t/1', title: 'A thread', term: 'natal chart app', said: 'Someone asks which app to use.', ...over })

describe('wider listening', () => {
  it('keeps the owner\'s terms, looks with one searching request, keeps each address once and only finds that name a watched term', async () => {
    world = makeWorld()
    expect(await call('listening.get', { productId: pid() })).toMatchObject({ productName: world.product.name, phrases: [], competitors: [], finds: [], lookedAt: null, nextAt: null })
    let view = await call('listening.setTerms', { productId: pid(), phrases: [' natal chart app ', 'Natal chart APP', ''], competitors: ['Co-Star'] })
    expect(view).toMatchObject({ phrases: ['natal chart app'], competitors: ['Co-Star'] })
    await expect(call('listening.setTerms', { productId: pid(), phrases: ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'], competitors: [] })).rejects.toMatchObject({ code: 'invalid_input' })

    world.engine.on(
      'listening.look',
      JSON.stringify({
        finds: [
          find({}),
          find({ url: 'https://forum.test/t/1#reply' }),
          find({ kind: 'competitor', url: 'https://blog.test/costar-review', term: 'co-star', said: 'A long review of the app.' }),
          find({ kind: 'competitor', url: 'https://blog.test/other', term: 'natal chart app' }),
          find({ kind: 'place', url: 'https://community.test/astro', term: world.product.name, said: 'A forum where beginners ask about charts.' }),
          find({ url: 'https://x.test/1', term: 'something unwatched' }),
          find({ url: 'javascript:alert(1)' }),
          find({ url: 'https://y.test/1', said: '' })
        ]
      })
    )
    view = await call('listening.look', { productId: pid() })
    const asked = world.engine.calls.at(-1)!
    expect(asked.search).toBe(true)
    expect(asked.prompt).toContain('"Co-Star"')
    expect(asked.prompt).toContain(world.product.name)
    expect(view.finds.map((f) => [f.kind, f.url, f.term, f.fresh])).toEqual([
      ['mention', 'https://forum.test/t/1', 'natal chart app', true],
      ['competitor', 'https://blog.test/costar-review', 'Co-Star', true],
      ['place', 'https://community.test/astro', world.product.name, true]
    ])
    expect(view.lookedAt).not.toBeNull()
    expect(view.lastError).toBeNull()

    // A dismissed address is not offered again; a week later the application looks by itself and only the new address is fresh.
    view = await call('listening.dismiss', { id: view.finds[0]!.id })
    expect(view.finds).toHaveLength(2)
    expect(await world.core.services.listening!.lookDue()).toBe(0)
    world.clock.advance(8 * 86_400_000)
    world.engine.on('listening.look', JSON.stringify({ finds: [find({}), find({ url: 'https://forum.test/t/2', title: '' })] }))
    expect(await world.core.services.listening!.lookDue()).toBe(1)
    view = await call('listening.get', { productId: pid() })
    expect(view.finds.map((f) => [f.url, f.title, f.fresh])).toEqual([
      ['https://forum.test/t/2', 'forum.test', true],
      ['https://blog.test/costar-review', 'A thread', false],
      ['https://community.test/astro', 'A thread', false]
    ])
  })

  it('says why a look did not finish and keeps what was found before; never looks by itself before the owner\'s first look', async () => {
    world = makeWorld()
    expect(await world.core.services.listening!.lookDue()).toBe(0)
    world.engine.on('listening.look', 'no json here')
    await expect(call('listening.look', { productId: pid() })).rejects.toMatchObject({ code: 'proposal_failed' })
    const view = await call('listening.get', { productId: pid() })
    expect(view.running).toBe(false)
    expect(view.lastError).toBeTruthy()
    expect(view.finds).toEqual([])
  })
})
