// Send in the reply window of the Feed: the owner's own text goes under the post, or under one comment of its thread, through the AI in the account's
// browser. The owner's press is the approval, and everything a reply has always had still stands: the gate, the limits, the rule about an unknown result.
// The AI's mission is scripted here (its tools are tested in browser-agent); what is under test is the application's side.

import { afterEach, describe, expect, it } from 'vitest'
import type { FindingSendResult } from '../../shared/api'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import { FindingStore } from './findings'
import { commentFingerprint } from './finding-send'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

/** A mission service whose AI is a script: it gets the request the send flow built, and answers as the service would. */
class ScriptedMissions implements PostMissionService {
  readonly requests: PostMissionRequest[] = []
  constructor(private readonly script: (request: PostMissionRequest) => Promise<Partial<PostMissionOutcome> | void>) {}
  async run(request: PostMissionRequest): Promise<PostMissionOutcome> {
    this.requests.push(request)
    const said = (await this.script(request)) ?? {}
    return { ended: 'finished', committed: request.authority.committed, reported: null, humanCheck: null, warning: null, error: null, ...said }
  }
}

/** The AI presses the control once, as the application's submit step does. */
const presses = async (request: PostMissionRequest): Promise<void> => {
  await request.authority.lease(async (lease) => {
    lease.commit()
    return lease.ticket
  })
}

const POST = 'https://fake.test/@brand/posts/1'
const COMMENT_URL = 'https://fake.test/@brand/posts/1/comment/c1'
const COMMENTS = [
  { author: 'anna', text: 'Try a free chart site', depth: 0, url: COMMENT_URL },
  { author: 'bob', text: 'No address on this one', depth: 0, url: '' },
  { author: 'brand_account', text: 'Our own words', depth: 0, url: 'https://fake.test/@brand/posts/1/comment/own' }
]

/** A world with one channel the app does not read and one post of the Feed that the AI has read in full. */
function setup(script: ScriptedMissions['script'] = presses): { missions: ScriptedMissions; findingId: string } {
  world = makeWorld({ mode: 'approval' })
  world.connector.canRead = false
  world.channel = world.addChannel({ reads: false, mode: 'approval', status: 'active', target: '@brand' })
  const missions = new ScriptedMissions(script)
  world.core.services.postMissions = missions
  const findings = new FindingStore(world.core)
  findings.addWatched(
    world.product.id,
    world.channel.id,
    {
      url: POST,
      title: 'Which app draws a chart?',
      author: 'poster',
      label: 'notice',
      relation: 'Asks for a tool.',
      about: 'The author asks which app draws a natal chart.',
      thread: 'Two people answer.',
      replyTo: '',
      comment: '',
      comments: COMMENTS,
      analysis: '',
      topics: [],
      images: [],
      own: false,
      replies: null,
      score: null
    },
    false
  )
  const findingId = (world.core.db.prepare('SELECT id FROM findings ORDER BY rowid DESC LIMIT 1').get() as { id: string }).id
  return { missions, findingId }
}

const place = (index: number) => ({ position: index, author: COMMENTS[index].author, text: COMMENTS[index].text })
const send = (findingId: string, where: ReturnType<typeof place> | null, text: string): Promise<FindingSendResult> => world.core.router.call('findings.send', { id: findingId, place: where, text })
const opportunities = () => world.core.db.prepare('SELECT * FROM opportunities').all() as Record<string, unknown>[]
const actions = () => world.core.db.prepare('SELECT state, destination FROM send_actions').all() as { state: string; destination: string }[]

describe('Send under a post', () => {
  it('has the AI type the owner\'s exact text at the post, as the owner\'s own approved reply, and leaves the result to the owner', async () => {
    const { missions, findingId } = setup()

    const result = await send(findingId, null, '  Houses split the sky by the time and place of birth.  ')

    expect(missions.requests).toHaveLength(1)
    const content = missions.requests[0].authority.content
    expect(content).toMatchObject({ kind: 'reply', text: 'Houses split the sky by the time and place of birth.', destination: POST })
    // The page cannot be read back, so the application does not say it is there: the owner looks and tells it.
    expect(result).toMatchObject({ state: 'unknown', message: expect.stringMatching(/does not read this channel/) })
    const [opp] = opportunities()
    expect(opp).toMatchObject({ kind: 'reply', source: 'new_post', state: 'unknown_result', finding_id: findingId })
    expect(world.core.db.prepare('SELECT author, approved_by AS by FROM drafts d JOIN approvals a ON a.draft_id = d.id').all()).toEqual([{ author: 'user', by: 'user' }])
    expect(actions()).toEqual([{ state: 'unknown', destination: POST }])
  })

  it('does not ask the platform for the thread, and nothing is published by the connector', async () => {
    const { findingId } = setup()
    await send(findingId, null, 'A comment.')
    expect(world.connector.calls.filter((c) => c === 'fetchThread' || c === 'publish')).toEqual([])
  })

  it('is posted once: a second press after an unknown result is refused with no second mission, and so is the same text under another place', async () => {
    const { missions, findingId } = setup()
    await send(findingId, null, 'The same words.')
    expect(await send(findingId, null, 'The same words.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/already sent/) })
    expect(await send(findingId, null, 'Other words.')).toMatchObject({ state: 'unknown', message: expect.stringMatching(/nobody knows/) })
    expect(await send(findingId, place(0), 'The same words.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/already sent/) })
    expect(missions.requests).toHaveLength(1)
  })

  it('is one mission for two presses made together', async () => {
    const { missions, findingId } = setup()
    const [first, second] = await Promise.all([send(findingId, null, 'Once.'), send(findingId, null, 'Once.')])
    expect([first.state, second.state].sort()).toEqual(['refused', 'unknown'])
    expect(missions.requests).toHaveLength(1)
  })

  it('accepts the owner telling the application that the comment is there, and then shows it as sent', async () => {
    const { findingId } = setup()
    const result = await send(findingId, null, 'A comment.')
    await world.core.router.call('opportunities.resolveUnknown', { id: result.opportunityId as string, outcome: 'published', url: `${POST}#mine` })
    expect(await send(findingId, null, 'Another one.')).toMatchObject({ state: 'sent', message: expect.stringMatching(/already posted/) })
    const replies = await world.core.router.call('findings.replies', { id: findingId })
    expect(replies.places).toEqual([{ position: null, opportunityId: result.opportunityId, state: 'confirmed', reason: '', text: 'A comment.', url: `${POST}#mine` }])
  })

  it('is stopped by the gate as any reply would be: the account\'s browser is under the owner\'s control, the daily limit', async () => {
    const { missions, findingId } = setup()
    world.setSettings(world.channel.id, { limits: { perHour: 0, perDay: 0 } })
    const result = await send(findingId, null, 'A comment.')
    expect(result.state).toBe('held')
    expect(result.message).toMatch(/limit/)
    expect(missions.requests).toHaveLength(0)
    expect(actions()).toEqual([])
  })

  it('says a mission that pressed nothing did not post: the approval is kept for the next press', async () => {
    const { findingId } = setup(async () => ({ ended: 'finished', reported: { status: 'failed', reason: 'The page would not open.' } }))
    const result = await send(findingId, null, 'A comment.')
    expect(result.state).toBe('failed')
    expect(result.message).toMatch(/Nothing was submitted/)
    expect(actions().map((a) => a.state)).toEqual(['failed'])
    // and the owner may press again: the same place takes the text again, no second opportunity is made
    const again = await send(findingId, null, 'A comment.')
    expect(again.state).toBe('failed')
    expect(opportunities()).toHaveLength(1)
  })
})

describe('Send under a comment', () => {
  it('has the AI type at the address of that comment, and quotes the comment to the AI', async () => {
    const { missions, findingId } = setup()
    const result = await send(findingId, place(0), 'Thanks, that helped.')
    expect(missions.requests).toHaveLength(1)
    expect(missions.requests[0].authority.content).toMatchObject({ kind: 'reply', text: 'Thanks, that helped.', destination: COMMENT_URL })
    expect(missions.requests[0].quoted).toContain('anna wrote: Try a free chart site')
    expect(result.state).toBe('unknown')
    expect(opportunities()[0]).toMatchObject({ source: 'comment', finding_id: findingId })
  })

  it('finds the comment by what it says, not by where it stood: the thread was read again and the positions moved', async () => {
    const { findingId } = setup()
    const wanted = { position: 7, author: 'anna', text: 'Try a free chart site' }
    expect(await send(findingId, wanted, 'Thanks.')).toMatchObject({ state: 'unknown' })
    const replies = await world.core.router.call('findings.replies', { id: findingId })
    expect(replies.places).toHaveLength(1)
    expect(replies.places[0].position).toBe(0)
  })

  it('refuses a comment that is not in the thread any more', async () => {
    const { missions, findingId } = setup()
    const result = await send(findingId, { position: 0, author: 'anna', text: 'A comment that was deleted' }, 'Thanks.')
    expect(result).toMatchObject({ state: 'refused', message: expect.stringMatching(/not in the thread any more/) })
    expect(missions.requests).toHaveLength(0)
    expect(opportunities()).toEqual([])
  })

  it('refuses a comment with no address of its own, and the comment of the account itself', async () => {
    const { missions, findingId } = setup()
    expect(await send(findingId, place(1), 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/no address of its own/) })
    expect(await send(findingId, place(2), 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/your own account/) })
    expect(missions.requests).toHaveLength(0)
    expect(opportunities()).toEqual([])
  })

  it('refuses an address on another site: the AI is sent to the channel\'s own site only', async () => {
    const { missions, findingId } = setup()
    world.core.db.prepare("UPDATE finding_comments SET url = 'https://evil.example/c' WHERE author = 'anna'").run()
    expect(await send(findingId, place(0), 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/not on this channel's site/) })
    expect(missions.requests).toHaveLength(0)
  })

  it('treats two comments that read the same as one it cannot tell apart, and says so', async () => {
    const { missions, findingId } = setup()
    new FindingStore(world.core).applyRead(
      findingId,
      {
        url: POST,
        title: 'Which app draws a chart?',
        author: 'poster',
        label: 'notice',
        relation: 'Asks for a tool.',
        about: 'The author asks.',
        thread: '',
        replyTo: '',
        comment: '',
        comments: [COMMENTS[0], { ...COMMENTS[0], url: 'https://fake.test/@brand/posts/1/comment/c2' }],
        analysis: '',
        topics: [],
        images: [],
        own: false,
        replies: null,
        score: null
      },
      world.clock.now().toISOString()
    )
    expect(await send(findingId, place(0), 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/Two comments/) })
    expect(missions.requests).toHaveLength(0)
  })
})

describe('Send refuses before anything is made', () => {
  it('an empty text, and a post the AI has not read', async () => {
    const { missions, findingId } = setup()
    await expect(send(findingId, null, '   ')).rejects.toMatchObject({ code: 'invalid_input' })
    world.core.db.prepare("UPDATE findings SET about = '', read_at = NULL WHERE id = ?").run(findingId)
    expect(await send(findingId, null, 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/has not read this post/) })
    expect(missions.requests).toHaveLength(0)
    expect(opportunities()).toEqual([])
  })

  it('a channel the application reads (its replies are prepared and sent from the Inbox), a paused one, an account that is signed out', async () => {
    const { findingId } = setup()
    world.core.db.prepare('UPDATE channels SET reads = 1 WHERE id = ?').run(world.channel.id)
    expect(await send(findingId, null, 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/Inbox/) })
    world.core.db.prepare('UPDATE channels SET reads = 0, status = ? WHERE id = ?').run('paused', world.channel.id)
    expect(await send(findingId, null, 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/paused/) })
    world.core.db.prepare("UPDATE channels SET status = 'active' WHERE id = ?").run(world.channel.id)
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    expect(await send(findingId, null, 'Hi.')).toMatchObject({ state: 'refused', message: expect.stringMatching(/not available/) })
    expect(opportunities()).toEqual([])
  })

  it('a text that names the product and does not say the author is connected with it: the owner\'s press does not waive the rule', async () => {
    const { missions, findingId } = setup()
    const name = world.core.repos.product(world.product.id).name
    const result = await send(findingId, null, `Try ${name}, it draws charts.`)
    expect(result.state).toBe('refused')
    expect(result.message).toMatch(/connect|disclos|affiliat/i)
    expect(missions.requests).toHaveLength(0)
    // nothing is left behind by a refusal: the opportunity made for it is gone
    expect(opportunities()).toEqual([])
  })

  it('a send when there is no AI browser in the build: the connector never carries it', async () => {
    const { findingId } = setup()
    world.core.services.postMissions = undefined
    const result = await send(findingId, null, 'Hi.')
    expect(result.state).toBe('refused')
    expect(actions()).toEqual([])
    expect(world.connector.calls.filter((c) => c === 'publish')).toEqual([])
  })

  it('is stopped by the gate even when the opportunity was approved while the AI browser was there: the Inbox\'s Send cannot take it to a connector either', async () => {
    const { findingId } = setup()
    const result = await send(findingId, null, 'Hi.')
    expect(result.state).toBe('unknown')
    // a second opportunity of the same kind, approved and ready, then the AI browser goes away
    const other = world.core.db.prepare("SELECT id FROM opportunities").get() as { id: string }
    world.core.db.prepare("UPDATE send_actions SET state = 'failed' WHERE opportunity_id = ?").run(other.id)
    world.core.db.prepare("UPDATE opportunities SET state = 'ready' WHERE id = ?").run(other.id)
    world.core.services.postMissions = undefined
    await expect(world.sending.send(other.id)).rejects.toMatchObject({ block: { code: 'no_ai_browser' } })
    expect(world.connector.calls.filter((c) => c === 'publish')).toEqual([])
  })
})

describe('what was sent from a post', () => {
  it('says the account that speaks and why nothing can be sent now, and lists each place that was answered', async () => {
    const { findingId } = setup()
    const empty = await world.core.router.call('findings.replies', { id: findingId })
    expect(empty).toEqual({ accountLabel: world.account.label, blocked: '', places: [] })
    await send(findingId, place(0), 'Thanks.')
    await send(findingId, null, 'And a general note.')
    const replies = await world.core.router.call('findings.replies', { id: findingId })
    expect(replies.places.map((p) => [p.position, p.state, p.text])).toEqual([
      [0, 'unknown_result', 'Thanks.'],
      [null, 'unknown_result', 'And a general note.']
    ])
    world.core.db.prepare("UPDATE channels SET status = 'paused' WHERE id = ?").run(world.channel.id)
    expect((await world.core.router.call('findings.replies', { id: findingId })).blocked).toMatch(/paused/)
  })

  it('is the same fingerprint for the same words however they are spaced and cased', () => {
    expect(commentFingerprint('Anna', 'Try  a free\nchart site')).toBe(commentFingerprint(' anna ', 'try a free chart site'))
    expect(commentFingerprint('anna', 'a')).not.toBe(commentFingerprint('anna', 'b'))
  })
})
