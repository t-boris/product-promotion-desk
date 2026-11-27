// A post as a carousel or a video (DEC-069).
import { afterEach, describe, expect, it } from 'vitest'
import { readOutline, readWords } from './draft-outline'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const FORM = { title: 'How a chart is built', text: 'A chart is built from your birth date, time and place. See https://natalmystic.test/how.' }
const PARTS = [
  { show: 'A chart starts with three facts', say: 'Your birth date, time and place.' },
  { show: 'The date', say: 'It sets where the Sun was.' },
  { show: 'See how', say: 'https://natalmystic.test/how' }
]

describe('a post as a carousel or a video', () => {
  it('is cut by the AI from the draft, stores nothing, changes no draft and needs no passport', async () => {
    world = makeWorld()
    world.knowledge.version = null
    world.engine.on('draft.outline', JSON.stringify({ parts: PARTS }))
    const count = (): number => (world.core.db.prepare('SELECT COUNT(*) AS n FROM drafts').get() as { n: number }).n
    const before = count()
    expect(await world.core.router.call('drafts.outline', { form: FORM, kind: 'carousel' })).toEqual({ kind: 'carousel', parts: PARTS })
    expect(world.engine.calls.at(-1)!.prompt).toContain('slides of a carousel')
    expect((await world.core.router.call('drafts.outline', { form: FORM, kind: 'video' })).kind).toBe('video')
    expect(world.engine.calls.at(-1)!.prompt).toContain('shots of a short vertical video')
    expect(world.engine.calls.at(-1)!.search).toBeUndefined()
    expect(count()).toBe(before)
    await expect(world.core.router.call('drafts.outline', { form: { title: '', text: ' ' }, kind: 'video' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(world.core.router.call('drafts.outline', { form: FORM, kind: 'film' as never })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('refuses too few parts, an empty part and an address the post does not have', () => {
    world = makeWorld()
    expect(readOutline({ parts: PARTS }, FORM)).toMatchObject({ ok: true })
    expect(readOutline({ parts: PARTS.slice(0, 2) }, FORM)).toMatchObject({ ok: false })
    expect(readOutline({ parts: [...PARTS, { show: ' ', say: 'x' }] }, FORM)).toMatchObject({ ok: false })
    expect(readOutline({ parts: [...PARTS, { show: 'More', say: 'https://elsewhere.test/x' }] }, FORM)).toMatchObject({ ok: false })
    expect(readOutline({ slides: [] }, FORM)).toMatchObject({ ok: false })
  })
})

describe('the topic and the keywords of a post', () => {
  it('are named by the AI from the draft, cleaned of # and repeats, and nothing is stored', async () => {
    world = makeWorld()
    world.knowledge.version = null
    world.engine.on('draft.words', JSON.stringify({ topic: '#Birth charts', keywords: ['how to read a birth chart', 'Birth time unknown', 'birth time unknown', 'natal chart basics'] }))
    expect(await world.core.router.call('drafts.words', { form: FORM })).toEqual({ topic: 'Birth charts', keywords: ['how to read a birth chart', 'Birth time unknown', 'natal chart basics'] })
    expect(world.engine.calls.at(-1)!.search).toBeUndefined()
    await expect(world.core.router.call('drafts.words', { form: { title: '', text: '' } })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(readWords({ topic: 'Charts', keywords: ['one', 'two'] })).toMatchObject({ ok: false })
    expect(readWords({ topic: '', keywords: ['one', 'two', 'three'] })).toMatchObject({ ok: false })
    expect(readWords({ topic: 'Charts', keywords: ['one', 'two', 'https://x.test/a'] })).toMatchObject({ ok: false })
  })
})
