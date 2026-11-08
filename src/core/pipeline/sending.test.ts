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
    expect(decision.ticket.contentHash).toBe(contentHash(draft, world.account.id, commentOf(opp).url))
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
    world.store.insertApproval({ draftId: draft.id, contentHash: contentHash(draft, world.account.id, commentOf(opp).url), accountId: world.account.id, destination: commentOf(opp).url, approvedBy: 'auto_rule', ruleId: 'auto:thanks:v1' })
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
    world.store.insertApproval({ draftId: draft.id, contentHash: contentHash(draft, world.account.id, world.channel.url), accountId: world.account.id, destination: world.channel.url, approvedBy: 'auto_rule', ruleId: 'auto:thanks:v1' })
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

  it('sendDuePublications sends approved, due publications and nothing else', async () => {
    world = makeWorld()
    const create = async (title: string) => (await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: `${title} body` } })).opportunity
    const due = await create('due')
    const future = await create('future')
    const unapproved = await create('unapproved')
    const unscheduled = await create('unscheduled')
    const now = world.clock.now().getTime()
    for (const [opp, at] of [[due, now - 1000], [future, now + 3_600_000], [unapproved, now - 1000]] as const) {
      await world.core.router.call('publications.schedule', { id: opp.id, at: new Date(at).toISOString() })
    }
    for (const opp of [due, future, unscheduled]) await world.core.router.call('opportunities.approve', { id: opp.id })

    expect(await sending().sendDuePublications()).toBe(1)

    expect(world.connector.published.map((p) => p.request.title)).toEqual(['due'])
    expect(world.opportunity(due.id).state).toBe('confirmed')
    expect(world.opportunity(future.id).state).toBe('ready')

    world.clock.advance(2 * 3_600_000)
    expect(await sending().sendDuePublications()).toBe(1)
    expect(world.connector.published.map((p) => p.request.title)).toEqual(['due', 'future'])
  })

  it('sendDuePublications does nothing while automation is paused, and counts only real attempts', async () => {
    world = makeWorld({ settings: { limits: { perHour: 1, perDay: 5 } } })
    const make = async (title: string) => {
      const { opportunity } = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title, text: 'b' } })
      await world.core.router.call('publications.schedule', { id: opportunity.id, at: new Date(world.clock.now().getTime() - 1000).toISOString() })
      await world.core.router.call('opportunities.approve', { id: opportunity.id })
      return opportunity
    }
    await make('one')
    await make('two')

    world.core.settings.setRaw('automation.paused', true)
    expect(await sending().sendDuePublications()).toBe(0)
    expect(publishCalls()).toBe(0)

    world.core.settings.setRaw('automation.paused', false)
    expect(await sending().sendDuePublications()).toBe(1) // the second one is held back by the hourly limit
    expect(publishCalls()).toBe(1)
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
