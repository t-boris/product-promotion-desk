// "Translate my post" (DEC-065).
import { afterEach, describe, expect, it } from 'vitest'
import { addressesIn, readTranslation } from './draft-translate'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))
const FORM = { title: 'How a chart is built', text: 'A chart is built from **your birth date**. See https://natalmystic.test/how, it helps.' }

describe('translate my post', () => {
  it('puts the title and the text into the chosen language, keeps the addresses, stores nothing and needs no passport', async () => {
    world = makeWorld()
    world.knowledge.version = null
    world.engine.on('draft.translate', JSON.stringify({ title: 'Cómo se construye una carta', text: 'Una carta se construye a partir de **tu fecha de nacimiento**. Mira https://natalmystic.test/how, ayuda.' }))
    const drafts = (): number => (world.core.db.prepare('SELECT COUNT(*) AS n FROM drafts').get() as { n: number }).n
    const before = drafts()
    const out = await world.core.router.call('drafts.translate', { form: FORM, language: 'spanish' })
    expect(out).toEqual({ title: 'Cómo se construye una carta', text: 'Una carta se construye a partir de **tu fecha de nacimiento**. Mira https://natalmystic.test/how, ayuda.' })
    const asked = world.engine.calls.at(-1)!
    expect(asked.prompt).toContain('into Spanish')
    expect(asked.prompt).toContain('your birth date')
    expect(asked.search).toBeUndefined()
    expect(drafts()).toBe(before)
    await expect(world.core.router.call('drafts.translate', { form: FORM, language: 'Klingon' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(world.core.router.call('drafts.translate', { form: { title: ' ', text: '' }, language: 'Spanish' })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('refuses a translation that loses, changes or adds an address, or drops a part', async () => {
    world = makeWorld()
    expect(addressesIn('See https://a.test/x, and (https://b.test/y).')).toEqual(['https://a.test/x', 'https://b.test/y'])
    expect(readTranslation({ title: 'T', text: 'Sin enlace.' }, FORM)).toMatchObject({ ok: false })
    expect(readTranslation({ title: 'T', text: 'Mira https://natalmystic.test/como' }, FORM)).toMatchObject({ ok: false })
    expect(readTranslation({ title: 'T', text: 'Mira https://natalmystic.test/how y https://other.test' }, FORM)).toMatchObject({ ok: false })
    expect(readTranslation({ title: '', text: 'Mira https://natalmystic.test/how' }, FORM)).toMatchObject({ ok: false })
    expect(readTranslation({ title: 'Ignored', text: 'Hola' }, { title: '', text: 'Hello' })).toEqual({ ok: true, value: { title: '', text: 'Hola' } })
    world.engine.on('draft.translate', JSON.stringify({ title: 'T', text: 'Sin enlace.' }))
    await expect(world.core.router.call('drafts.translate', { form: FORM, language: 'Spanish' })).rejects.toMatchObject({ code: 'proposal_failed' })
  })
})
