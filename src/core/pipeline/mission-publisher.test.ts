// Publishing through the AI in the account's browser (B1): every gate of the send flow holds with the mission in the middle.
// The mission itself is scripted here (its tools are tested in browser-agent/post-toolbox.test.ts); what is under test is the application's
// side: who may start one, which ticket a submit gets, what counts as published, and what a failure of any kind leaves behind.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api'
import type { Opportunity } from '../../shared/types'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import { TicketError, type SendTicket } from '../ports'
import type { PublishedItem } from '../testing/fake-connector'
import { SendBlockedError, SendGate, type GateGrant } from './gate'
import { contentHash } from './hash'
import { AI_BROWSER_BASIS, MissionPublisher, missionHosts } from './mission-publisher'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  vi.restoreAllMocks()
  await closeWorld(world)
})

const sending = (): SendingFlow => world.sending as SendingFlow
const publishCalls = (): number => world.connector.calls.filter((c) => c === 'publish').length
const actionRow = (id: string) => world.core.db.prepare('SELECT state, error, result_url AS url, result_external_id AS externalId, authorization_basis AS basis FROM send_actions WHERE id = ?').get(id) as { state: string; error: string | null; url: string | null; externalId: string | null; basis: string }

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

function useMissions(script: ScriptedMissions['script']): ScriptedMissions {
  const missions = new ScriptedMissions(script)
  world.core.services.postMissions = missions
  world.core.settings.updateApp({ publishWith: 'ai_browser' })
  return missions
}

/** What the application's submit step does, as far as the send flow can see: lease a ticket, commit, press; the site then shows the text, or not. */
async function press(request: PostMissionRequest, options: { show?: boolean; during?: (ticket: SendTicket) => void } = {}) {
  const content = request.authority.content
  return request.authority.lease(async (lease) => {
    options.during?.(lease.ticket)
    lease.commit()
    if (options.show ?? true) {
      const item: PublishedItem = {
        request: { kind: content.kind, destination: content.destination, parentExternalId: null, title: content.title, text: content.text, link: content.link, attachments: [] },
        ticket: lease.ticket,
        visible: true,
        ref: { url: `${content.destination}#by-the-ai`, externalId: 'ai-pub-1' },
        createdAt: world.core.clock.now().toISOString()
      }
      world.connector.published.push(item)
    }
    return lease.ticket
  })
}

async function blocked(opp: Opportunity): Promise<string> {
  try {
    await sending().send(opp.id)
  } catch (error) {
    if (error instanceof SendBlockedError) return error.block.code
    throw error
  }
  throw new Error('expected the send to be blocked')
}

describe('who carries out a send', () => {
  it('is the connector unless the owner chose the AI browser, and the choice is a closed set', async () => {
    world = makeWorld()
    const missions = new ScriptedMissions(async () => undefined)
    world.core.services.postMissions = missions
    const opp = await world.readyReply()
    expect(world.core.settings.app().publishWith).toBe('connector')

    const action = await sending().send(opp.id)

    expect(action.state).toBe('confirmed')
    expect(publishCalls()).toBe(1)
    expect(missions.requests).toEqual([])
    expect(actionRow(action.id).basis).not.toContain(AI_BROWSER_BASIS)

    await expect(world.core.router.call('app.settings.update', { publishWith: 'robot' as never })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(world.core.settings.app().publishWith).toBe('connector')
    expect((await world.core.router.call('app.settings.update', { publishWith: 'ai_browser' })).publishWith).toBe('ai_browser')
    // Another patch does not touch it.
    expect((await world.core.router.call('app.settings.update', { notifications: false })).publishWith).toBe('ai_browser')
  })

  it('is the connector for an automatic send, for an approval by a rule, for attachments, and when there is no mission service', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const grant = (await new SendGate(world.core, world.store).authorize({ opportunityId: opp.id, automatic: false })) as GateGrant
    const publisher = new MissionPublisher(world.core, new SendGate(world.core, world.store), world.store)

    expect(publisher.executorFor(grant, false)).toBe('connector') // not chosen
    world.core.services.postMissions = new ScriptedMissions(async () => undefined)
    world.core.settings.updateApp({ publishWith: 'ai_browser' })
    expect(publisher.executorFor(grant, false)).toBe('ai_browser')
    expect(publisher.executorFor(grant, true)).toBe('connector')
    expect(publisher.executorFor({ ...grant, approval: { ...grant.approval, approvedBy: 'auto_rule' } }, false)).toBe('connector')
    expect(publisher.executorFor({ ...grant, draft: { ...grant.draft, attachments: [{ name: 'a.png', sha256: 'x', path: '/a.png', mime: 'image/png', size: 1 } as never] } }, false)).toBe('connector')
    world.core.services.postMissions = undefined
    expect(publisher.executorFor(grant, false)).toBe('connector')
  })
})

describe('a mission that goes right', () => {
  it('is started by the send flow for one reserved attempt, holds a ticket bound to exactly the approved content only while it submits, and is confirmed by the application\'s own read-back', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const draft = world.core.repos.latestDraft(opp.id)!
    const destination = world.core.repos.comment(opp.commentId as string).url
    let held: SendTicket | null = null
    let opened = ''
    const missions = useMissions(async (request) => {
      opened = actionRow((world.core.db.prepare("SELECT id FROM send_actions WHERE opportunity_id = ?").get(opp.id) as { id: string }).id).state
      const result = await press(request, {
        during: (ticket) => {
          held = ticket
          world.core.tickets.assertValid(ticket, { accountId: world.account.id, destination, contentHash: contentHash(draft, world.account, destination) })
        }
      })
      expect(result.ok).toBe(true)
      return { reported: { status: 'done', reason: 'The reply shows under the comment.' } }
    })

    const action = await sending().send(opp.id)

    expect(opened).toBe('sending') // the attempt was written before the AI was given the browser
    expect(missions.requests).toHaveLength(1)
    expect(missions.requests[0]).toMatchObject({ accountId: world.account.id, platform: 'fake', hosts: ['fake.test'] })
    expect(missions.requests[0].authority.content).toMatchObject({ kind: 'reply', text: draft.text, destination })
    expect(publishCalls()).toBe(0) // the connector did not publish; the AI browser did
    expect(action.state).toBe('confirmed')
    const row = actionRow(action.id)
    expect(row).toMatchObject({ state: 'confirmed', url: `${destination}#by-the-ai`, externalId: 'ai-pub-1' })
    expect(row.basis).toBe(`user approval ${world.core.repos.activeApproval(draft.id)!.id}; ${AI_BROWSER_BASIS}`)
    expect(world.opportunity(opp.id).state).toBe('confirmed')
    // The ticket of the submit is gone, and the one the gate gave to authorize is gone too.
    expect(() => world.core.tickets.assertValid(held as unknown as SendTicket)).toThrow(TicketError)
    expect(world.connector.calls).toContain('findPublished')
  })

  it('does not take the AI\'s word for a failure either: a press the site shows is a publication', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async (request) => {
      await press(request, { show: true })
      return { reported: { status: 'failed', reason: 'I could not find the post button.' } }
    })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it('a "done" from the AI is not a publication: pressed but not found on the site is unknown, and it blocks a resend', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const missions = useMissions(async (request) => {
      await press(request, { show: false })
      return { reported: { status: 'done', reason: 'Posted. I can see it.' } }
    })

    const action = await sending().send(opp.id)

    expect(action.state).toBe('unknown')
    expect(actionRow(action.id).error).toContain('did not find the text on the site')
    expect(actionRow(action.id).error).toContain('Posted. I can see it.')
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
    // The read-back looked more than once, as a site shows a new comment a moment later.
    expect(world.connector.calls.filter((c) => c === 'findPublished')).toHaveLength(4)
    // No second mission, no connector publish: a resend waits for the platform check.
    expect(await blocked(world.opportunity(opp.id))).toMatch(/./)
    expect(missions.requests).toHaveLength(1)
    expect(publishCalls()).toBe(0)
  })

  it('is unknown, with the reason, when the application cannot read the site back at all', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async (request) => {
      await press(request, { show: true })
    })
    world.connector.findPublishedError = new Error('the site did not answer')
    const action = await sending().send(opp.id)
    expect(action.state).toBe('unknown')
    expect(actionRow(action.id).error).toContain('the site did not answer')
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
  })

  it('does not take a match that belongs to another confirmed send of the account for this one', async () => {
    world = makeWorld()
    const first = await world.readyReply({ text: 'First reply, about charts.' })
    const second = await world.readyReply({ text: 'Second reply, about charts too.', body: 'Another question about charts' })
    let pressed = 0
    useMissions(async (request) => {
      pressed += 1
      await press(request, { show: pressed === 1 })
    })
    const firstAction = await sending().send(first.id)
    expect(firstAction.state).toBe('confirmed')
    // The site's list of the account's own publications still offers the first one, whatever is asked for.
    world.connector.findPublished = async () => ({ url: firstAction.resultUrl as string, externalId: firstAction.resultExternalId as string })

    expect((await sending().send(second.id)).state).toBe('unknown')
  })

  it('keeps going when the engine fails after the press: the site is read and decides', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async (request) => {
      await press(request, { show: true })
      throw new Error('the engine crashed after the press')
    })
    const action = await sending().send(opp.id)
    expect(action.state).toBe('confirmed')
  })
})

describe('the ticket of a submit is bound to exactly this content, account and destination', () => {
  const lend = (make: (grant: GateGrant) => Parameters<typeof world.core.tickets.issue>[0]) =>
    vi.spyOn(SendGate.prototype, 'renewTicket').mockImplementation((grant) => ({ allowed: true, ticket: world.core.tickets.issue(make(grant)) }))

  it.each([
    ['other content', (g: GateGrant) => ({ actionId: g.actionId, contentHash: 'a-hash-of-other-text', accountId: g.account.id, destination: g.request.destination })],
    ['another account', (g: GateGrant) => ({ actionId: g.actionId, contentHash: g.contentHash, accountId: 'another-account', destination: g.request.destination })],
    ['another destination', (g: GateGrant) => ({ actionId: g.actionId, contentHash: g.contentHash, accountId: g.account.id, destination: 'https://fake.test/r/other/comments/zzz/' })]
  ])('refuses a ticket for %s, presses nothing, and the attempt ends as definitely not sent', async (_name, make) => {
    world = makeWorld()
    const opp = await world.readyReply()
    lend(make)
    let used = false
    let result: { ok: boolean; reason?: string } | null = null
    useMissions(async (request) => {
      result = await request.authority.lease(async () => {
        used = true
      })
    })

    const action = await sending().send(opp.id)

    expect(used).toBe(false)
    expect(result).toMatchObject({ ok: false })
    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toContain('Nothing was submitted')
    expect(world.connector.published).toEqual([])
    expect(world.connector.calls).not.toContain('findPublished') // no press, nothing to read back
  })

  it('throws a refused ticket away unused', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const spy = lend((g) => ({ actionId: g.actionId, contentHash: 'other', accountId: g.account.id, destination: g.request.destination }))
    let ticket: SendTicket | null = null
    useMissions(async (request) => {
      await request.authority.lease(async () => undefined)
      ticket = spy.mock.results[0].value.ticket
    })
    await sending().send(opp.id)
    expect(() => world.core.tickets.assertValid(ticket as unknown as SendTicket)).toThrow(TicketError)
  })

  it('gives no second ticket after the control was pressed, and the first is not valid again', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const issue = vi.spyOn(world.core.tickets, 'issue')
    let first: SendTicket | null = null
    let again: { ok: boolean } | null = null
    let reuse: unknown = null
    useMissions(async (request) => {
      const one = await press(request, { show: true })
      first = one.ok ? one.value : null
      const issuedBefore = issue.mock.calls.length
      again = await press(request, { show: true })
      reuse = issue.mock.calls.length - issuedBefore
    })

    await sending().send(opp.id)

    expect(first).not.toBeNull()
    expect(() => world.core.tickets.assertValid(first as unknown as SendTicket)).toThrow(TicketError)
    expect(again).toMatchObject({ ok: false })
    expect(reuse).toBe(0) // the gate was not even asked
    expect(world.connector.published).toHaveLength(1)
  })

  it('presses nothing once the mission is sealed (Stop, the engine ended): no ticket for a new lease, and a lease already given cannot commit', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const issue = vi.spyOn(world.core.tickets, 'issue')
    let commitRefused = ''
    let again: { ok: boolean } | null = null
    let issuedAfterSeal = -1
    useMissions(async (request) => {
      await request.authority.lease(async (lease) => {
        request.authority.seal() // the owner pressed Stop while this submit was typing
        try {
          lease.commit()
        } catch (error) {
          commitRefused = (error as Error).message
        }
      })
      const before = issue.mock.calls.length
      again = await request.authority.lease(async () => undefined)
      issuedAfterSeal = issue.mock.calls.length - before
    })

    const action = await sending().send(opp.id)

    expect(commitRefused).toContain('over')
    expect(again).toMatchObject({ ok: false })
    expect(issuedAfterSeal).toBe(0) // the gate was not even asked
    // Nothing was pressed, so the answer is a definite failure, and it stays one.
    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toContain('Nothing was submitted')
    expect(world.connector.published).toEqual([])
  })

  it('lets a mission press at most once even when the page did not take the first press back (commit is taken back only by the step that knows)', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    let second: { ok: boolean } | null = null
    useMissions(async (request) => {
      await request.authority.lease(async (lease) => {
        lease.commit()
        expect(() => lease.commit()).toThrow()
      })
      second = await request.authority.lease(async () => undefined)
    })
    await sending().send(opp.id)
    expect(second).toMatchObject({ ok: false })
  })
})

describe('a mission never starts, and never presses, without the gate\'s authorization', () => {
  it('does not start for an item the gate blocks', async () => {
    world = makeWorld()
    const missions = useMissions(async () => undefined)
    const opp = await world.newOpportunity()
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'hello' } })
    expect(await blocked(world.opportunity(opp.id))).toBe('not_ready')
    expect(missions.requests).toEqual([])
    expect(publishCalls()).toBe(0)
  })

  it('does not start for an account over its limit, and the mission of an allowed send is not counted against itself', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    const first = await world.readyReply()
    const second = await world.readyReply({ body: 'Another question' })
    const missions = useMissions(async (request) => {
      await press(request, { show: true })
    })

    expect((await sending().send(first.id)).state).toBe('confirmed') // the mission got its ticket although it is the only send of the hour
    expect(await blocked(world.opportunity(second.id))).toBe('limit_hour')
    expect(missions.requests).toHaveLength(1)
  })

  it('refuses the submit when the owner withdrew the approval while the AI worked, and presses nothing', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    let result: { ok: boolean; reason?: string } | null = null
    useMissions(async (request) => {
      // The owner withdrew the approval while the AI was at work.
      world.store.invalidateApprovals(opp.id, 'The owner withdrew the approval.')
      result = await press(request, { show: true })
    })

    const action = await sending().send(opp.id)

    expect(result).toMatchObject({ ok: false })
    expect(action.state).toBe('failed')
    expect(world.connector.published).toEqual([])
    expect(world.opportunity(opp.id).state).not.toBe('confirmed')
  })

  it('refuses the submit when the account would exceed its limit by the time the AI is ready, counting every other send', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    const opp = await world.readyReply()
    const other = await world.readyReply({ body: 'Second question' })
    let result: { ok: boolean; reason?: string } | null = null
    useMissions(async (request) => {
      // Meanwhile another send of the same account went out through the connector's path and used the hour.
      const now = world.core.clock.now().toISOString()
      const draft = world.core.repos.latestDraft(other.id)!
      world.core.db
        .prepare(
          `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, completed_at, authorization_basis)
           VALUES ('rival', ?, ?, ?, 'h', ?, 'https://fake.test/x', 'confirmed', ?, ?, 'user approval')`
        )
        .run(other.id, draft.id, world.core.repos.activeApproval(draft.id)!.id, world.account.id, now, now)
      result = await press(request, { show: true })
    })
    const action = await sending().send(opp.id)
    expect(result).toMatchObject({ ok: false })
    expect(action.state).toBe('failed')
    expect(world.connector.published).toEqual([])
  })

  it('refuses the submit while the owner holds the browser, and presses nothing', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    let result: { ok: boolean; reason?: string } | null = null
    useMissions(async (request) => {
      world.browser.session(world.account).takeControl()
      result = await press(request, { show: true })
    })

    const action = await sending().send(opp.id)

    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('under your control') })
    expect(action.state).toBe('failed')
    expect(world.connector.published).toEqual([])
  })
})

describe('free text of the AI and of the site stays out of the log and the run list', () => {
  const FREE = 'ZZZ-free-text-of-the-ai'
  const everythingLogged = (): string => [...world.core.log.list(500).map((l) => l.message), ...world.core.runs.list({ limit: 50 }).map((r) => r.summary ?? '')].join('\n')

  it.each([
    ['the AI gave a reason for not publishing', async () => ({ reported: { status: 'failed' as const, reason: `${FREE} I could not find the button` } })],
    ['the site showed a warning', async () => ({ warning: `${FREE} you are doing that too much` })],
    ['the page showed a human check', async () => ({ humanCheck: `${FREE} a check frame` })]
  ])('keeps it for the owner and out of the log when %s before any press', async (_name, script) => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(script)

    const action = await sending().send(opp.id)

    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toContain(FREE) // the owner reads it
    expect(actionRow(action.id).error).toContain('Nothing was submitted') // and the application's own wording
    expect(everythingLogged()).not.toContain(FREE)
    expect(everythingLogged()).toContain('not sent') // the send itself is still logged
  })

  it('keeps what the AI said after a press the application could not find out of the log, and the owner still reads it', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async (request) => {
      await press(request, { show: false })
      return { reported: { status: 'done', reason: `${FREE} Posted. I can see it.` } }
    })

    const action = await sending().send(opp.id)

    expect(action.state).toBe('unknown')
    expect(actionRow(action.id).error).toContain(FREE)
    expect(world.opportunity(opp.id).reason).toContain(FREE)
    expect(everythingLogged()).not.toContain(FREE)
    expect(everythingLogged()).toContain('result unknown')
  })

  it('bounds what it keeps for the owner', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async () => ({ reported: { status: 'failed' as const, reason: `${FREE} ${'a very long reason '.repeat(500)}` } }))

    const action = await sending().send(opp.id)

    expect(actionRow(action.id).error).toContain(FREE)
    expect((actionRow(action.id).error ?? '').length).toBeLessThan(700)
  })
})

describe('what a mission that did not press leaves behind', () => {
  it('is a failure with nothing submitted when the AI ends without pressing, however it words it, and the item goes back to review', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async () => ({ reported: { status: 'done', reason: 'Posted it.' } }))

    const action = await sending().send(opp.id)

    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toContain('Posted it.')
    expect(actionRow(action.id).error).toContain('Nothing was submitted')
    expect(world.opportunity(opp.id).state).not.toBe('confirmed')
    expect(world.opportunity(opp.id).state).not.toBe('unknown_result')
    expect(world.core.repos.activeApproval(world.core.repos.latestDraft(opp.id)!.id)).toBeNull() // a new attempt needs a fresh approval
    expect(world.connector.calls).not.toContain('findPublished')
  })

  it.each([
    ['stopped', { ended: 'stopped' as const }, 'You stopped the AI'],
    ['timed out', { ended: 'timeout' as const }, 'did not finish in time'],
    ['failed with an error', { ended: 'error' as const, error: 'the engine fell over' }, 'the engine fell over'],
    ['saw a warning of the site', { warning: "You're doing that too much." }, "You're doing that too much."]
  ])('is a definite failure when the mission %s before any press', async (_name, said, text) => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async () => said)
    const action = await sending().send(opp.id)
    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toContain(text)
    expect(world.connector.published).toEqual([])
  })

  it('suspends the account for a human check the application saw, as for a connector, and keeps the approval', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async () => {
      // The check is in the account's browser: a look at it by the connector afterwards sees it as well.
      world.connector.login = { loggedIn: true, identity: 'brand_account', captcha: true }
      return { humanCheck: 'a visible check frame (recaptcha)', reported: { status: 'needs_owner', reason: 'CAPTCHA' } }
    })

    const action = await sending().send(opp.id)

    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toMatch(/^CAPTCHA required: /)
    expect(world.opportunity(opp.id).state).toBe('ready')
    expect(world.opportunity(opp.id).reason).toContain('CAPTCHA')
    expect(world.core.repos.account(world.account.id).status).toBe('captcha')
    expect(world.core.repos.activeApproval(world.core.repos.latestDraft(opp.id)!.id)).not.toBeNull()
  })

  it('does not start a mission for a signed-out account, a CAPTCHA wall or another identity, and presses nothing', async () => {
    world = makeWorld()
    const missions = useMissions(async () => undefined)
    const opp = await world.readyReply()

    world.connector.login = { loggedIn: false, identity: null, captcha: false }
    expect((await sending().send(opp.id)).state).toBe('failed')
    expect(missions.requests).toEqual([])
    expect((world.core.db.prepare('SELECT error FROM send_actions WHERE opportunity_id = ?').get(opp.id) as { error: string }).error).toMatch(/^Sign-in required: /)
  })

  it('does not start a mission when the browser is signed in as someone else than the approved account', async () => {
    world = makeWorld()
    const missions = useMissions(async () => undefined)
    const opp = await world.readyReply()
    world.connector.login = { loggedIn: true, identity: 'somebody_else', captcha: false }
    const action = await sending().send(opp.id)
    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toContain('somebody_else')
    expect(missions.requests).toEqual([])
  })

  it('keeps the approval and presses nothing when the AI browser cannot be used now, so the owner can simply send again', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    let unavailable = true
    const missions = useMissions(async (request) => {
      if (unavailable) throw new ApiError('engine_unavailable', 'Codex is not signed in.')
      await press(request, { show: true })
    })

    const first = await sending().send(opp.id)

    expect(first.state).toBe('failed')
    expect(actionRow(first.id).error).toContain('Codex is not signed in.')
    expect(world.opportunity(opp.id).state).toBe('ready')
    expect(world.opportunity(opp.id).reason).toContain('press Send to try again')
    expect(world.core.repos.activeApproval(world.core.repos.latestDraft(opp.id)!.id)).not.toBeNull()
    expect(publishCalls()).toBe(0)

    unavailable = false
    const second = await sending().send(opp.id)
    expect(second.state).toBe('confirmed')
    expect(missions.requests).toHaveLength(2)
  })

  it('treats an unexpected error of the mission service before any press as nothing submitted', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async () => {
      throw new Error('something unforeseen')
    })
    const action = await sending().send(opp.id)
    expect(action.state).toBe('failed')
    expect(actionRow(action.id).error).toContain('something unforeseen')
    expect(actionRow(action.id).error).toContain('Nothing was submitted')
  })

  it('treats an unexpected error after a press the site does not show as unknown, not as failed', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    useMissions(async (request) => {
      await press(request, { show: false })
      throw new Error('the engine crashed after the press')
    })
    const action = await sending().send(opp.id)
    expect(action.state).toBe('unknown')
    expect(actionRow(action.id).error).toContain('the engine crashed after the press')
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
  })
})

describe('the hosts a mission may work on', () => {
  it('are the platform of the destination and of the channel, without the decoration of a sub-domain', () => {
    expect(missionHosts('https://www.reddit.com/r/astrology/comments/abc/x/', 'https://old.reddit.com/r/astrology')).toEqual(['reddit.com'])
    expect(missionHosts('https://news.ycombinator.com/item?id=1', 'https://news.ycombinator.com/')).toEqual(['news.ycombinator.com'])
    expect(missionHosts('not an address', 'https://fake.test/r/a')).toEqual(['fake.test'])
    expect(missionHosts()).toEqual([])
  })
})
