// SendGate.renewTicket: a fresh single-use ticket for the attempt that is already running (B1). It re-checks what can change while a
// mission works, and it never mints one for anything but the very attempt, approval and content the send was reserved with.

import { afterEach, describe, expect, it } from 'vitest'
import type { Opportunity } from '../../shared/types'
import { TicketError } from '../ports'
import { SendGate, type GateBlock, type GateGrant, type TicketRenewal } from './gate'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const gate = (): SendGate => new SendGate(world.core, world.store)

/** What SendingFlow.reserve does: the attempt row in state 'sending' and the item marked as being sent. */
function reserve(grant: GateGrant): void {
  world.core.db
    .prepare(
      `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, completed_at, result_url, result_external_id, authorization_basis, knowledge_version_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?, NULL, NULL, NULL, ?, ?, NULL)`
    )
    .run(grant.actionId, grant.opportunity.id, grant.draft.id, grant.approval.id, grant.contentHash, grant.account.id, grant.request.destination, world.store.now(), grant.authorizationBasis, grant.draft.knowledgeVersionId)
  world.store.updateOpportunity(grant.opportunity.id, { state: 'sending', reason: '' })
}

async function running(options: { text?: string; channel?: Parameters<World['newOpportunity']>[0] } = {}): Promise<{ grant: GateGrant; opp: Opportunity }> {
  const opp = await world.readyReply({ text: options.text })
  const decision = await gate().authorize({ opportunityId: opp.id, automatic: false })
  if (!decision.allowed) throw new Error(`fixture: the gate refused: ${decision.reasons.join(' ')}`)
  reserve(decision)
  return { grant: decision, opp }
}

const denied = (renewal: TicketRenewal): GateBlock => {
  if (renewal.allowed) throw new Error('expected the renewal to be refused')
  return renewal
}

describe('renewing the ticket of a running attempt', () => {
  it('gives a new ticket bound to the same attempt, content, account and destination, and the old one stays a separate ticket', async () => {
    world = makeWorld()
    const { grant } = await running()

    const renewal = gate().renewTicket(grant, false)

    expect(renewal.allowed).toBe(true)
    if (!renewal.allowed) return
    expect(renewal.ticket.id).not.toBe(grant.ticket.id)
    expect(renewal.ticket).toMatchObject({ actionId: grant.actionId, contentHash: grant.contentHash, accountId: grant.account.id, destination: grant.request.destination })
    expect(() => world.core.tickets.assertValid(renewal.ticket, { contentHash: grant.contentHash, accountId: grant.account.id, destination: grant.request.destination })).not.toThrow()
    // Using up the new ticket does not touch the old one, and the other way round.
    world.core.tickets.revoke(renewal.ticket)
    expect(() => world.core.tickets.assertValid(renewal.ticket)).toThrow(TicketError)
    expect(() => world.core.tickets.assertValid(grant.ticket)).not.toThrow()
  })

  it('does not count the attempt against its own limit, but counts the others', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    const { grant } = await running()
    expect(gate().renewTicket(grant, false).allowed).toBe(true)

    // Another send by the same account in the last hour uses the allowance up.
    const other = await world.readyReply({ text: 'A different answer.' })
    const otherDraft = world.core.repos.latestDraft(other.id)!
    const otherApproval = world.core.repos.activeApproval(otherDraft.id)!
    world.core.db
      .prepare(
        `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis)
         VALUES ('other', ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'x')`
      )
      .run(other.id, otherDraft.id, otherApproval.id, otherApproval.contentHash, grant.account.id, otherApproval.destination, world.store.now())
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ effect: 'hold', code: 'limit_hour' })
  })

  it('refuses when this is not the attempt in progress: it ended, never existed, or another attempt took its place', async () => {
    world = makeWorld()
    const { grant } = await running()
    world.core.db.prepare("UPDATE send_actions SET state = 'failed' WHERE id = ?").run(grant.actionId)
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ code: 'attempt_gone' })

    world.core.db.prepare("UPDATE send_actions SET state = 'confirmed' WHERE id = ?").run(grant.actionId)
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ code: 'attempt_gone' })

    // A grant that was never reserved has no attempt.
    const second = await world.readyReply({ text: 'Another answer.' })
    const unreserved = await gate().authorize({ opportunityId: second.id, automatic: false })
    if (!unreserved.allowed) throw new Error('fixture')
    expect(denied(gate().renewTicket(unreserved, false))).toMatchObject({ code: 'attempt_gone' })

    // A different attempt id does not renew for this grant.
    world = makeWorld()
    const { grant: again } = await running()
    expect(denied(gate().renewTicket({ ...again, actionId: 'some-other-attempt' }, false))).toMatchObject({ code: 'attempt_gone' })
  })

  it('refuses once the approval is withdrawn, replaced or no longer matches what the attempt was authorized with', async () => {
    world = makeWorld()
    const { grant, opp } = await running()
    world.store.invalidateApprovals(opp.id, 'withdrawn')
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ code: 'not_approved' })

    // A new draft with its own approval is a different approval and different content.
    world = makeWorld()
    const second = await running()
    const draft = world.store.insertDraft(second.opp.id, { title: null, text: 'Quite another text.', link: null, attachments: [] }, { knowledgeVersionId: null, usedClaimLineageIds: [], rationale: '', author: 'user' })
    world.store.insertApproval({
      draftId: draft.id,
      contentHash: (await import('./hash')).contentHash(draft, world.account, second.grant.request.destination),
      accountId: world.account.id,
      identity: null,
      destination: second.grant.request.destination,
      approvedBy: 'user',
      ruleId: null
    })
    expect(denied(gate().renewTicket(second.grant, false))).toMatchObject({ effect: 'review', code: 'approval_stale' })
  })

  it('refuses when the signed-in identity changed, the account is not ready, the channel is paused or the owner holds the browser', async () => {
    world = makeWorld()
    const { grant } = await running()
    world.core.db.prepare('UPDATE accounts SET identity = ? WHERE id = ?').run('someone_else', grant.account.id)
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ code: 'identity_changed' })
    world.core.db.prepare('UPDATE accounts SET identity = ? WHERE id = ?').run('brand_account', grant.account.id)
    expect(gate().renewTicket(grant, false).allowed).toBe(true)

    world.core.db.prepare("UPDATE accounts SET status = 'needs_login' WHERE id = ?").run(grant.account.id)
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ code: 'unavailable' })
    world.core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(grant.account.id)

    world.core.db.prepare("UPDATE channels SET status = 'paused' WHERE id = ?").run(grant.channel.id)
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ code: 'unavailable' })
    world.core.db.prepare("UPDATE channels SET status = 'active' WHERE id = ?").run(grant.channel.id)

    world.browser.session(grant.account).takeControl()
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ code: 'unavailable', reasons: [expect.stringContaining('under your control')] })
    world.browser.session(grant.account).releaseControl()
    expect(gate().renewTicket(grant, false).allowed).toBe(true)
  })

  it('applies the disclosure check again, so a change of the product between the approval and the submit cannot carry an undisclosed text out', async () => {
    world = makeWorld()
    const { grant } = await running({ text: 'Thanks for asking! It uses your birth date, time and place.' })
    expect(gate().renewTicket(grant, false).allowed).toBe(true)

    // The product is renamed to a word the approved text happens to use: the text now names it without disclosing the connection.
    world.core.db.prepare('UPDATE products SET name = ? WHERE id = ?').run('birth date', grant.opportunity.productId)
    expect(denied(gate().renewTicket(grant, false))).toMatchObject({ effect: 'review', code: 'disclosure_missing' })
  })

  it('applies the rule for replies approved by the owner: they are never renewed for an automatic send', async () => {
    world = makeWorld()
    const { grant } = await running()
    expect(denied(gate().renewTicket(grant, true))).toMatchObject({ code: 'not_automatic' })
  })
})
