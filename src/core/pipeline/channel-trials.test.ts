// Channel trials: the terms are written first, the application counts the number, the owner gives the verdict.
import { afterEach, describe, expect, it } from 'vitest'
import type { SendingService } from '../services'
import { PARKED_DETAIL, readProposal } from './channel-trials'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))

const DAY = 86_400_000
const call = <M extends "trials.get" | "trials.start" | "trials.decide" | "trials.propose">(method: M, args: Record<string, unknown> = {}) => world.core.router.call(method, { channelId: world.channel.id, ...args } as never)
const TERMS = { hypothesis: 'Beginners here ask what a chart means.', weeks: 3, hoursPerWeek: 2, metric: 'comments', threshold: 5 }

async function sentPost(title: string, comments: number | null) {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: 'A post of my own.' } })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  const action = await (world.core.services.sending as SendingService).send(opportunity.id)
  if (comments !== null) world.core.db.prepare('UPDATE send_actions SET likes = 1, comments = ?, numbers_read_at = ? WHERE id = ?').run(comments, world.clock.now().toISOString(), action.id)
}
const trialItem = async () => (await world.core.router.call('attention.list', undefined)).find((item) => item.id === `trial:${world.channel.id}`)

describe('a channel trial', () => {
  it('runs for its weeks, counts its number, asks for the verdict in the Inbox when it is over, and keeps the verdict', async () => {
    world = makeWorld()
    expect(await call('trials.get')).toMatchObject({ current: null, past: [], parked: false })
    await sentPost('Before the trial', 9)
    world.clock.advance(60_000)
    let view = await call('trials.start', TERMS)
    expect(view.current).toMatchObject({ trial: { hypothesis: TERMS.hypothesis, weeks: 3, metric: 'comments', threshold: 5, verdict: null }, progress: { posts: 0, measured: null, met: null, ended: false, day: 1, days: 21 } })
    await expect(call('trials.start', TERMS)).rejects.toMatchObject({ code: 'invalid_state' })

    world.clock.advance(2 * DAY)
    await sentPost('In the trial', 4)
    await sentPost('Also in the trial', 3)
    view = await call('trials.get')
    expect(view.current?.progress).toMatchObject({ posts: 2, comments: 7, measured: 7, met: true, ended: false, day: 3 })
    expect(await trialItem()).toBeUndefined()

    world.clock.advance(20 * DAY)
    const item = await trialItem()
    expect(item).toMatchObject({ kind: 'question', refType: 'channel', refId: world.channel.id })
    expect(item?.detail).toContain('7 of 5 comments under your posts')

    view = await call('trials.decide', { verdict: 'keep' })
    expect(view).toMatchObject({ current: null, parked: false, past: [{ trial: { verdict: 'keep', finalMeasured: 7 }, progress: { measured: 7, met: true } }] })
    expect(await trialItem()).toBeUndefined()
    expect(world.core.repos.channel(world.channel.id).status).toBe('active')
    await expect(call('trials.decide', { verdict: 'keep' })).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('"stop" parks the channel and deletes nothing; "extend" adds two weeks and keeps the trial running', async () => {
    world = makeWorld()
    await call('trials.start', TERMS)
    world.clock.advance(22 * DAY)
    let view = await call('trials.decide', { verdict: 'extend' })
    expect(view.current).toMatchObject({ trial: { weeks: 5, verdict: null }, progress: { ended: false } })
    expect(await trialItem()).toBeUndefined()
    view = await call('trials.decide', { verdict: 'stop' })
    expect(view).toMatchObject({ current: null, parked: true, past: [{ trial: { verdict: 'stop', finalMeasured: null } }] })
    expect(world.core.repos.channel(world.channel.id)).toMatchObject({ status: 'paused', statusDetail: PARKED_DETAIL })
    // Resuming is the channel's own button; a new trial may start after it.
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect((await call('trials.get')).parked).toBe(false)
  })

  it('a number only the owner sees is typed with the verdict', async () => {
    world = makeWorld()
    await expect(call('trials.start', { ...TERMS, metric: 'own' })).rejects.toMatchObject({ code: 'invalid_input' })
    await call('trials.start', { ...TERMS, metric: 'own', ownLabel: 'sales in the shop', threshold: 3 })
    await expect(call('trials.decide', { verdict: 'keep' })).rejects.toMatchObject({ code: 'invalid_input' })
    const view = await call('trials.decide', { verdict: 'keep', ownResult: 4 })
    expect(view.past[0]).toMatchObject({ trial: { ownResult: 4, finalMeasured: 4 }, progress: { measured: 4, met: true } })
  })

  it('refuses terms that make no trial', async () => {
    world = makeWorld()
    await expect(call('trials.start', { ...TERMS, hypothesis: '  ' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('trials.start', { ...TERMS, weeks: 5 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('trials.start', { ...TERMS, threshold: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('trials.start', { ...TERMS, hoursPerWeek: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(call('trials.start', { ...TERMS, metric: 'karma' })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('the AI proposes the terms from the channel\'s own numbers and stores nothing', async () => {
    world = makeWorld()
    await sentPost('Earlier', 6)
    world.engine.on('trial.propose', JSON.stringify({ hypothesis: 'Beginners ask about their charts here.', weeks: 4, hoursPerWeek: 3, metric: 'comments', ownLabel: 'x', threshold: 12, why: 'One post drew 6 comments.' }))
    expect(await call('trials.propose')).toEqual({ hypothesis: 'Beginners ask about their charts here.', weeks: 4, hoursPerWeek: 3, metric: 'comments', ownLabel: null, threshold: 12, why: 'One post drew 6 comments.' })
    expect(world.engine.calls.at(-1)!.prompt).toContain('comments 6')
    expect((await call('trials.get')).current).toBeNull()
    expect(readProposal({ hypothesis: 'x', metric: 'views', threshold: 3 }, ['posts', 'own'])).toMatchObject({ ok: false })
    expect(readProposal({ hypothesis: 'A plain one.', metric: 'own', ownLabel: 'sales', threshold: 2.4, weeks: 9, hoursPerWeek: 99 }, ['posts', 'own'])).toMatchObject({ ok: true, value: { weeks: 3, hoursPerWeek: 2, ownLabel: 'sales', threshold: 2 } })
  })
})
