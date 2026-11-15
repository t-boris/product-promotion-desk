// The AI browser's brief for a reply to a new post (DEC-039): it quotes the post the way it quotes a comment, and it is sent to the post's address.

import { afterEach, describe, expect, it } from 'vitest'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

/** A mission service that only remembers what it was asked and does nothing on the site. */
class Recorder implements PostMissionService {
  readonly requests: PostMissionRequest[] = []
  async run(request: PostMissionRequest): Promise<PostMissionOutcome> {
    this.requests.push(request)
    return { ended: 'finished', committed: request.authority.committed, reported: null, humanCheck: null, warning: null, error: null }
  }
}

async function briefFor(opp: { id: string }): Promise<PostMissionRequest> {
  const recorder = new Recorder()
  world.core.services.postMissions = recorder
  world.core.settings.updateApp({ publishWith: 'ai_browser' })
  await (world.sending as SendingFlow).send(opp.id).catch(() => undefined) // nothing is pressed, so the send does not confirm; the brief is what is asked about
  expect(recorder.requests).toHaveLength(1)
  return recorder.requests[0]
}

describe('the brief of a mission that answers a post', () => {
  it('quotes the post: who posted it, its title and how its text begins', async () => {
    world = makeWorld({ mode: 'approval', settings: { topics: ['natal chart'] } })
    world.connector.addDiscussion({ externalId: 'np1', title: 'Which natal chart app is best?', body: 'I want to try one this week.', author: 'curious_user' })
    await world.monitor.runChannel(world.channel.id)
    const [opp] = world.store.list({ channelId: world.channel.id, source: 'new_post' })
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'It builds the chart from your birth date, time and place.' } })
    await world.core.router.call('opportunities.approve', { id: opp.id })

    const brief = await briefFor(opp)

    expect(brief.quoted).toBe('curious_user posted: Which natal chart app is best? I want to try one this week.')
    expect(brief.authority.content).toMatchObject({ kind: 'reply', destination: 'https://fake.test/r/test/comments/np1' })
  })

  it('keeps quoting a comment as it did', async () => {
    world = makeWorld({ mode: 'approval' })
    const opp = await world.readyReply({ body: 'How does the natal chart work?' })
    const brief = await briefFor(opp)
    expect(brief.quoted).toBe('curious_user wrote: How does the natal chart work?')
  })

  it('cuts a very long post, so the brief stays short', async () => {
    world = makeWorld({ mode: 'approval', settings: { topics: ['natal chart'] } })
    world.connector.addDiscussion({ externalId: 'np1', title: 'natal chart', body: 'word '.repeat(500), author: 'curious_user' })
    await world.monitor.runChannel(world.channel.id)
    const [opp] = world.store.list({ channelId: world.channel.id, source: 'new_post' })
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'A reply.' } })
    await world.core.router.call('opportunities.approve', { id: opp.id })
    const brief = await briefFor(opp)
    expect((brief.quoted ?? '').length).toBeLessThanOrEqual('curious_user posted: '.length + 600)
    expect(brief.quoted).toMatch(/…$/)
  })
})
