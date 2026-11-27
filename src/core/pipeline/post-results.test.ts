import { afterEach, describe, expect, it } from 'vitest'
import type { SendingService } from '../services'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => closeWorld(world))

const sending = (): SendingService => world.core.services.sending as SendingService
const minutes = (n: number): void => world.clock.advance(n * 60_000)
const hours = (n: number): void => minutes(n * 60)

/** A post of the owner's own, approved and sent: confirmed with the platform's id. */
async function sentPost(title = 'Hello') {
  const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: 'A post of my own.' } })
  await world.core.router.call('opportunities.approve', { id: opportunity.id })
  const action = await sending().send(opportunity.id)
  expect(action.state).toBe('confirmed')
  return action
}

describe('what the site shows under a sent post', () => {
  it('is read after the first minutes, kept on the post and over time, and read again only when the post\'s age says so', async () => {
    world = makeWorld()
    const action = await sentPost()
    const id = action.resultExternalId as string
    world.connector.postNumbers.set(id, { likes: 3, comments: 1, views: null })
    minutes(5)
    expect(await sending().readPostNumbers()).toBe(0)
    expect(world.connector.numbersRequests).toEqual([])

    minutes(15)
    expect(await sending().readPostNumbers()).toBe(1)
    const first = world.clock.now().toISOString()
    let view = sending().postResults(world.channel.id)
    expect(view).toMatchObject({ readable: true, posts: [{ actionId: action.id, title: 'Hello', numbers: { likes: 3, comments: 1, views: null, readAt: first }, removed: false }] })

    // Half an hour later it is not due; an hour later it is, and the history has both readings.
    minutes(30)
    expect(await sending().readPostNumbers()).toBe(0)
    world.connector.postNumbers.set(id, { likes: 10, comments: 4, views: null })
    minutes(31)
    expect(await sending().readPostNumbers()).toBe(1)
    view = sending().postResults(world.channel.id)
    expect(view.posts[0]!.readings.map((r) => [r.likes, r.comments])).toEqual([[3, 1], [10, 4]])
    expect((await world.core.router.call('opportunities.get', { id: action.opportunityId })).lastAction?.numbers).toMatchObject({ likes: 10, comments: 4 })
  })

  it('reads every due post of a channel in one reading, and a post the site does not list keeps no numbers (never a zero)', async () => {
    world = makeWorld()
    const one = await sentPost('One')
    const two = await sentPost('Two')
    world.connector.postNumbers.set(one.resultExternalId as string, { likes: 7, comments: null, views: 120 })
    minutes(20)
    expect(await sending().readPostNumbers()).toBe(1)
    expect(world.connector.numbersRequests).toHaveLength(1)
    expect(world.connector.numbersRequests[0]!.sort()).toEqual([one.resultExternalId, two.resultExternalId].sort())
    const posts = sending().postResults(world.channel.id).posts
    expect(posts.find((p) => p.actionId === two.id)?.numbers).toBeNull()
    expect(posts.find((p) => p.actionId === one.id)?.numbers).toMatchObject({ likes: 7, comments: null, views: 120 })
    // The post that was not found is not asked again within the hour.
    minutes(10)
    await sending().readPostNumbers()
    expect(world.connector.numbersRequests).toHaveLength(1)
  })

  it('says a failed reading once in the log and tries again at the next time; "Read now" says the failure to the owner', async () => {
    world = makeWorld()
    await sentPost()
    world.connector.numbersError = new Error('Reddit answered 500')
    minutes(20)
    expect(await sending().readPostNumbers()).toBe(0)
    hours(2)
    expect(await sending().readPostNumbers()).toBe(0)
    expect(world.core.log.list(50).filter((l) => /numbers of the posts could not be read/.test(l.message))).toHaveLength(1)
    await expect(world.core.router.call('results.readPosts', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'read_failed' })
    world.connector.numbersError = null
    world.connector.postNumbers.set(sending().postResults(world.channel.id).posts[0]!.actionId, { likes: 1, comments: 0, views: null })
    expect((await world.core.router.call('results.readPosts', { channelId: world.channel.id })).posts).toHaveLength(1)
  })

  it('stops reading a post the site took down and one older than a month, and says when a channel cannot be read at all', async () => {
    world = makeWorld()
    const action = await sentPost()
    world.connector.postNumbers.set(action.resultExternalId as string, { likes: 2, comments: 0, views: null })
    world.core.db.prepare("UPDATE send_actions SET standing = 'removed' WHERE id = ?").run(action.id)
    minutes(20)
    expect(await sending().readPostNumbers()).toBe(0)
    expect(sending().postResults(world.channel.id).posts[0]).toMatchObject({ removed: true, numbers: null })
    world.core.db.prepare('UPDATE send_actions SET standing = NULL WHERE id = ?').run(action.id)
    hours(31 * 24)
    expect(await sending().readPostNumbers()).toBe(0)

    Object.assign(world.connector, { readPostNumbers: undefined })
    expect(sending().postResults(world.channel.id).readable).toBe(false)
    await expect(world.core.router.call('results.readPosts', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
