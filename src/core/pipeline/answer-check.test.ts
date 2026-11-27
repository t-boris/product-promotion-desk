// The AI-answer check (DEC-061).
import { afterEach, describe, expect, it } from 'vitest'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const pid = (): string => world.product.id
const call: World['core']['router']['call'] = (method, args) => world.core.router.call(method, args)

describe('the check', () => {
  it('asks each kept question with web search and no word about the product, keeps the answers over time, and is asked again after a month', async () => {
    world = makeWorld()
    expect(await call('answers.get', { productId: pid() })).toMatchObject({ questions: [], shown: null, history: [], nextAt: null, running: false })
    await expect(call('answers.ask', { productId: pid() })).rejects.toMatchObject({ code: 'invalid_state' })

    world.engine.on('answers.questions', JSON.stringify({ questions: ['What is the best natal chart app?', 'How do I read my birth chart?', 'Is a birth time needed for a chart?'] }))
    const proposed = await call('answers.propose', { productId: pid() })
    expect(proposed).toHaveLength(3)
    expect((await call('answers.get', { productId: pid() })).questions).toEqual([])
    let view = await call('answers.setQuestions', { productId: pid(), questions: [...proposed.slice(0, 2), ' '] })
    expect(view.questions).toEqual(proposed.slice(0, 2))
    await expect(call('answers.setQuestions', { productId: pid(), questions: Array.from({ length: 21 }, (_, i) => `q${i}`) })).rejects.toMatchObject({ code: 'invalid_input' })

    world.engine.on('answers.ask', JSON.stringify({ answer: `People often use Co-Star or ${world.product.name}.`, named: ['Co-Star', world.product.name], sources: ['https://www.reddit.com/r/astrology/x'] }))
    view = await call('answers.ask', { productId: pid() })
    const asks = world.engine.calls.filter((c) => c.label === 'answers.ask')
    expect(asks).toHaveLength(2)
    expect(asks[0]!.search).toBe(true)
    expect(asks[0]!.prompt).toContain('What is the best natal chart app?')
    expect(asks[0]!.prompt).not.toContain(world.product.name)
    expect(view.shown).toMatchObject({ asked: 2, named: 2, cited: 0 })
    expect(view.shown!.finishedAt).not.toBeNull()
    expect(view.shown!.results[0]).toMatchObject({ state: 'ok', productNamed: true, productCited: false, named: ['Co-Star', world.product.name] })
    expect(view.history).toHaveLength(1)
    const first = view.shown!.id

    // Not due yet: the monthly job leaves it. A month later it asks again by itself, and the earlier check is still there to open.
    expect(await world.core.services.answers!.askDue()).toBe(0)
    world.clock.advance(31 * 86_400_000)
    world.engine.on('answers.ask', JSON.stringify({ answer: 'People use Co-Star.', named: ['Co-Star'], sources: [] }))
    expect(await world.core.services.answers!.askDue()).toBe(1)
    view = await call('answers.get', { productId: pid() })
    expect(view.history.map((h) => h.named)).toEqual([0, 2])
    expect(view.shown).toMatchObject({ named: 0 })
    expect((await call('answers.get', { productId: pid(), runId: first })).shown).toMatchObject({ id: first, named: 2 })
  })

  it('keeps a question the engine could not answer as failed and goes on', async () => {
    world = makeWorld()
    await call('answers.setQuestions', { productId: pid(), questions: ['one question?', 'another question?'] })
    world.engine.on('answers.ask', 'not json at all')
    const view = await call('answers.ask', { productId: pid() })
    expect(view.shown).toMatchObject({ asked: 0, named: 0 })
    expect(view.shown!.results.map((r) => r.state)).toEqual(['failed', 'failed'])
    expect(view.shown!.results[0]!.error).toBeTruthy()
    expect(view.running).toBe(false)
  })
})
