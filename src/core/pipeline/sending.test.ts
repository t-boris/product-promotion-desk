import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CapabilityKey, Opportunity } from '../../shared/types'
import { TakeoverError, TicketError, type PublishRequest } from '../ports'
import { SendBlockedError, SendGate, type GateBlock } from './gate'
import { contentHash } from './hash'
import { NOT_FOUND_REASON, UNKNOWN_WAIT_MS, type SendingFlow } from './sending'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const sending = (): SendingFlow => world.sending as SendingFlow
const publishCalls = (): number => world.connector.calls.filter((c) => c === 'publish').length
const commentOf = (opp: Opportunity) => world.core.repos.comment(opp.commentId as string)

async function gateDecision(opp: Opportunity, automatic = false) {
  return new SendGate(world.core, world.store).authorize({ opportunityId: opp.id, automatic })
}

async function sendBlocked(opp: Opportunity, automatic = false): Promise<GateBlock> {
  try {
    await sending().send(opp.id, { automatic })
  } catch (error) {
    if (error instanceof SendBlockedError) return error.block
    throw error
  }
  throw new Error('expected the send to be blocked')
}

function pngFile(name = 'shot.png'): string {
  const path = join(mkdtempSync(join(tmpdir(), 'ppd-img-')), name)
  writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]))
  return path
}

describe('SendGate (a): approval is bound to the exact content, account and destination (REQ-004 criterion 1)', () => {
  it('allows a user-approved reply and issues a ticket for exactly this content, account and destination', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const decision = await gateDecision(opp)
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    const draft = world.core.repos.latestDraft(opp.id)!
    expect(decision.ticket.contentHash).toBe(contentHash(draft, world.account, commentOf(opp).url))
    expect(decision.ticket.accountId).toBe(world.account.id)
    expect(decision.ticket.destination).toBe(commentOf(opp).url)
    expect(decision.authorizationBasis).toMatch(/^user approval /)
  })

  it('blocks an item that was never approved', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'hello' } })
    const block = await sendBlocked(world.opportunity(opp.id))
    expect(block.code).toBe('not_ready')
    expect(publishCalls()).toBe(0)
  })

  it('invalidates the approval when the owner edits the draft, and the edit cannot be sent until approved again', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const approval = world.core.repos.activeApproval(world.core.repos.latestDraft(opp.id)!.id)!

    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'Edited text after approval' } })

    const invalidated = world.core.db.prepare('SELECT invalidated_at, invalid_reason FROM approvals WHERE id = ?').get(approval.id) as { invalidated_at: string | null; invalid_reason: string }
    expect(invalidated.invalidated_at).not.toBeNull()
    expect(invalidated.invalid_reason).toMatch(/edited/)
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('not_ready')

    await world.core.router.call('opportunities.approve', { id: opp.id })
    const action = await sending().send(opp.id)
    expect(action.state).toBe('confirmed')
    expect(world.connector.published[0].request.text).toBe('Edited text after approval')
  })

  // Any change to what was approved - even one made behind the application's back - changes the hash.
  const tamper: [string, (w: World, opp: Opportunity) => void][] = [
    ['text', (w, o) => w.core.db.prepare('UPDATE drafts SET text = ? WHERE opportunity_id = ?').run('sneaky different text', o.id)],
    ['title', (w, o) => w.core.db.prepare('UPDATE drafts SET title = ? WHERE opportunity_id = ?').run('A title', o.id)],
    ['link', (w, o) => w.core.db.prepare('UPDATE drafts SET link = ? WHERE opportunity_id = ?').run('https://natalmystic.com/x', o.id)],
    ['attachments', (w, o) => w.core.db.prepare('UPDATE drafts SET attachments_json = ? WHERE opportunity_id = ?').run(JSON.stringify([{ name: 'a.png', path: '/tmp/a.png', mime: 'image/png', sha256: 'abc' }]), o.id)],
    ['destination', (w, o) => w.core.db.prepare('UPDATE comments SET url = ? WHERE id = ?').run('https://fake.test/somewhere/else', o.commentId)],
    ['account', (w) => w.core.db.prepare('UPDATE channels SET account_id = ? WHERE id = ?').run(w.addAccount({ label: 'Other', identity: 'other_acc' }).id, w.channel.id)]
  ]
  it.each(tamper)('refuses to send when the %s no longer matches the approval', async (_name, change) => {
    world = makeWorld()
    const opp = await world.readyReply()
    change(world, opp)

    const block = await sendBlocked(opp)

    expect(block.code).toBe('approval_stale')
    expect(block.effect).toBe('review')
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(world.card(opp.id).approval).toBeNull()
  })

  it('refuses an attachment whose file changed on disk after approval', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    const path = pngFile()
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'See the screenshot', attachments: [{ name: 'shot.png', path, mime: 'image/png', sha256: 'lies' }] } })
    await world.core.router.call('opportunities.approve', { id: opp.id })
    writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('replaced body')]))

    const block = await sendBlocked(opp)

    expect(block.code).toBe('attachment_changed')
    expect(publishCalls()).toBe(0)
  })

  it('refuses an automatic approval on a channel that is not in automatic mode', async () => {
    world = makeWorld({ mode: 'approval' })
    const opp = await world.newOpportunity()
    world.core.db.prepare("UPDATE opportunities SET category = 'thanks' WHERE id = ?").run(opp.id)
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'Thank you!' } })
    const draft = world.core.repos.latestDraft(opp.id)!
    world.store.insertApproval({ draftId: draft.id, contentHash: contentHash(draft, world.account, commentOf(opp).url), accountId: world.account.id, identity: world.account.identity, destination: commentOf(opp).url, approvedBy: 'auto_rule', ruleId: 'auto:thanks:v1' })
    world.store.updateOpportunity(opp.id, { state: 'ready' })

    const block = await sendBlocked(world.opportunity(opp.id), true)

    expect(block.code).toBe('auto_rule_refused')
    expect(publishCalls()).toBe(0)
  })

  it('refuses an automatic approval for a standalone publication, whatever the channel mode', async () => {
    world = makeWorld({ mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } })
    const created = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello', text: 'A post' } })
    const opp = created.opportunity
    const draft = world.core.repos.latestDraft(opp.id)!
    world.store.insertApproval({ draftId: draft.id, contentHash: contentHash(draft, world.account, world.channel.url), accountId: world.account.id, identity: world.account.identity, destination: world.channel.url, approvedBy: 'auto_rule', ruleId: 'auto:thanks:v1' })
    world.store.updateOpportunity(opp.id, { state: 'ready' })

    const block = await sendBlocked(world.opportunity(opp.id), true)

    expect(block.code).toBe('auto_rule_refused')
    expect(block.reasons.join(' ')).toMatch(/Standalone/)
    expect(publishCalls()).toBe(0)
  })
})

describe('SendGate (b): availability, permissions and pause', () => {
  it('blocks when the account is not ready', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    const block = await sendBlocked(opp)
    expect(block.code).toBe('unavailable')
    expect(block.reasons.join(' ')).toMatch(/not available/)
    expect(world.opportunity(opp.id).state).toBe('ready')
  })

  it('blocks when the channel is paused', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: true })
    expect((await sendBlocked(opp)).reasons.join(' ')).toMatch(/paused/)
    await world.core.router.call('channels.setPaused', { channelId: world.channel.id, paused: false })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it.each<['unavailable' | 'restricted' | 'needs_user']>([['unavailable'], ['restricted'], ['needs_user']])('blocks when publishing replies is %s', async (status) => {
    world = makeWorld()
    const opp = await world.readyReply()
    const capabilities = world.channel.capabilities.map((c) => (c.key === ('publish_reply' as CapabilityKey) ? { ...c, status, detail: 'by rules' } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(JSON.stringify(capabilities), world.channel.id)
    const block = await sendBlocked(opp)
    expect(block.code).toBe('unavailable')
    expect(block.reasons.join(' ')).toMatch(/by rules/)
  })

  it('blocks automatic sends while automation is paused but still allows an explicit send by the owner', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.core.settings.setRaw('automation.paused', true)

    const standalone = (await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'Body' } })).opportunity
    await world.core.router.call('opportunities.approve', { id: standalone.id })
    const block = await sendBlocked(world.opportunity(standalone.id), true)
    expect(block.reasons.join(' ')).toMatch(/Automation is paused/)

    // The owner pressing Send is an explicit action and is not blocked by the pause.
    const action = await sending().send(opp.id)
    expect(action.state).toBe('confirmed')
  })

  it('blocks while the owner controls the account browser', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.browser.session(world.account).takeControl()
    const block = await sendBlocked(opp)
    expect(block.reasons.join(' ')).toMatch(/under your control/)
    expect(publishCalls()).toBe(0)
  })
})

describe('SendGate (c): the live thread (REQ-004 criterion 2)', () => {
  it('cancels the send and says why when the owner already replied by hand', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.addComment('d1', { externalId: 'manual', parentExternalId: commentOf(opp).externalId, author: 'Brand_Account', body: 'I answered this myself' })

    const block = await sendBlocked(opp)

    expect(block.code).toBe('already_replied')
    expect(block.effect).toBe('cancel')
    expect(publishCalls()).toBe(0)
    const after = world.opportunity(opp.id)
    expect(after.state).toBe('cancelled')
    expect(after.reason).toMatch(/already replied/)
    expect(world.card(opp.id).approval).toBeNull()
  })

  it('also detects an own reply that is already stored from an earlier read', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.addComment('d1', { externalId: 'manual', parentExternalId: commentOf(opp).externalId, author: 'brand_account' })
    await world.monitor.runChannel(world.channel.id)
    world.connector.fetchThreadError = null
    expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('already_replied')
  })

  it('returns the item to review when the comment changed, storing the new text for the owner', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.editComment('d1', commentOf(opp).externalId, 'I changed my mind: what about pricing?')

    const block = await sendBlocked(opp)

    expect(block.code).toBe('comment_changed')
    expect(block.effect).toBe('review')
    expect(publishCalls()).toBe(0)
    const card = world.card(opp.id)
    expect(card.opportunity.state).toBe('awaiting_approval')
    expect(card.comment?.body).toBe('I changed my mind: what about pricing?')
    expect(card.approval).toBeNull()

    // After a fresh review the owner can approve and send against the new text.
    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it('cancels when the comment was removed, the discussion is gone, or the thread is locked', async () => {
    world = makeWorld()
    const removed = await world.readyReply()
    world.connector.removeComment('d1', commentOf(removed).externalId)
    expect((await sendBlocked(removed)).code).toBe('comment_gone')
    expect(world.opportunity(removed.id).state).toBe('cancelled')

    const locked = await world.readyReply()
    world.connector.lock('d1')
    expect((await sendBlocked(locked)).code).toBe('thread_locked')
    expect(world.opportunity(locked.id).reason).toMatch(/locked/)
  })

  it('cancels when the discussion disappeared from the platform', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.discussions = []
    expect((await sendBlocked(opp)).code).toBe('thread_unavailable')
  })

  it('does not send when the thread cannot be read, because its state cannot be verified', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.fetchThreadError = new Error('network down')
    const block = await sendBlocked(opp)
    expect(block.code).toBe('thread_unreadable')
    expect(block.effect).toBe('hold')
    expect(world.opportunity(opp.id).state).toBe('ready')
    expect(publishCalls()).toBe(0)
  })
})

describe('SendGate (d): limits are aggregated per account across channels (REQ-004 criterion 5)', () => {
  it("counts sends from the account's other channels against this channel's hourly limit", async () => {
    world = makeWorld({ settings: { limits: { perHour: 2, perDay: 20 } } })
    const second = world.addChannel({ target: 'r/second' })

    // Two sends through the first channel use up the account's hourly allowance...
    for (let i = 0; i < 2; i++) {
      const opp = await world.readyReply()
      expect((await sending().send(opp.id)).state).toBe('confirmed')
    }
    // ...so the second channel, which has not sent anything itself, is blocked too.
    const other = await world.readyReply({ channel: second })
    const block = await sendBlocked(other)

    expect(block.code).toBe('limit_hour')
    expect(block.reasons.join(' ')).toMatch(/2 send\(s\) across all its channels/)
    expect(publishCalls()).toBe(2)
  })

  it('applies the daily limit once the hourly window has passed', async () => {
    world = makeWorld({ settings: { limits: { perHour: 2, perDay: 3 } } })
    for (let i = 0; i < 2; i++) await sending().send((await world.readyReply()).id)
    world.clock.advance(61 * 60_000)
    await sending().send((await world.readyReply()).id)

    world.clock.advance(61 * 60_000)
    const blocked = await sendBlocked(await world.readyReply())

    expect(blocked.code).toBe('limit_day')
    world.clock.advance(23 * 60 * 60_000)
    expect((await sending().send(world.core.db.prepare("SELECT id FROM opportunities WHERE state = 'ready'").pluck().get() as string)).state).toBe('confirmed')
  })

  it('does not count attempts that definitely failed', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    world.connector.publishScript.push({ kind: 'fail', error: 'rejected by the site' })
    const first = await world.readyReply()
    expect((await sending().send(first.id)).state).toBe('failed')

    const second = await world.readyReply()
    expect((await sending().send(second.id)).state).toBe('confirmed')
  })

  it('counts unknown results, because they may have been published', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    world.connector.publishScript.push({ kind: 'unknown' })
    expect((await sending().send((await world.readyReply()).id)).state).toBe('unknown')
    expect((await sendBlocked(await world.readyReply())).code).toBe('limit_hour')
  })
})

describe('confirmed send (REQ-004 criterion 4, REQ-006 criterion 11)', () => {
  it('records link, platform id, time, authorization basis and knowledge version, verifies capabilities, and logs the run', async () => {
    world = makeWorld()
    const verified: [string, string][] = []
    world.core.services.channels = { markCapabilityVerified: (_id, key) => void verified.push([_id, key]) }
    const opp = await world.newOpportunity()
    // An AI-style draft carries the knowledge version it was prepared from.
    world.store.insertDraft(opp.id, { title: null, text: 'It builds a chart from your birth data.', link: null, attachments: [] }, { knowledgeVersionId: 'pv-7', usedClaimLineageIds: ['lin-c1'], rationale: 'from c1', author: 'ai' })
    world.store.updateOpportunity(opp.id, { state: 'awaiting_approval' })
    await world.core.router.call('opportunities.approve', { id: opp.id })
    const approval = world.card(opp.id).approval!

    const action = await sending().send(opp.id)

    expect(action.state).toBe('confirmed')
    expect(action.resultUrl).toMatch(/#published-1$/)
    expect(action.resultExternalId).toBe('fake-pub-1')
    expect(action.completedAt).toBe(world.clock.now().toISOString())
    expect(action.attemptedAt).toBe(world.clock.now().toISOString())
    expect(action.authorizationBasis).toBe(`user approval ${approval.id}`)
    expect(action.knowledgeVersionId).toBe('pv-7')
    expect(action.destination).toBe(commentOf(opp).url)
    expect(action.contentHash).toBe(approval.contentHash)
    expect(world.opportunity(opp.id).state).toBe('confirmed')
    expect(verified.map((v) => v[1])).toEqual(['publish_reply', 'verify_send'])
    const run = world.core.runs.list().find((r) => r.kind === 'send')!
    expect(run.status).toBe('ok')
    expect(run.summary).toMatch(/Reply sent/)
  })

  it('performs the publication through the browser session with the issued ticket, and revokes the ticket afterwards', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await sending().send(opp.id)

    const { ticket } = world.connector.published[0]
    expect(world.browser.page(world.account.id).log.some((l) => l.startsWith('fill #fake-text'))).toBe(true)
    expect(() => world.core.tickets.assertValid(ticket)).toThrow(TicketError)
  })

  it('refuses a second send of an item that was already sent', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await sending().send(opp.id)
    const block = await sendBlocked(opp)
    expect(block.code).toBe('already_sent')
    expect(publishCalls()).toBe(1)
  })

  it('lets a connector act only with a genuine ticket for the right account', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const { connector, ctx } = world.core.connectorContext(world.channel.id)
    const request: PublishRequest = { kind: 'reply', destination: commentOf(opp).url, parentExternalId: null, title: null, text: 'x', link: null, attachments: [] }
    const forged = { id: 'x', actionId: 'a', contentHash: 'h', accountId: world.account.id, destination: request.destination, expiresAt: Date.now() + 1000, signature: 'ab'.repeat(32) }
    await expect(connector.publish(ctx, forged, request)).rejects.toBeInstanceOf(TicketError)
    expect(world.connector.published).toHaveLength(0)
  })
})

describe('failed and unknown results (REQ-004 criterion 3, REQ-005 criterion 10)', () => {
  it('returns a definitely failed send to review with the error, and needs a fresh approval to retry', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'fail', error: 'Rate limit exceeded' })
    const opp = await world.readyReply()

    const action = await sending().send(opp.id)

    expect(action.state).toBe('failed')
    expect(action.error).toBe('Rate limit exceeded')
    const after = world.opportunity(opp.id)
    expect(after.state).toBe('awaiting_approval')
    expect(after.reason).toMatch(/Rate limit exceeded/)
    expect((await sendBlocked(after)).code).toBe('not_ready')

    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
    const rows = world.core.db.prepare('SELECT state FROM send_actions ORDER BY rowid').all() as { state: string }[]
    expect(rows.map((r) => r.state)).toEqual(['failed', 'confirmed'])
  })

  it('treats a rejected ticket as definitely not sent', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'throw', error: new TicketError('forged') })
    const opp = await world.readyReply()
    expect((await sending().send(opp.id)).state).toBe('failed')
  })

  it('marks an unconfirmed submission as unknown and blocks every further attempt', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown', error: 'The page did not show a result' })
    const opp = await world.readyReply()

    const action = await sending().send(opp.id)

    expect(action.state).toBe('unknown')
    expect(action.completedAt).toBeNull()
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
    const block = await sendBlocked(world.opportunity(opp.id))
    expect(block.code).toBe('unknown_pending')
    expect(block.reasons.join(' ')).toMatch(/reconciled/)
    expect(publishCalls()).toBe(1)
  })

  it('treats ANY exception from the connector after the ticket was used as unknown, never as a retryable failure', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'throw', error: new Error('socket hang up'), visible: true })
    const opp = await world.readyReply()

    const action = await sending().send(opp.id)

    expect(action.state).toBe('unknown')
    expect(action.error).toMatch(/socket hang up/)
    expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('unknown_pending')
    expect(publishCalls()).toBe(1)
  })

  it('treats losing the browser to the owner during the send as unknown', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'throw', error: new TakeoverError() })
    const opp = await world.readyReply()
    const action = await sending().send(opp.id)
    expect(action.state).toBe('unknown')
    expect(action.error).toMatch(/took control/)
  })

  it('treats a confirmation without link or id as unknown', async () => {
    world = makeWorld()
    world.connector.publish = async () => ({ status: 'confirmed', url: '', externalId: '' })
    const opp = await world.readyReply()
    expect((await sending().send(opp.id)).state).toBe('unknown')
  })
})

describe('reconciliation (REQ-004 criterion 3, REQ-005 criterion 10)', () => {
  it('confirms an unknown result when the publication is found, recording the reference', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown', visible: true })
    const opp = await world.readyReply()
    await sending().send(opp.id)

    const action = await sending().reconcile(opp.id)

    expect(action?.state).toBe('confirmed')
    expect(action?.resultUrl).toMatch(/#published-1$/)
    expect(action?.resultExternalId).toBe('fake-pub-1')
    expect(action?.completedAt).toBe(world.clock.now().toISOString())
    expect(world.opportunity(opp.id).state).toBe('confirmed')
    expect(publishCalls()).toBe(1)
    expect(world.core.runs.list().some((r) => r.kind === 'reconcile' && r.status === 'ok')).toBe(true)
  })

  it('keeps the result unknown while the platform shows nothing, and never resends blindly', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown', visible: false })
    const opp = await world.readyReply()
    await sending().send(opp.id)

    world.clock.advance(UNKNOWN_WAIT_MS - 60_000)
    const action = await sending().reconcile(opp.id)

    expect(action?.state).toBe('unknown')
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
    expect(world.opportunity(opp.id).reason).toMatch(/Not found on the platform yet/)
    expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('unknown_pending')
    expect(publishCalls()).toBe(1)
  })

  it('marks the attempt failed after 10 minutes without a trace, returning the item to review', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown', visible: false })
    const opp = await world.readyReply()
    await sending().send(opp.id)

    world.clock.advance(UNKNOWN_WAIT_MS + 1000)
    const action = await sending().reconcile(opp.id)

    expect(action?.state).toBe('failed')
    expect(action?.error).toBe(NOT_FOUND_REASON)
    const after = world.opportunity(opp.id)
    expect(after.state).toBe('awaiting_approval')
    expect(after.reason).toMatch(/safe to retry after review/)
    expect(publishCalls()).toBe(1) // reconciliation itself never publishes

    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
    expect(publishCalls()).toBe(2)
  })

  it('stays unknown when the platform cannot be checked', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown' })
    const opp = await world.readyReply()
    await sending().send(opp.id)
    world.clock.advance(UNKNOWN_WAIT_MS * 3)
    world.connector.findPublishedError = new Error('login expired')

    const action = await sending().reconcile(opp.id)

    expect(action?.state).toBe('unknown')
    expect(world.opportunity(opp.id).reason).toMatch(/Could not check the platform/)
  })

  it('returns null when nothing is pending', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    expect(await sending().reconcile(opp.id)).toBeNull()
  })

  it('turns an attempt left "sending" by a stopped application into an unknown result after launch, then reconciles it', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const draft = world.core.repos.latestDraft(opp.id)!
    const approval = world.card(opp.id).approval!
    // Simulate a crash in the middle of an attempt: the row says 'sending' but no process is working on it.
    world.core.db
      .prepare(
        `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis)
         VALUES ('crashed', ?, ?, ?, ?, ?, ?, 'sending', ?, 'user approval x')`
      )
      .run(opp.id, draft.id, approval.id, approval.contentHash, world.account.id, approval.destination, world.clock.now().toISOString())
    world.store.updateOpportunity(opp.id, { state: 'sending' })
    world.connector.published.push({ request: { kind: 'reply', destination: approval.destination, parentExternalId: null, title: null, text: draft.text, link: null, attachments: [] }, ticket: {} as never, visible: true, ref: { url: 'https://fake.test/found', externalId: 'found-1' } })

    const resolved = await sending().reconcileAllUnknown()

    expect(resolved).toBe(1)
    const action = world.core.repos.action('crashed')
    expect(action.state).toBe('confirmed')
    expect(action.resultUrl).toBe('https://fake.test/found')
    expect(world.opportunity(opp.id).state).toBe('confirmed')
  })

  it('leaves attempts it cannot resolve yet as unknown and counts only the resolved ones', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown', visible: false }, { kind: 'unknown', visible: true })
    const a = await world.readyReply()
    const b = await world.readyReply()
    await sending().send(a.id)
    await sending().send(b.id)

    const resolved = await sending().reconcileAllUnknown()

    expect(resolved).toBe(1)
    expect(world.core.repos.lastAction(a.id)?.state).toBe('unknown')
    expect(world.core.repos.lastAction(b.id)?.state).toBe('confirmed')
  })
})

describe('concurrency: one attempt only (REQ-004 criteria 3 and 5)', () => {
  it('two simultaneous send() calls produce exactly one publish', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    let release!: () => void
    world.connector.publishGate = new Promise<void>((resolve) => (release = resolve))

    const first = sending().send(opp.id)
    const second = sending().send(opp.id)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(publishCalls()).toBe(1) // the second call has not reached the connector while the first is in flight
    release()
    const results = await Promise.allSettled([first, second])

    expect(publishCalls()).toBe(1)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(SendBlockedError)
    expect(world.core.db.prepare('SELECT COUNT(*) c FROM send_actions').pluck().get()).toBe(1)
  })

  it('serializes sends of one account so limits cannot be exceeded by racing calls', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    const a = await world.readyReply()
    const b = await world.readyReply()

    const results = await Promise.allSettled([sending().send(a.id), sending().send(b.id)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(publishCalls()).toBe(1)
  })

  it('the database itself refuses a second open attempt for the same opportunity', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await sending().send(opp.id)
    const draft = world.core.repos.latestDraft(opp.id)!
    const approval = world.card(opp.id).approval!
    const insert = () =>
      world.core.db
        .prepare(
          `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis)
           VALUES ('dup', ?, ?, ?, 'h', ?, 'd', 'sending', 'now', 'x')`
        )
        .run(opp.id, draft.id, approval.id, world.account.id)
    expect(insert).toThrow(/UNIQUE/)
  })

  it('a crashed attempt can never leave the connector with a usable ticket', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.publishScript.push({ kind: 'throw', error: new Error('boom') })
    await sending().send(opp.id)
    expect(() => world.core.tickets.assertValid(world.connector.published[0].ticket)).toThrow(TicketError)
  })
})

describe('standalone publications (REQ-003 criterion 5)', () => {
  it('are sent only after the owner approved them, through the same gate, as posts to the channel', async () => {
    world = makeWorld({ mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } })
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hello world', text: 'Our first post', link: 'https://natalmystic.com' } })
    expect((await sendBlocked(opportunity)).code).toBe('not_ready')

    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    const action = await sending().send(opportunity.id)

    expect(action.state).toBe('confirmed')
    expect(action.authorizationBasis).toMatch(/^user approval /)
    const request = world.connector.published[0].request
    expect(request.kind).toBe('post')
    expect(request.destination).toBe(world.channel.url)
    expect(request.title).toBe('Hello world')
    expect(request.link).toBe('https://natalmystic.com')
  })

  /** A publication approved BEFORE its planned time, as the scheduler expects. */
  const scheduledAndApproved = async (title: string, minutesAhead: number) => {
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: `${title} body` } })
    await world.core.router.call('publications.schedule', { id: opportunity.id, at: new Date(world.clock.now().getTime() + minutesAhead * 60_000).toISOString() })
    await world.core.router.call('opportunities.approve', { id: opportunity.id })
    return opportunity
  }

  it('sendDuePublications sends approved, due publications and nothing else', async () => {
    world = makeWorld()
    const due = await scheduledAndApproved('due', 5)
    const future = await scheduledAndApproved('future', 120)
    const create = async (title: string) => (await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: `${title} body` } })).opportunity
    const unapproved = await create('unapproved')
    await world.core.router.call('publications.schedule', { id: unapproved.id, at: new Date(world.clock.now().getTime() + 5 * 60_000).toISOString() })
    const unscheduled = await create('unscheduled')
    await world.core.router.call('opportunities.approve', { id: unscheduled.id })

    world.clock.advance(10 * 60_000)
    expect(await sending().sendDuePublications()).toBe(1)

    expect(world.connector.published.map((p) => p.request.title)).toEqual(['due'])
    expect(world.opportunity(due.id).state).toBe('confirmed')
    expect(world.opportunity(future.id).state).toBe('ready')
    expect(world.opportunity(unapproved.id).state).toBe('draft')

    world.clock.advance(2 * 3_600_000)
    expect(await sending().sendDuePublications()).toBe(1)
    expect(world.connector.published.map((p) => p.request.title)).toEqual(['due', 'future'])
  })

  it('sendDuePublications does nothing while automation is paused, and counts only real attempts', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    await scheduledAndApproved('one', 5)
    await scheduledAndApproved('two', 5)
    world.clock.advance(10 * 60_000)

    world.core.settings.setRaw('automation.paused', true)
    expect(await sending().sendDuePublications()).toBe(0)
    expect(publishCalls()).toBe(0)

    world.core.settings.setRaw('automation.paused', false)
    expect(await sending().sendDuePublications()).toBe(1) // the second one is held back by the hourly limit
    expect(publishCalls()).toBe(1)
  })

  it('does not send a publication more than an hour past its planned time; it returns to review', async () => {
    world = makeWorld()
    const late = await scheduledAndApproved('late', 5)
    const barelyOk = await scheduledAndApproved('barely ok', 10)

    // The app was not running: now it is 61 minutes after 'late' and 56 after 'barely ok'.
    world.clock.advance(66 * 60_000)
    expect(await sending().sendDuePublications()).toBe(1)

    expect(world.connector.published.map((p) => p.request.title)).toEqual(['barely ok'])
    const after = world.opportunity(late.id)
    expect(after.state).toBe('draft')
    expect(after.reason).toBe('The scheduled time passed while the app was not running; confirm to send')
    expect(world.card(late.id).approval).toBeNull()
    expect(world.opportunity(barelyOk.id).state).toBe('confirmed')

    // Nothing happens again for it: it waits for the owner, who confirms by approving and pressing Send.
    expect(await sending().sendDuePublications()).toBe(0)
    await world.core.router.call('opportunities.approve', { id: late.id })
    expect(await sending().sendDuePublications()).toBe(0)
    expect(publishCalls()).toBe(1)
    expect((await sending().send(late.id)).state).toBe('confirmed')
  })

  it('approving a publication whose planned time has already passed does not publish it by itself', async () => {
    world = makeWorld()
    const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Past', text: 'Body' } })
    await world.core.router.call('publications.schedule', { id: opportunity.id, at: new Date(world.clock.now().getTime() - 5 * 60_000).toISOString() })

    const card = await world.core.router.call('opportunities.approve', { id: opportunity.id })
    expect(card.opportunity.state).toBe('ready')
    expect(card.opportunity.reason).toMatch(/already passed; press Send/)

    expect(await sending().sendDuePublications()).toBe(0)
    world.clock.advance(5 * 60_000)
    expect(await sending().sendDuePublications()).toBe(0)
    expect(publishCalls()).toBe(0)

    // The owner pressing Send is what publishes it.
    expect((await world.core.router.call('opportunities.send', { id: opportunity.id })).opportunity.state).toBe('confirmed')
    expect(publishCalls()).toBe(1)
  })
})

describe('SendGate: the approval is bound to who is signed in', () => {
  const setIdentity = (identity: string | null): void => void world.core.db.prepare('UPDATE accounts SET identity = ? WHERE id = ?').run(identity, world.account.id)

  it('refuses to send after the signed-in identity changed, saying exactly why, and needs a new approval', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const approvalId = world.card(opp.id).approval!.id
    expect(world.store.approvalIdentity(approvalId)).toBe('brand_account')

    setIdentity('someone_else')
    const block = await sendBlocked(opp)

    expect(block.code).toBe('identity_changed')
    expect(block.effect).toBe('review')
    expect(block.reasons.join(' ')).toContain('the signed-in identity changed; approve again')
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(world.card(opp.id).approval).toBeNull()

    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect(world.store.approvalIdentity(world.card(opp.id).approval!.id)).toBe('someone_else')
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it('also refuses when the identity was lost, or confirmed after the approval was given without one', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    setIdentity(null)
    expect((await sendBlocked(opp)).code).toBe('identity_changed')

    // Approved while no identity was known; the identity then gets confirmed.
    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect(world.store.approvalIdentity(world.card(opp.id).approval!.id)).toBeNull()
    setIdentity('brand_account')
    const block = await sendBlocked(opp)
    expect(block.code).toBe('identity_changed')
    expect(block.reasons.join(' ')).toContain('the signed-in identity changed; approve again')
    expect(publishCalls()).toBe(0)
  })

  it('does not treat a different spelling of the same identity as a different login', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    setIdentity('u/BRAND_Account')
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it('keeps the generic reason when something else than the identity changed', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.core.db.prepare('UPDATE drafts SET text = ? WHERE opportunity_id = ?').run('sneaky different text', opp.id)
    expect((await sendBlocked(opp)).code).toBe('approval_stale')
  })

  it('binds an automatic approval to the identity as well', async () => {
    world = makeWorld({ mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } })
    world.engine.on('draft.reply', JSON.stringify({ category: 'thanks', decision: 'reply', reply: 'Glad you like it, enjoy!', rationale: 'thanks', usedClaimIds: [] }))
    const opp = await world.newOpportunity({ body: 'Thanks, great app!' })
    world.core.settings.setRaw('automation.paused', true)
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(opp.id).state).toBe('ready')

    setIdentity('someone_else')
    world.core.settings.setRaw('automation.paused', false)
    await world.drafting.processChannel(world.channel.id)

    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(world.opportunity(opp.id).reason).toContain('the signed-in identity changed; approve again')
  })
})

describe('SendGate (c): threads the connector could not read completely', () => {
  it('holds the send instead of concluding that no reply exists', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.markIncomplete('d1')

    const block = await sendBlocked(opp)

    expect(block.code).toBe('thread_incomplete')
    expect(block.effect).toBe('hold')
    expect(block.reasons.join(' ')).toContain('The thread is too large to check for an existing reply')
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).state).toBe('ready')
    expect(world.card(opp.id).approval).not.toBeNull()
  })

  it('still stops when a reply of the account is visible in the part that was read', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.markIncomplete('d1')
    world.connector.addComment('d1', { externalId: 'manual', parentExternalId: commentOf(opp).externalId, author: 'Brand_Account' })
    expect((await sendBlocked(opp)).code).toBe('already_replied')
  })

  it('does not cancel for a comment that is merely missing from a partial read, and sends once the thread reads fully', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.markIncomplete('d1')
    world.connector.removeComment('d1', commentOf(opp).externalId) // not visible in the partial snapshot
    const block = await sendBlocked(opp)
    expect(block.code).toBe('thread_incomplete')
    expect(world.opportunity(opp.id).state).toBe('ready')

    world.connector.incompleteDiscussions.clear()
    world.connector.addComment('d1', { externalId: commentOf(opp).externalId, body: 'How does the natal chart work?' })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it('holds automatic sends too, without spamming the owner', async () => {
    world = makeWorld({ mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } })
    world.engine.on('draft.reply', JSON.stringify({ category: 'thanks', decision: 'reply', reply: 'Glad you like it, enjoy!', rationale: 'thanks', usedClaimIds: [] }))
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.markIncomplete('d1')
    const opp = await world.newOpportunity({ body: 'Thanks, great app!' })
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(opp.id).state).toBe('ready')
    expect(world.opportunity(opp.id).reason).toMatch(/too large to check/)
    expect(publishCalls()).toBe(0)
  })
})

describe('a send that fails because the account is not signed in (REQ-005)', () => {
  const loginProblem = () => ({ loggedIn: false, identity: null, captcha: false })
  const changes = (): string[] => {
    const scopes: string[] = []
    world.core.events.subscribe((e) => {
      if (e.type === 'changed') scopes.push(e.scope)
    })
    return scopes
  }

  it('suspends the account and keeps the approved item instead of returning it to review on every tick', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const scopes = changes()
    world.connector.publishScript.push({ kind: 'fail', error: 'You are not signed in to the site' })
    world.connector.login = loginProblem()

    const action = await sending().send(opp.id)

    expect(action.state).toBe('failed')
    expect(world.core.repos.account(world.account.id).status).toBe('login_required')
    expect(world.refresh().status).toBe('needs_user')
    expect(world.refresh().statusDetail).toMatch(/signed out/)
    expect(scopes).toEqual(expect.arrayContaining(['accounts', 'attention']))
    const after = world.opportunity(opp.id)
    expect(after.state).toBe('ready')
    expect(after.reason).toMatch(/Sending is paused: account .* is signed out/)
    expect(world.card(opp.id).approval).not.toBeNull()

    // Later ticks do not try again, and nothing is sent until the owner has signed in.
    for (let i = 0; i < 3; i++) expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('unavailable')
    expect(publishCalls()).toBe(1)

    world.core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(world.account.id)
    world.connector.login = { loggedIn: true, identity: 'brand_account', captcha: false }
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it('recognises a CAPTCHA the same way', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.publishScript.push({ kind: 'fail', error: 'CAPTCHA required before posting' })
    world.connector.login = { loggedIn: true, identity: 'brand_account', captcha: true }
    await sending().send(opp.id)
    expect(world.core.repos.account(world.account.id).status).toBe('captcha')
    expect(world.opportunity(opp.id).state).toBe('ready')
  })

  it('treats an exception named like a login problem as an unknown result AND suspends the account', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.publishScript.push({ kind: 'throw', error: Object.assign(new Error('redirected'), { name: 'LoginRequiredError' }) })
    world.connector.login = loginProblem()

    const action = await sending().send(opp.id)

    expect(action.state).toBe('unknown')
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
    expect(world.core.repos.account(world.account.id).status).toBe('login_required')
    expect(world.refresh().status).toBe('needs_user')
  })

  it('believes a login-sounding failure only when the login check agrees', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.publishScript.push({ kind: 'fail', error: 'Session expired while posting' })

    const action = await sending().send(opp.id) // the login check says the account is signed in

    expect(action.state).toBe('failed')
    expect(world.core.repos.account(world.account.id).status).toBe('ready')
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
  })

  it('does not look at the login for an ordinary failure', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.publishScript.push({ kind: 'fail', error: 'Rate limit exceeded' })
    const before = world.connector.calls.filter((c) => c === 'checkLogin').length
    await sending().send(opp.id)
    expect(world.connector.calls.filter((c) => c === 'checkLogin').length).toBe(before)
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
  })
})

describe('reconciliation asks for the right thing and does not over-trust the answer', () => {
  const verifiedKeys = (): string[] => {
    const keys: string[] = []
    world.core.services.channels = { markCapabilityVerified: (_id, key) => void keys.push(key) }
    return keys
  }

  it('passes the time of the attempt so an older identical publication cannot be mistaken for it', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown', visible: false })
    const opp = await world.readyReply()
    const first = await sending().send(opp.id)
    const draft = world.core.repos.latestDraft(opp.id)!
    // An earlier, identical publication of the same text exists on the platform.
    world.connector.published.push({
      request: { kind: 'reply', destination: first.destination, parentExternalId: null, title: null, text: draft.text, link: null, attachments: [] },
      ticket: {} as never,
      visible: true,
      ref: { url: 'https://fake.test/older', externalId: 'older-1' },
      createdAt: new Date(world.clock.now().getTime() - 3_600_000).toISOString()
    })
    world.clock.advance(60_000)

    const after = await sending().reconcile(opp.id)

    expect(world.connector.findPublishedRequests.at(-1)?.attemptedAt).toBe(first.attemptedAt)
    expect(after?.state).toBe('unknown')
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
  })

  it('does not accept a match that is the result of another confirmed send', async () => {
    world = makeWorld()
    const sent = await world.readyReply()
    const done = await sending().send(sent.id)
    world.connector.publishScript.push({ kind: 'unknown', visible: false })
    const pending = await world.readyReply({ text: 'A different reply entirely.' })
    const attempt = await sending().send(pending.id)
    world.connector.published.push({
      request: { kind: 'reply', destination: attempt.destination, parentExternalId: null, title: null, text: 'A different reply entirely.', link: null, attachments: [] },
      ticket: {} as never,
      visible: true,
      ref: { url: done.resultUrl as string, externalId: done.resultExternalId as string },
      createdAt: new Date(world.clock.now().getTime() + 1000).toISOString()
    })
    world.clock.advance(60_000)

    const after = await sending().reconcile(pending.id)

    expect(after?.state).toBe('unknown')
    expect(world.core.repos.lastAction(pending.id)?.state).toBe('unknown')
  })

  it('marks capabilities verified from a reconciled match only when it is a specific, unused platform object', async () => {
    world = makeWorld()
    const keys = verifiedKeys()
    world.connector.publishScript.push({ kind: 'unknown', visible: true })
    const opp = await world.readyReply()
    await sending().send(opp.id)
    expect(keys).toEqual([])

    expect((await sending().reconcile(opp.id))?.state).toBe('confirmed')
    expect(keys).toEqual(['publish_reply', 'verify_send'])
  })

  it('confirms a match without a platform id, but does not treat it as proof that the channel can publish', async () => {
    world = makeWorld()
    const keys = verifiedKeys()
    world.connector.publishScript.push({ kind: 'unknown', visible: false })
    const opp = await world.readyReply()
    await sending().send(opp.id)
    world.connector.findPublished = async () => ({ url: 'https://fake.test/some-link', externalId: '' })
    world.clock.advance(60_000)

    const after = await sending().reconcile(opp.id)

    expect(after?.state).toBe('confirmed')
    expect(after?.resultUrl).toBe('https://fake.test/some-link')
    expect(keys).toEqual([])
  })

  it('still verifies the capabilities after a direct confirmed send', async () => {
    world = makeWorld()
    const keys = verifiedKeys()
    await sending().send((await world.readyReply()).id)
    expect(keys).toEqual(['publish_reply', 'verify_send'])
  })
})

describe('the owner settles an unknown result (opportunities.resolveUnknown)', () => {
  const unknownItem = async () => {
    world.connector.publishScript.push({ kind: 'unknown', visible: false })
    const opp = await world.readyReply()
    const action = await sending().send(opp.id)
    expect(action.state).toBe('unknown')
    return { opp, action }
  }
  const logs = (): string[] => world.core.log.list(50).map((l) => l.message)

  it('published: confirms the attempt with the given link, notes who resolved it, and logs it', async () => {
    world = makeWorld()
    const { opp, action } = await unknownItem()

    const card = await world.core.router.call('opportunities.resolveUnknown', { id: opp.id, outcome: 'published', url: ' https://fake.test/r/test/comments/d1/mine ' })

    expect(card.opportunity.state).toBe('confirmed')
    expect(card.lastAction).toMatchObject({ id: action.id, state: 'confirmed', resultUrl: 'https://fake.test/r/test/comments/d1/mine', resultExternalId: null, error: null })
    expect(card.lastAction?.authorizationBasis).toMatch(/^user approval .*; resolved by owner$/)
    expect(card.lastAction?.completedAt).toBe(world.clock.now().toISOString())
    expect(logs().some((m) => /Owner confirmed that the unknown send .* was published/.test(m))).toBe(true)
    expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('already_sent')
    expect(publishCalls()).toBe(1)
  })

  it('published without a link is allowed', async () => {
    world = makeWorld()
    const { opp } = await unknownItem()
    const card = await world.core.router.call('opportunities.resolveUnknown', { id: opp.id, outcome: 'published' })
    expect(card.lastAction).toMatchObject({ state: 'confirmed', resultUrl: null })
  })

  it('not_published: fails the attempt with the owner\'s statement and returns the item to review; a fresh approval is required', async () => {
    world = makeWorld()
    const { opp, action } = await unknownItem()

    const card = await world.core.router.call('opportunities.resolveUnknown', { id: opp.id, outcome: 'not_published' })

    expect(card.lastAction).toMatchObject({ id: action.id, state: 'failed', error: 'Owner confirmed it was not published' })
    expect(card.opportunity.state).toBe('awaiting_approval')
    expect(card.opportunity.reason).toMatch(/not published/)
    expect(card.approval).toBeNull()
    expect(logs().some((m) => /Owner confirmed that the unknown send .* was not published/.test(m))).toBe(true)
    expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('not_ready')

    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
    expect(publishCalls()).toBe(2)
  })

  it('also settles an attempt a stopped application left in "sending"', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const draft = world.core.repos.latestDraft(opp.id)!
    const approval = world.card(opp.id).approval!
    world.core.db
      .prepare(
        `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis)
         VALUES ('crashed', ?, ?, ?, ?, ?, ?, 'sending', ?, 'user approval x')`
      )
      .run(opp.id, draft.id, approval.id, approval.contentHash, world.account.id, approval.destination, world.clock.now().toISOString())
    world.store.updateOpportunity(opp.id, { state: 'sending' })

    const card = await world.core.router.call('opportunities.resolveUnknown', { id: opp.id, outcome: 'not_published' })
    expect(card.lastAction?.state).toBe('failed')
  })

  it.each([
    ['an item that was never sent', async () => (await world.readyReply()).id],
    ['an item that was already confirmed', async () => { const o = await world.readyReply(); await sending().send(o.id); return o.id }],
    ['an item whose attempt failed', async () => { world.connector.publishScript.push({ kind: 'fail', error: 'Rate limit exceeded' }); const o = await world.readyReply(); await sending().send(o.id); return o.id }]
  ])('refuses %s', async (_name, make) => {
    world = makeWorld()
    const id = await make()
    await expect(world.core.router.call('opportunities.resolveUnknown', { id, outcome: 'published' })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(world.core.router.call('opportunities.resolveUnknown', { id, outcome: 'not_published' })).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('refuses a link that is not an http(s) address and leaves the item unknown', async () => {
    world = makeWorld()
    const { opp } = await unknownItem()
    await expect(world.core.router.call('opportunities.resolveUnknown', { id: opp.id, outcome: 'published', url: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(world.opportunity(opp.id).state).toBe('unknown_result')
  })

  it('works even when the platform cannot be checked at all', async () => {
    world = makeWorld()
    const { opp } = await unknownItem()
    world.connector.findPublishedError = new Error('login expired')
    world.clock.advance(60 * 60_000)
    expect((await sending().reconcile(opp.id))?.state).toBe('unknown')
    expect((await world.core.router.call('opportunities.resolveUnknown', { id: opp.id, outcome: 'not_published' })).opportunity.state).toBe('awaiting_approval')
  })
})

describe('limits are the account\'s budget, shared by all its channels (REQ-004 criterion 5)', () => {
  it('compares each channel\'s own ceiling with what the whole account has sent', async () => {
    world = makeWorld({ settings: { limits: { perHour: 5, perDay: 50 } } })
    const strict = world.addChannel({ target: 'r/strict', settings: { limits: { perHour: 1, perDay: 50 } } })

    expect((await sending().send((await world.readyReply()).id)).state).toBe('confirmed') // via the generous channel

    // The strict channel has sent nothing itself, but the account already used its one allowed send there.
    const blocked = await sendBlocked(await world.readyReply({ channel: strict }))
    expect(blocked.code).toBe('limit_hour')
    expect(blocked.reasons.join(' ')).toMatch(/1 send\(s\) across all its channels/)

    // The generous channel keeps going: 1 of its 5.
    expect((await sending().send((await world.readyReply()).id)).state).toBe('confirmed')
    expect(publishCalls()).toBe(2)
  })

  it('an account of its own has its own budget', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    const other = world.addAccount({ label: 'Other', identity: 'other_acc' })
    const separate = world.addChannel({ accountId: other.id, target: 'r/separate' })

    expect((await sending().send((await world.readyReply()).id)).state).toBe('confirmed')
    // The main account used up its hour; a second send from it is held back ...
    expect((await sendBlocked(await world.readyReply())).code).toBe('limit_hour')
    // ... while the other account has not sent anything yet.
    expect((await sending().send((await world.readyReply({ channel: separate })).id)).state).toBe('confirmed')
    expect(publishCalls()).toBe(2)
  })
})

describe('one account reused by two products keeps the shared-account rules (DEC-009 point 1, REQ-004)', () => {
  /** The world's account belongs to product A; product B deliberately reuses it for a channel of its own. */
  const twoProducts = (settings = { limits: { perHour: 2, perDay: 10 } }) => {
    world = makeWorld({ settings })
    const productB = world.addProduct('Second product')
    const channelB = world.addChannel({ productId: productB.id, target: 'r/second_product' })
    expect(channelB.productId).toBe(productB.id)
    expect(channelB.accountId).toBe(world.account.id)
    return { channelA: world.channel, channelB }
  }

  it('counts the sends of both products against one account budget', async () => {
    const { channelB } = twoProducts({ limits: { perHour: 2, perDay: 10 } })

    expect((await sending().send((await world.readyReply()).id)).state).toBe('confirmed') // product A
    expect((await sending().send((await world.readyReply({ channel: channelB })).id)).state).toBe('confirmed') // product B

    // Each product has sent one; the account has sent two, so neither product may send a third.
    for (const channel of [world.channel, channelB]) {
      const blocked = await sendBlocked(await world.readyReply({ channel }))
      expect(blocked.code).toBe('limit_hour')
      expect(blocked.reasons.join(' ')).toMatch(/2 send\(s\) across all its channels/)
    }
    expect(publishCalls()).toBe(2)
  })

  it('applies the daily budget the same way across products', async () => {
    const { channelB } = twoProducts({ limits: { perHour: 10, perDay: 1 } })
    expect((await sending().send((await world.readyReply({ channel: channelB })).id)).state).toBe('confirmed')
    expect((await sendBlocked(await world.readyReply())).code).toBe('limit_day')
  })

  it('lets only one send of the shared account run at a time, whichever product it belongs to', async () => {
    const { channelB } = twoProducts({ limits: { perHour: 1, perDay: 5 } })
    const a = await world.readyReply()
    const b = await world.readyReply({ channel: channelB })

    const results = await Promise.allSettled([sending().send(a.id), sending().send(b.id)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(publishCalls()).toBe(1)
  })

  it('never runs two publishes of the shared account side by side', async () => {
    const { channelB } = twoProducts()
    const a = await world.readyReply()
    const b = await world.readyReply({ channel: channelB })
    let release!: () => void
    world.connector.publishGate = new Promise<void>((resolve) => (release = resolve))

    const first = sending().send(a.id)
    const second = sending().send(b.id)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(publishCalls()).toBe(1) // product B waits for product A's send to finish
    release()
    await Promise.all([first, second])
    expect(publishCalls()).toBe(2)
  })

  it('stops the sends of both products while the owner controls the shared browser session', async () => {
    const { channelB } = twoProducts()
    const a = await world.readyReply()
    const b = await world.readyReply({ channel: channelB })
    world.browser.session(world.account).takeControl()

    for (const opp of [a, b]) expect((await sendBlocked(opp)).reasons.join(' ')).toMatch(/under your control/)
    expect(publishCalls()).toBe(0)
  })

  it('does not let the budget of an account used by one product only spill over to the other product\'s own account', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    const productB = world.addProduct('Second product')
    const ownAccount = world.addAccount({ label: 'Own login', identity: 'other_acc', productId: productB.id })
    const channelB = world.addChannel({ productId: productB.id, accountId: ownAccount.id, target: 'r/own_login' })

    expect((await sending().send((await world.readyReply()).id)).state).toBe('confirmed')
    expect((await sending().send((await world.readyReply({ channel: channelB })).id)).state).toBe('confirmed')
  })
})

describe('the owner API surfaces the gate\'s reasons', () => {
  it('opportunities.send reports a blocked send as send_blocked with the explanation', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    world.connector.addComment('d1', { externalId: 'manual', parentExternalId: commentOf(opp).externalId, author: 'brand_account' })

    await expect(world.core.router.call('opportunities.send', { id: opp.id })).rejects.toMatchObject({ code: 'send_blocked', message: expect.stringMatching(/already replied/) })
  })

  it('opportunities.send returns the card with the confirmed action', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const card = await world.core.router.call('opportunities.send', { id: opp.id })
    expect(card.opportunity.state).toBe('confirmed')
    expect(card.lastAction?.resultUrl).toMatch(/published/)
  })

  it('opportunities.reconcile returns the updated card', async () => {
    world = makeWorld()
    world.connector.publishScript.push({ kind: 'unknown', visible: true })
    const opp = await world.readyReply()
    await world.core.router.call('opportunities.send', { id: opp.id })
    const card = await world.core.router.call('opportunities.reconcile', { id: opp.id })
    expect(card.opportunity.state).toBe('confirmed')
  })
})
