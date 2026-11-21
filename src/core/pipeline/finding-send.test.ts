// Send in the reply window of the Feed: the owner's own text goes under the post, or under one comment of its thread, through the AI in the account's
// browser. The owner's press is the approval, and everything a reply has always had still stands: the gate, the limits, the rule about an unknown result.
// The AI's mission is scripted here (its tools are tested in browser-agent); what is under test is the application's side.

import { afterEach, describe, expect, it } from 'vitest'
import type { FindingSendResult } from '../../shared/api'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import { FindingStore } from './findings'
import { commentFingerprint } from './finding-send'
import { SCHEDULE_MISSED_REASON } from './sending'
import { scheduledByOwner, sendWays } from './send-ways'
import { closeWorld, makeWorld, verifiedCapabilities, type World } from './test-fixture'
import type { Capability } from '../../shared/types'

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
function setup(script: ScriptedMissions['script'] = presses, capabilities?: Capability[]): { missions: ScriptedMissions; findingId: string } {
  world = makeWorld({ mode: 'approval' })
  world.connector.canRead = false
  world.channel = world.addChannel({ reads: false, mode: 'approval', status: 'active', target: '@brand', capabilities })
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
const send = (findingId: string, where: ReturnType<typeof place> | null, text: string): Promise<FindingSendResult> =>
  world.core.router.call('findings.send', { id: findingId, place: where, text })
const schedule = (findingId: string, where: ReturnType<typeof place> | null, text: string, at: string): Promise<FindingSendResult> =>
  world.core.router.call('findings.schedule', { id: findingId, place: where, text, at })
/** A time this far from now, as the planned time of a comment. */
const inMinutes = (minutes: number): string => new Date(world.clock.now().getTime() + minutes * 60_000).toISOString()
/** A reply of the Inbox, on a channel the application reads: not an answer from the Feed. */
async function inboxReply() {
  world.connector.canRead = true
  return world.readyReply({ channel: world.addChannel({ target: 'r/inbox', status: 'active' }) })
}
/** Replying is something the site itself does not allow this account (it is banned there): the one kind of restriction that can still reach the window. */
const SITE_WORDS = 'This account is banned from r/test.'
const restricted = (status: 'restricted' | 'needs_user' = 'restricted'): Capability[] => verifiedCapabilities().map((c) => (c.key === 'publish_reply' ? { ...c, status, detail: SITE_WORDS } : c))
const approvals = () => world.core.db.prepare('SELECT approved_by AS by, invalidated_at AS invalidated FROM approvals ORDER BY rowid').all() as { by: string; invalidated: string | null }[]
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
    expect(replies.places).toEqual([{ position: null, opportunityId: result.opportunityId, state: 'confirmed', reason: '', text: 'A comment.', url: `${POST}#mine`, scheduledAt: null }])
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

  it('a text that names the product goes out like any other: nothing is asked about the author\'s connection to it', async () => {
    const { missions, findingId } = setup()
    const name = world.core.repos.product(world.product.id).name
    const result = await send(findingId, null, `Try ${name}, it draws charts.`)
    expect(result.state).toBe('unknown')
    expect(result.message).not.toMatch(/connect|disclos|affiliat/i)
    expect(missions.requests).toHaveLength(1)
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

describe('What the site itself does not allow is the only thing that holds a press (DEC-050: no rules text, no "Send anyway")', () => {
  it('holds a comment the site does not allow this account, says so in the capability\'s own words, and keeps the owner\'s approval of exactly that text', async () => {
    const { missions, findingId } = setup(presses, restricted())
    const result = await send(findingId, null, 'A comment.')
    expect(result).toMatchObject({ state: 'held', message: expect.stringContaining(SITE_WORDS) })
    expect(result).not.toHaveProperty('code')
    expect(missions.requests).toHaveLength(0)
    expect(actions()).toEqual([])
    expect(approvals()).toEqual([{ by: 'user', invalidated: null }])
  })

  it('has no way through: pressing again, or asking the same thing another way, holds it again, for a capability that needs the owner too', async () => {
    for (const status of ['restricted', 'needs_user'] as const) {
      const { missions, findingId } = setup(presses, restricted(status))
      const first = await send(findingId, null, 'A comment.')
      expect(first.state).toBe('held')
      // the shared API takes no word that lets it through any more: an extra field is not read
      const second = await world.core.router.call('findings.send', { id: findingId, place: null, text: 'A comment.', anyway: true } as never)
      expect(second.state).toBe('held')
      expect(missions.requests).toHaveLength(0)
    }
  })

  it('goes through once the site lets the account in again: the same approval is sent, nothing else changed', async () => {
    const { missions, findingId } = setup(presses, restricted())
    await send(findingId, null, 'A comment.')
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(JSON.stringify(verifiedCapabilities()), world.channel.id)
    const result = await send(findingId, null, 'A comment.')
    expect(result.state).toBe('unknown')
    expect(missions.requests).toHaveLength(1)
  })

  it('never reads what a community\'s rules say: a channel whose stored record still carries rules words about AI or promotion is judged by its status alone', async () => {
    const { missions, findingId } = setup(presses, verifiedCapabilities().map((c) => (c.key === 'publish_reply' ? { ...c, status: 'needs_check' as const, detail: 'Rules mention promotion: no AI generated content.' } : c)))
    const result = await send(findingId, null, 'A comment.')
    expect(result.state).toBe('unknown')
    expect(missions.requests).toHaveLength(1)
  })
})

describe('Schedule: the owner\'s press made ahead of time', () => {
  it('approves exactly this text and plans it, and nothing goes out now', async () => {
    const { missions, findingId } = setup()
    const at = inMinutes(60)
    const result = await schedule(findingId, null, '  Houses split the sky.  ', at)
    expect(result).toMatchObject({ state: 'scheduled', at, url: '' })
    expect(missions.requests).toHaveLength(0)
    expect(opportunities()).toMatchObject([{ kind: 'reply', state: 'ready', scheduled_at: at, finding_id: findingId }])
    expect(approvals()).toEqual([{ by: 'user', invalidated: null }])
    const replies = await world.core.router.call('findings.replies', { id: findingId })
    expect(replies.places).toMatchObject([{ position: null, state: 'ready', text: 'Houses split the sky.', scheduledAt: at }])
  })

  it('moves the time when it is pressed again, with one opportunity and one approval', async () => {
    const { findingId } = setup()
    await schedule(findingId, null, 'Words.', inMinutes(60))
    const later = inMinutes(180)
    await schedule(findingId, null, 'Words.', later)
    expect(opportunities()).toMatchObject([{ scheduled_at: later }])
    expect(approvals()).toHaveLength(1)
  })

  it('refuses a time that is not one, has passed, or is more than 30 days away, and makes nothing', async () => {
    const { findingId } = setup()
    await expect(schedule(findingId, null, 'Words.', 'nonsense')).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/when/) })
    await expect(schedule(findingId, null, 'Words.', inMinutes(-5))).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/passed/) })
    await expect(schedule(findingId, null, 'Words.', inMinutes(31 * 24 * 60))).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/30 days/) })
    await expect(schedule(findingId, null, '   ', inMinutes(60))).rejects.toMatchObject({ code: 'invalid_input' })
    expect(opportunities()).toEqual([])
  })

  it('is refused by the same checks as a press of Send: a post the AI has not read, and the same text sent before', async () => {
    const { findingId } = setup()
    world.core.db.prepare("UPDATE findings SET about = '', read_at = NULL WHERE id = ?").run(findingId)
    expect(await schedule(findingId, null, 'Words.', inMinutes(60))).toMatchObject({ state: 'refused', message: expect.stringMatching(/has not read/) })
    world.core.db.prepare("UPDATE findings SET about = 'It asks.', read_at = ? WHERE id = ?").run(world.clock.now().toISOString(), findingId)
    await send(findingId, null, 'Words.')
    expect(await schedule(findingId, place(0), 'Words.', inMinutes(60))).toMatchObject({ state: 'refused', message: expect.stringMatching(/already sent/) })
  })

  it('refuses a reply the site does not allow this account at once, says why, and makes nothing', async () => {
    const { findingId } = setup(presses, restricted())
    const result = await schedule(findingId, null, 'Words.', inMinutes(60))
    expect(result).toMatchObject({ state: 'refused', message: expect.stringContaining(SITE_WORDS) })
    expect(result).not.toHaveProperty('code')
    expect(opportunities()).toEqual([])
    expect(approvals()).toEqual([])
  })

  it('is replaced by Send now: the press goes out and the plan is gone, so the comment does not go out a second time', async () => {
    const { missions, findingId } = setup()
    await schedule(findingId, null, 'Words.', inMinutes(60))
    expect((await send(findingId, null, 'Words.')).state).toBe('unknown')
    expect(opportunities()).toMatchObject([{ state: 'unknown_result', scheduled_at: null }])
    world.clock.advance(2 * 60 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(1)
  })

  it('is taken off the schedule by Cancel: the approval is withdrawn and it is a draft again', async () => {
    const { missions, findingId } = setup()
    const { opportunityId } = await schedule(findingId, null, 'Words.', inMinutes(60))
    await world.core.router.call('findings.unschedule', { opportunityId: opportunityId as string })
    expect(opportunities()).toMatchObject([{ state: 'draft', scheduled_at: null }])
    expect(approvals()[0].invalidated).not.toBeNull()
    const replies = await world.core.router.call('findings.replies', { id: findingId })
    expect(replies.places).toMatchObject([{ state: 'draft', scheduledAt: null }])
    world.clock.advance(2 * 60 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(0)
    // there is nothing left to cancel
    await expect(world.core.router.call('findings.unschedule', { opportunityId: opportunityId as string })).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('does not cancel an item that is not an answer from the Feed', async () => {
    setup()
    const opp = await inboxReply()
    await expect(world.core.router.call('findings.unschedule', { opportunityId: opp.id })).rejects.toMatchObject({ code: 'invalid_state' })
  })
})

describe('Edit in full: the text is kept as a draft and nothing is approved or sent', () => {
  it('makes the item of the place with the text as its draft, and no approval', async () => {
    const { missions, findingId } = setup()
    const { opportunityId } = await world.core.router.call('findings.saveDraft', { id: findingId, place: null, text: '  Draft words.  ' })
    expect(opportunities()).toMatchObject([{ id: opportunityId, state: 'draft', finding_id: findingId }])
    expect(world.core.repos.latestDraft(opportunityId)?.text).toBe('Draft words.')
    expect(approvals()).toEqual([])
    expect(missions.requests).toHaveLength(0)
  })

  it('keeps one item for the place, and a later Send takes the text the card kept', async () => {
    const { findingId } = setup()
    const { opportunityId } = await world.core.router.call('findings.saveDraft', { id: findingId, place: null, text: 'First.' })
    await world.core.router.call('opportunities.saveDraft', { id: opportunityId, draft: { text: 'Edited in the full card.' } })
    const again = await world.core.router.call('findings.saveDraft', { id: findingId, place: null, text: 'Edited in the full card.' })
    expect(again.opportunityId).toBe(opportunityId)
    expect(opportunities()).toHaveLength(1)
    expect((await send(findingId, null, 'Edited in the full card.')).state).toBe('unknown')
  })

  it('says why it cannot, as a send would', async () => {
    const { findingId } = setup()
    world.core.db.prepare("UPDATE findings SET about = '', read_at = NULL WHERE id = ?").run(findingId)
    await expect(world.core.router.call('findings.saveDraft', { id: findingId, place: null, text: 'Words.' })).rejects.toMatchObject({ code: 'invalid_state', message: expect.stringMatching(/has not read/) })
  })
})

describe('The scheduler sends the owner\'s scheduled comments from the Feed, and only those', () => {
  it('sends one when its time comes, through the AI browser, with no press', async () => {
    const { missions, findingId } = setup()
    await schedule(findingId, null, 'Scheduled words.', inMinutes(30))
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(0)

    world.clock.advance(31 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(1)
    expect(missions.requests).toHaveLength(1)
    expect(missions.requests[0].authority.content).toMatchObject({ kind: 'reply', text: 'Scheduled words.', destination: POST })
    // the page cannot be read back: the owner is asked, as for a press of Send
    expect(opportunities()).toMatchObject([{ state: 'unknown_result' }])
    expect(actions()).toEqual([{ state: 'unknown', destination: POST }])
    expect(world.connector.calls.filter((c) => c === 'publish')).toEqual([])
  })

  it('sends it under a comment, at the address of that comment', async () => {
    const { missions, findingId } = setup()
    await schedule(findingId, place(0), 'Thanks.', inMinutes(10))
    world.clock.advance(11 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(1)
    expect(missions.requests[0].authority.content).toMatchObject({ destination: COMMENT_URL })
  })

  it('does nothing while automation is paused, and sends once it is not', async () => {
    const { missions, findingId } = setup()
    await schedule(findingId, null, 'Words.', inMinutes(10))
    world.clock.advance(11 * 60_000)
    world.core.settings.setRaw('automation.paused', true)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(0)
    world.core.settings.setRaw('automation.paused', false)
    expect(await world.sending.sendDuePublications()).toBe(1)
    expect(missions.requests).toHaveLength(1)
  })

  it('sends nothing more than an hour late: it goes back to review, the plan is gone and the window does not say "scheduled"', async () => {
    const { missions, findingId } = setup()
    await schedule(findingId, null, 'Words.', inMinutes(10))
    world.clock.advance(80 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(0)
    expect(opportunities()).toMatchObject([{ state: 'awaiting_approval', reason: SCHEDULE_MISSED_REASON, scheduled_at: null }])
    const replies = await world.core.router.call('findings.replies', { id: findingId })
    expect(replies.places).toMatchObject([{ state: 'awaiting_approval', scheduledAt: null }])
    // and it is not sent behind the owner's back later
    world.clock.advance(60 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
  })

  it('does not send one whose text was edited after it was planned: the approval is gone', async () => {
    const { missions, findingId } = setup()
    const { opportunityId } = await schedule(findingId, null, 'Planned words.', inMinutes(10))
    await world.core.router.call('opportunities.saveDraft', { id: opportunityId as string, draft: { text: 'Other words.' } })
    world.clock.advance(11 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(0)
  })

  it('never sends one an automatic rule approved, even with a time on it', async () => {
    const { missions, findingId } = setup()
    const { opportunityId } = await schedule(findingId, null, 'Words.', inMinutes(10))
    world.core.db.prepare("UPDATE approvals SET approved_by = 'auto_rule', rule_id = 'r1'").run()
    world.clock.advance(11 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(0)
    // the gate sent it back to the owner instead: a rule's approval is not the owner's press
    expect(world.opportunity(opportunityId as string).state).toBe('awaiting_approval')
  })

  it('never takes a reply of the Inbox that has a time on it: only the owner\'s answers from the Feed are planned', async () => {
    setup()
    const opp = await inboxReply()
    world.core.db.prepare('UPDATE opportunities SET scheduled_at = ? WHERE id = ?').run(inMinutes(5), opp.id)
    world.clock.advance(10 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(world.connector.calls.filter((c) => c === 'publish')).toEqual([])
  })

  it('does not take a second attempt at the same place: a result nobody knows blocks the next planned send', async () => {
    const { missions, findingId } = setup()
    await send(findingId, null, 'First.')
    await schedule(findingId, null, 'Second.', inMinutes(10))
    world.clock.advance(11 * 60_000)
    expect(await world.sending.sendDuePublications()).toBe(0)
    expect(missions.requests).toHaveLength(1)
  })
})

describe('the one place that says whether a send nobody presses may drive the browser', () => {
  it('lets the AI browser carry it only when the owner scheduled it and the owner approved it', () => {
    setup()
    const ways = (send: { automatic: boolean; approvedBy: string; scheduled?: boolean }) => sendWays(world.core, send, world.channel).aiBrowser
    expect(ways({ automatic: true, approvedBy: 'user', scheduled: true })).toBe(true)
    // a rule's approval, or a send nobody planned, is still never an unattended drive of the browser
    expect(ways({ automatic: true, approvedBy: 'auto_rule', scheduled: true })).toBe(false)
    expect(ways({ automatic: true, approvedBy: 'user' })).toBe(false)
    expect(ways({ automatic: true, approvedBy: 'user', scheduled: false })).toBe(false)
    // and the owner's own press is what it always was
    expect(ways({ automatic: false, approvedBy: 'user' })).toBe(true)
    expect(ways({ automatic: false, approvedBy: 'auto_rule' })).toBe(false)
  })

  it('counts an item as planned by the owner only when it is an answer from the Feed and has a time', () => {
    expect(scheduledByOwner({ findingId: 'f1', scheduledAt: '2026-11-21T19:00:00.000Z' })).toBe(true)
    expect(scheduledByOwner({ findingId: 'f1', scheduledAt: null })).toBe(false)
    // a post of the owner's has a time too, and keeps the rule that a scheduled post never drives a browser
    expect(scheduledByOwner({ findingId: null, scheduledAt: '2026-11-21T19:00:00.000Z' })).toBe(false)
  })
})

describe('No card of the Feed\'s answers is left to decide anywhere', () => {
  const DECIDE = ['draft', 'awaiting_approval', 'ready', 'needs_user'] as const

  it('keeps an answer from a post out of the list to decide, the Inbox, and the counts of what waits; it is in the reply window of its post', async () => {
    const { findingId } = setup(presses, restricted())
    // a held send leaves an approved item behind, and a draft kept by "Edit in full" another
    await send(findingId, null, 'Held words.')
    await world.core.router.call('findings.saveDraft', { id: findingId, place: place(0), text: 'Kept words.' })
    expect(opportunities()).toHaveLength(2)
    // a reply of the Inbox on a channel the application reads waits as it always did
    const inbox = await inboxReply()
    const productId = world.product.id

    const all = await world.core.router.call('opportunities.list', { productId, kind: 'reply', states: [...DECIDE] })
    expect(all).toHaveLength(3)
    const decide = await world.core.router.call('opportunities.list', { productId, kind: 'reply', states: [...DECIDE], withoutFeedAnswers: true })
    expect(decide.map((card) => card.opportunity.id)).toEqual([inbox.id])

    const attention = await world.core.router.call('attention.list', undefined)
    expect(attention.filter((item) => item.refType === 'opportunity').map((item) => item.refId)).toEqual([inbox.id])

    const overview = await world.core.router.call('overview.get', { productId, days: 7 })
    expect(overview.channels.find((c) => c.channelId === world.channel.id)?.waiting).toBe(0)
    expect(overview.channels.find((c) => c.channelId === inbox.channelId)?.waiting).toBe(1)

    const replies = await world.core.router.call('findings.replies', { id: findingId })
    expect(replies.places).toMatchObject([{ position: null, state: 'ready', text: 'Held words.' }, { position: 0, state: 'draft', text: 'Kept words.' }])
  })
})
