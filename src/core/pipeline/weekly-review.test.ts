// The weekly review: the application counts the week, the AI writes the words and one change, the owner answers, and the accepted change is
// given to the AI's drafts of the next two weeks.
import { afterEach, describe, expect, it } from 'vitest'
import { lastFullWeek, shiftWeeks, weekKey, weekStartOf } from '../../shared/weekly-review'
import type { SendingService } from '../services'
import { closeWorld, makeWorld, type World } from './test-fixture'
import { directionInForce, readReview, reviewPrompt, type ReviewInput } from './weekly-review'

let world: World
afterEach(async () => closeWorld(world))

const DAY = 86_400_000
const sending = (): SendingService => world.core.services.sending as SendingService
const call = <M extends 'weekly.get' | 'weekly.prepare' | 'weekly.decide'>(method: M, args: Record<string, unknown>) => world.core.router.call(method, { productId: world.product.id, ...args } as never)

async function sentPost(title: string, numbers?: { likes: number; comments: number }) {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: 'A post of my own.' } })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  const action = await sending().send(opportunity.id)
  expect(action.state).toBe('confirmed')
  if (numbers) world.core.db.prepare('UPDATE send_actions SET likes = ?, comments = ?, numbers_read_at = ? WHERE id = ?').run(numbers.likes, numbers.comments, world.clock.now().toISOString(), action.id)
  return action
}

const ANSWER = JSON.stringify({ worked: ['The story post drew 40 points.'], didNot: ['One post has no numbers yet.'], change: 'Post one more personal story next week.', why: 'The story post drew the most points.' })

/** Moves the clock to the Monday after the week the posts went out in, past the hour the review is due. */
function toNextMonday(): string {
  const start = weekStartOf(world.clock.now())
  world.clock.set(new Date(shiftWeeks(start, 1).getTime() + 10 * 3600_000).toISOString())
  return weekKey(start)
}

describe('the weekly review', () => {
  it('counts the week, asks the AI for the words and one change, and keeps the owner\'s answer', async () => {
    world = makeWorld()
    await sentPost('A story', { likes: 40, comments: 6 })
    await sentPost('A question')
    const week = toNextMonday()

    let view = await call('weekly.get', {})
    expect(view).toMatchObject({ week, ended: true, tooFew: false, words: null, change: null, nextWeek: weekKey(lastFullWeek(world.clock.now()).end) })
    expect(view.numbers.week).toMatchObject({ posts: 2, replies: 0, likes: 40, comments: 6, views: null, read: 1 })
    expect(view.posts.map((p) => p.title)).toEqual(['A story', 'A question'])
    expect(view.channels[world.channel.id]).toMatchObject({ target: world.channel.target })

    world.engine.on('weekly.review', ANSWER)
    view = await call('weekly.prepare', {})
    expect(view.words).toMatchObject({ worked: ['The story post drew 40 points.'], didNot: ['One post has no numbers yet.'] })
    expect(view.change).toMatchObject({ text: 'Post one more personal story next week.', state: 'proposed', byOwner: false })
    const asked = world.engine.calls.at(-1)!.prompt
    expect(asked).toContain('likes or points 40')
    expect(asked).toContain('title: A question')
    // A proposed change steers nothing until the owner accepts it.
    expect(directionInForce(world.core, world.product.id)).toBeNull()

    view = await call('weekly.decide', { week, decision: 'accept' })
    expect(view.change).toMatchObject({ state: 'accepted' })
    expect(directionInForce(world.core, world.product.id)).toBe('Post one more personal story next week.')

    // The AI's next proposed post is given the direction as the owner's.
    world.engine.on('draft.publication', JSON.stringify({ topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: null, rationale: 'from c1', usedClaimIds: ['c1'] }))
    await world.core.router.call('publications.suggest', { channelId: world.channel.id })
    expect(world.engine.calls.at(-1)!.prompt).toContain('"Post one more personal story next week."')

    // Preparing again keeps the owner's decision; two weeks after the week ended the direction is over.
    view = await call('weekly.prepare', { week })
    expect(view.change).toMatchObject({ state: 'accepted', text: 'Post one more personal story next week.' })
    world.clock.advance(14 * DAY)
    expect(directionInForce(world.core, world.product.id)).toBeNull()
    // Once the week after is over, the earlier week says what followed.
    const later = await call('weekly.get', {})
    expect(later.earlier.find((e) => e.week === week)).toMatchObject({ change: 'Post one more personal story next week.', state: 'accepted', followed: { from: { posts: 2, likes: 40 }, to: { posts: 0 } } })
  })

  it('the owner may decline, or write their own change, which is accepted as written', async () => {
    world = makeWorld()
    await sentPost('One')
    await sentPost('Two')
    const week = toNextMonday()
    world.engine.on('weekly.review', ANSWER)
    await call('weekly.prepare', {})
    expect((await call('weekly.decide', { week, decision: 'decline' })).change).toMatchObject({ state: 'declined' })
    expect(directionInForce(world.core, world.product.id)).toBeNull()
    const own = await call('weekly.decide', { week, decision: 'own', text: '  Answer every comment within a day.  ' })
    expect(own.change).toMatchObject({ text: 'Answer every comment within a day.', state: 'accepted', byOwner: true, why: '' })
    expect(own.words).not.toBeNull()
    expect(directionInForce(world.core, world.product.id)).toBe('Answer every comment within a day.')
  })

  it('a week with too little sent is not reviewed by the AI, and a week that is not over is not prepared', async () => {
    world = makeWorld()
    await sentPost('Only one')
    await expect(call('weekly.prepare', { week: weekKey(weekStartOf(world.clock.now())) })).rejects.toMatchObject({ code: 'invalid_input' })
    const week = toNextMonday()
    expect(await call('weekly.get', {})).toMatchObject({ tooFew: true })
    await expect(call('weekly.prepare', {})).rejects.toMatchObject({ code: 'too_few_posts' })
    await expect(call('weekly.decide', { week, decision: 'accept' })).rejects.toMatchObject({ code: 'invalid_input' })
    // Their own change needs no review of the AI.
    expect((await call('weekly.decide', { week, decision: 'own', text: 'Post twice.' })).change).toMatchObject({ state: 'accepted', byOwner: true })
    await expect(call('weekly.get', { week: '2026-11-24' })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(world.engine.calls).toHaveLength(0)
  })

  it('is prepared by the scheduler once, when Monday morning has come', async () => {
    world = makeWorld()
    await sentPost('One')
    await sentPost('Two')
    const weekly = world.core.services.weekly!
    world.engine.on('weekly.review', ANSWER)
    expect(await weekly.prepareDue()).toBe(0)
    toNextMonday()
    world.clock.advance(-2 * 3600_000)
    expect(await weekly.prepareDue()).toBe(0)
    world.clock.advance(2 * 3600_000)
    expect(await weekly.prepareDue()).toBe(1)
    expect(await weekly.prepareDue()).toBe(0)
    expect(world.engine.calls.filter((c) => c.label === 'weekly.review')).toHaveLength(1)
  })

  it('a failed answer is tried once a day, not at every scan', async () => {
    world = makeWorld()
    await sentPost('One')
    await sentPost('Two')
    toNextMonday()
    world.engine.on('weekly.review', 'nonsense')
    const weekly = world.core.services.weekly!
    expect(await weekly.prepareDue()).toBe(0)
    const tries = world.engine.calls.length
    expect(await weekly.prepareDue()).toBe(0)
    expect(world.engine.calls).toHaveLength(tries)
  })
})

describe('an accepted change and the plan of drafts (owner\'s answer of 2026-11-28)', () => {
  const POST = { topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'] }
  const answerWith = (plan: unknown[]): string => JSON.stringify({ worked: ['The story post drew 40 points.'], didNot: [], change: 'Post about the product twice as often here.', why: 'It drew the most points.', plan })
  const mixCard = () => world.core.router.call('mix.get', { channelId: world.channel.id })
  const standalone = (): number => (world.core.db.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE kind = 'standalone' AND state = 'draft'").get() as { n: number }).n

  /** A week with two sent posts, the product's channel preparing a product post every 14 days, and the review asked on Monday. */
  async function reviewed(plan: unknown[]): Promise<string> {
    world = makeWorld({ mode: 'approval' })
    world.setSettings(world.channel.id, { mix: [{ kind: 'product_post', enabled: true, everyDays: 14 }] })
    await sentPost('A story', { likes: 40, comments: 6 })
    await sentPost('A question')
    const week = toNextMonday()
    world.engine.on('weekly.review', answerWith(plan))
    await call('weekly.prepare', {})
    return week
  }

  it('the AI names a channel, a kind and a move; the application keeps the step with the days it decided, and shows it before the press', async () => {
    const week = await reviewed([{ channel: 'placeholder', kind: 'product_post', move: 'more' }])
    // The channel is named in the prompt as the owner sees it, with its plan as set.
    const asked = world.engine.calls.find((c) => c.label === 'weekly.review')!.prompt
    expect(asked).toContain(`${world.channel.target}: product_post every 14 days, own_update off, showcase off`)
    // "placeholder" is no channel of the product: that step is left out, the change stands.
    expect((await call('weekly.get', { week })).change).toMatchObject({ text: 'Post about the product twice as often here.', plan: [] })

    world.engine.on('weekly.review', answerWith([{ channel: world.channel.target, kind: 'product_post', move: 'more' }, { channel: world.channel.target, kind: 'showcase', move: 'pause' }, { channel: world.channel.target, kind: 'own_update', move: 'faster' }]))
    const view = await call('weekly.prepare', { week })
    expect(view.change?.plan).toEqual([{ channelId: world.channel.id, target: world.channel.target, kind: 'product_post', move: 'more', from: { enabled: true, everyDays: 14 }, to: { enabled: true, everyDays: 7 }, applies: true }])
    // Proposed is not in force.
    expect((await mixCard()).kinds.find((k) => k.kind === 'product_post')).toMatchObject({ enabled: true, everyDays: 14, review: null })
  })

  it('accepted, it changes how often the channel\'s drafts are prepared for two weeks, and the owner\'s own setting stays as set', async () => {
    const week = await reviewed([])
    world.engine.on('weekly.review', answerWith([{ channel: world.channel.target, kind: 'product_post', move: 'more' }]))
    await call('weekly.prepare', { week })
    await call('weekly.decide', { week, decision: 'accept' })

    const kind = (await mixCard()).kinds.find((k) => k.kind === 'product_post')
    expect(kind).toMatchObject({ enabled: true, everyDays: 14, review: { enabled: true, everyDays: 7 } })
    expect(world.refresh().settings.mix).toEqual([{ kind: 'product_post', enabled: true, everyDays: 14 }])

    // A first draft is prepared at once; the next one comes after about 7 days, not 14.
    world.engine.on('draft.publication', JSON.stringify(POST))
    expect(await world.core.services.mix!.runDue()).toBe(1)
    world.clock.advance(9 * DAY)
    expect(await world.core.services.mix!.runDue()).toBe(1)
    expect(standalone()).toBe(2)

    // Two weeks after the reviewed week the change is over: the owner's 14 days are back.
    world.clock.advance(6 * DAY)
    expect((await mixCard()).kinds.find((k) => k.kind === 'product_post')).toMatchObject({ everyDays: 14, review: null })
    world.clock.advance(4 * DAY)
    expect(await world.core.services.mix!.runDue()).toBe(0)
  })

  it('a pause prepares no draft while it is in force', async () => {
    const week = await reviewed([])
    world.engine.on('weekly.review', answerWith([{ channel: world.channel.target, kind: 'product_post', move: 'pause' }]))
    await call('weekly.prepare', { week })
    await call('weekly.decide', { week, decision: 'accept' })
    world.engine.on('draft.publication', JSON.stringify(POST))

    expect(await world.core.services.mix!.runDue()).toBe(0)
    expect((await mixCard()).kinds.find((k) => k.kind === 'product_post')).toMatchObject({ enabled: true, review: { enabled: false }, nextAt: null })
  })

  it('the owner\'s later edit of that setting wins at once, and the review says the step is not applied', async () => {
    const week = await reviewed([])
    world.engine.on('weekly.review', answerWith([{ channel: world.channel.target, kind: 'product_post', move: 'pause' }]))
    await call('weekly.prepare', { week })
    await call('weekly.decide', { week, decision: 'accept' })

    world.setSettings(world.channel.id, { mix: [{ kind: 'product_post', enabled: true, everyDays: 10 }] })

    expect((await mixCard()).kinds.find((k) => k.kind === 'product_post')).toMatchObject({ everyDays: 10, review: null })
    expect((await call('weekly.get', { week })).change?.plan).toMatchObject([{ applies: false }])
    world.engine.on('draft.publication', JSON.stringify(POST))
    expect(await world.core.services.mix!.runDue()).toBe(1)
  })

  it('declined, or replaced by the owner\'s own words, it changes no plan', async () => {
    const week = await reviewed([])
    world.engine.on('weekly.review', answerWith([{ channel: world.channel.target, kind: 'product_post', move: 'pause' }]))
    await call('weekly.prepare', { week })
    await call('weekly.decide', { week, decision: 'decline' })
    expect((await mixCard()).kinds.find((k) => k.kind === 'product_post')).toMatchObject({ review: null })

    const own = await call('weekly.decide', { week, decision: 'own', text: 'Answer every comment within a day.' })
    expect(own.change).toMatchObject({ state: 'accepted', byOwner: true, plan: [] })
    expect((await mixCard()).kinds.find((k) => k.kind === 'product_post')).toMatchObject({ review: null })
  })
})

describe('the words of the review', () => {
  const input: ReviewInput = {
    productId: 'p',
    product: { name: 'Natal Mystic', description: '' },
    label: 'Nov 23 – Nov 29',
    numbers: { week: { posts: 1, replies: 0, removed: 0, likes: null, comments: null, views: null, read: 0 }, before: { posts: 0, replies: 0, removed: 0, likes: null, comments: null, views: null, read: 0 }, usual: { posts: null, replies: null, likes: null, comments: null, views: null, removed: null }, channels: [] },
    channelNames: {},
    posts: [],
    lastChange: 'Post twice.',
    drafts: [{ channel: 'r/astrology', kinds: [{ kind: 'product_post', enabled: true, everyDays: 14 }, { kind: 'own_update', enabled: false, everyDays: 7 }, { kind: 'showcase', enabled: false, everyDays: 30 }] }]
  }

  it('the prompt never turns an unread number into a zero and names the change of the week', () => {
    const prompt = reviewPrompt(input).prompt
    expect(prompt).toContain('likes or points not shown (usual not shown)')
    expect(prompt).toContain('The change the owner accepted for this week (data): Post twice.')
  })

  it('an answer without a change is sent back; unsafe points are dropped', () => {
    expect(readReview({ worked: ['x'], didNot: [], change: '', why: '' })).toMatchObject({ ok: false })
    expect(readReview('text')).toMatchObject({ ok: false })
    const read = readReview({ worked: ['Good week.', 7, ''], didNot: 'none', change: 'Post **twice** a week.', why: 'Because.' })
    expect(read).toMatchObject({ ok: true, value: { worked: ['Good week.'], didNot: [], change: 'Post twice a week.', why: 'Because.' } })
  })
})
