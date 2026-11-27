// Positioning and the audience's own words (DEC-059).
import { afterEach, describe, expect, it } from 'vitest'
import { FindingStore } from './findings'
import { readPositioning } from './positioning'
import { readWords, type WordsInput } from './audience-words'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))

const ANSWERS = { alternatives: 'Assumption: a free chart site and a paid astrologer.', unique: 'It explains the chart in plain words.', value: 'You understand your chart without learning the craft.', audience: 'Beginners who just got their first chart.', category: 'A natal chart app.' }
const productId = (): string => world.product.id

/** A post the Feed read in full, with comments under it. */
function seed(title: string, comments: string[], own = false): string {
  const url = `https://www.reddit.com/r/x/comments/${title.replace(/\W+/g, '_')}`
  new FindingStore(world.core).addWatched(
    productId(),
    world.channel.id,
    { url, title, author: 'poster', label: 'notice', relation: 'Relates.', about: `About ${title}`, thread: 'People answer.', replyTo: '', comment: '', comments: comments.map((text) => ({ author: 'someone', text, depth: 0, url: '' })), analysis: 'Talk.', topics: [], images: [], own, replies: null, score: null },
    false
  )
  return (world.core.db.prepare('SELECT id FROM findings WHERE external_id = ?').get(url) as { id: string }).id
}

describe('positioning', () => {
  it('is proposed by the AI from the approved passport, approved by the owner as it stands in the form, and given to the AI\'s proposed posts as the angle', async () => {
    world = makeWorld()
    expect(await world.core.router.call('positioning.get', { productId: productId() })).toMatchObject({ approved: null, proposed: null, passportApproved: true })
    world.engine.on('positioning.propose', JSON.stringify(ANSWERS))
    let view = await world.core.router.call('positioning.propose', { productId: productId() })
    expect(view).toMatchObject({ approved: null, proposed: ANSWERS })
    expect(world.engine.calls.at(-1)!.prompt).toContain('Natal Mystic builds a natal chart')

    const edited = { ...ANSWERS, alternatives: '  A free chart site.  ' }
    view = await world.core.router.call('positioning.approve', { productId: productId(), answers: edited })
    expect(view).toMatchObject({ approved: { ...ANSWERS, alternatives: 'A free chart site.' }, proposed: null })

    // A new proposal waits beside what is in force; dismissing it changes nothing approved.
    world.engine.on('positioning.propose', JSON.stringify({ ...ANSWERS, category: 'An astrology app.' }))
    view = await world.core.router.call('positioning.propose', { productId: productId() })
    expect(view.approved?.category).toBe('A natal chart app.')
    expect(view.proposed?.category).toBe('An astrology app.')
    view = await world.core.router.call('positioning.dismiss', { productId: productId() })
    expect(view).toMatchObject({ proposed: null, approved: { category: 'A natal chart app.' } })

    world.engine.on('draft.publication', JSON.stringify({ topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: null, rationale: 'from c1', usedClaimIds: ['c1'] }))
    await world.core.router.call('publications.suggest', { channelId: world.channel.id })
    const prompt = world.engine.calls.at(-1)!.prompt
    expect(prompt).toContain('"audience": "Beginners who just got their first chart."')
    expect(prompt).toContain('It is not a list of facts')
  })

  it('needs an approved passport to propose, and all five answers to approve', async () => {
    world = makeWorld()
    world.knowledge.version = null
    await expect(world.core.router.call('positioning.propose', { productId: productId() })).rejects.toMatchObject({ code: 'no_approved_passport' })
    await expect(world.core.router.call('positioning.approve', { productId: productId(), answers: { ...ANSWERS, value: ' ' } })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(readPositioning({ ...ANSWERS, unique: '' })).toMatchObject({ ok: false })
    expect(readPositioning(ANSWERS)).toMatchObject({ ok: true })
  })
})

describe('the audience\'s own words', () => {
  it('are taken from the read posts once, kept with their posts, merged when said again, and marked when said in three posts', async () => {
    world = makeWorld()
    const a = seed('What does my chart mean', ['I just got my chart and I am lost'])
    const b = seed('Is the birth time needed', ['what if I do not know my birth time?'])
    seed('My own post', ['nice'], true)
    expect(await world.core.router.call('words.list', { productId: productId() })).toMatchObject({ entries: [], collectedAt: null, waiting: 2 })

    world.engine.on('words.collect', JSON.stringify({ entries: [{ existing: null, kind: 'question', text: 'What if I do not know my birth time?', posts: ['p1', 'p2', 'p9'] }, { existing: null, kind: 'phrase', text: 'see u/someone at https://x.test', posts: ['p1'] }, { existing: null, kind: 'objection', text: 'These apps are all the same', posts: [] }] }))
    let view = await world.core.router.call('words.collect', { productId: productId() })
    const asked = world.engine.calls.at(-1)!.prompt
    expect(asked).toContain('comment: what if I do not know my birth time?')
    expect(asked).not.toContain('My own post')
    expect(view.waiting).toBe(0)
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toMatchObject({ kind: 'question', text: 'What if I do not know my birth time?', repeated: false })
    expect(view.entries[0]!.posts.map((p) => p.findingId).sort()).toEqual([a, b].sort())
    await expect(world.core.router.call('words.collect', { productId: productId() })).rejects.toMatchObject({ code: 'nothing_to_read' })

    // A third post says it again: the AI names the kept entry, and it is now worth a post of its own.
    const c = seed('No birth time', ['same question here'])
    world.engine.on('words.collect', JSON.stringify({ entries: [{ existing: 'e1', kind: 'phrase', text: 'ignored', posts: ['p1'] }] }))
    view = await world.core.router.call('words.collect', { productId: productId() })
    expect(world.engine.calls.at(-1)!.prompt).toContain('[e1] question: What if I do not know my birth time?')
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0]).toMatchObject({ repeated: true })
    expect(view.entries[0]!.posts.map((p) => p.findingId)).toContain(c)

    // The AI's proposed posts get the words as vocabulary; "Prepare a post" makes a draft about the entry.
    world.engine.on('draft.publication', JSON.stringify({ topic: 'Birth time', title: 'No birth time?', text: 'A natal chart is built from your birth date, time and place.', link: null, rationale: 'from c1', usedClaimIds: ['c1'] }))
    const card = await world.core.router.call('words.suggestPost', { id: view.entries[0]!.id, channelId: world.channel.id })
    expect(card.opportunity).toMatchObject({ kind: 'standalone', state: 'draft' })
    expect(card.opportunity.reason).toMatch(/From the audience's words/)
    const prompt = world.engine.calls.at(-1)!.prompt
    expect(prompt).toContain('a question people in the audience keep asking')
    expect(prompt).toContain('"audienceWords"')
    expect(world.connector.published).toHaveLength(0)

    // Taken out by the owner, it is gone from the list and from the prompts, and is not offered again as new.
    view = await world.core.router.call('words.remove', { id: view.entries[0]!.id })
    expect(view.entries).toEqual([])
    seed('Again', ['what if I do not know my birth time'])
    world.engine.on('words.collect', JSON.stringify({ entries: [{ existing: null, kind: 'question', text: 'what if i do not know my birth time?', posts: ['p1'] }] }))
    view = await world.core.router.call('words.collect', { productId: productId() })
    expect(view.entries).toEqual([])
  })

  it('reads the answer strictly: unknown posts, links, handles and unknown kinds are dropped', () => {
    const input: WordsInput = { productId: 'p', product: { name: 'N', description: '' }, posts: [{ key: 'p1', id: 'f1', channel: 'c', title: 't', body: '', comments: [] }], existing: [{ key: 'e1', id: 'w1', kind: 'objection', text: 'Too expensive' }] }
    expect(readWords('x', input)).toMatchObject({ ok: false })
    const read = readWords({ entries: [{ existing: 'E1', kind: 'question', text: 'x', posts: ['P1'] }, { kind: 'rumor', text: 'x', posts: ['p1'] }, { kind: 'phrase', text: 'write to @someone', posts: ['p1'] }, { kind: 'phrase', text: 'my big three', posts: ['p1', 'p1'] }] }, input)
    expect(read).toEqual({ ok: true, value: { entries: [{ existingId: 'w1', kind: 'objection', text: 'Too expensive', postIds: ['f1'] }, { existingId: null, kind: 'phrase', text: 'my big three', postIds: ['f1'] }] } })
  })
})
