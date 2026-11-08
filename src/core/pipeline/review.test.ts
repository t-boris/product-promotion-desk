import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Attachment, Opportunity } from '../../shared/types'
import { ATTACHMENT_MAX_BYTES } from './attachments'
import { contentHash } from './hash'
import { FACTS_CHANGED_REASON } from './review'
import { closeWorld, makeClaim, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const dir = (): string => mkdtempSync(join(tmpdir(), 'ppd-review-'))
function imageFile(name: string, body: Buffer = PNG_HEAD, extra = 'body'): string {
  const path = join(dir(), name)
  writeFileSync(path, Buffer.concat([body, Buffer.from(extra)]))
  return path
}
const att = (path: string, name = 'image.png'): Attachment => ({ name, path, mime: '', sha256: '' })

const draftRows = (opp: Opportunity) => world.core.db.prepare('SELECT id, text, author FROM drafts WHERE opportunity_id = ? ORDER BY rowid').all(opp.id) as { id: string; text: string; author: string }[]
const approvals = (opp: Opportunity) =>
  world.core.db.prepare('SELECT a.id, a.draft_id, a.invalidated_at, a.invalid_reason, a.approved_by FROM approvals a JOIN drafts d ON d.id = a.draft_id WHERE d.opportunity_id = ? ORDER BY a.rowid').all(opp.id) as {
    id: string
    draft_id: string
    invalidated_at: string | null
    invalid_reason: string
    approved_by: string
  }[]

describe('saveDraft: drafts are immutable and every edit invalidates approvals (REQ-004 criterion 1)', () => {
  it('inserts a new draft row for each edit and keeps the old content', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'first version' } })
    const card = await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: '  second version  ' } })

    expect(draftRows(opp).map((d) => d.text)).toEqual(['first version', 'second version'])
    expect(card.draft?.text).toBe('second version')
    expect(card.draft?.author).toBe('user')
    expect(card.opportunity.state).toBe('draft')
  })

  it('invalidates the approval of the previous content, and the new approval is bound to the new draft', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const first = approvals(opp)
    expect(first).toHaveLength(1)
    expect(first[0].invalidated_at).toBeNull()

    const card = await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'changed my mind' } })

    expect(card.opportunity.state).toBe('awaiting_approval')
    expect(card.approval).toBeNull()
    expect(approvals(opp)[0].invalidated_at).not.toBeNull()

    await world.core.router.call('opportunities.approve', { id: opp.id })
    const all = approvals(opp)
    expect(all).toHaveLength(2)
    expect(all[1].invalidated_at).toBeNull()
    expect(all[1].draft_id).not.toBe(all[0].draft_id)
  })

  it('invalidates the approval even when the edit changes nothing visible but one attachment', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'same text' } })
    await world.core.router.call('opportunities.approve', { id: opp.id })
    const card = await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'same text', attachments: [att(imageFile('a.png'))] } })
    expect(card.approval).toBeNull()
    expect(card.opportunity.state).toBe('awaiting_approval')
  })

  it('keeps the AI rationale and fact lineage across an edit, so a later fact change still forces re-review', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    world.store.insertDraft(opp.id, { title: null, text: 'AI text', link: null, attachments: [] }, { knowledgeVersionId: 'pv-1', usedClaimLineageIds: ['lin-c1'], rationale: 'from c1', author: 'ai' })
    const card = await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'AI text, edited by me' } })
    expect(card.draft?.usedClaimLineageIds).toEqual(['lin-c1'])
    expect(card.draft?.rationale).toBe('from c1')
    expect(card.draft?.knowledgeVersionId).toBe('pv-1')
  })

  it.each([
    ['empty text', { text: '   ' }, /empty/],
    ['a relative-looking link', { text: 'hi', link: 'natalmystic.com' }, /http/],
    ['a javascript link', { text: 'hi', link: 'javascript:alert(1)' }, /http/],
    ['an over-long title', { text: 'hi', title: 'x'.repeat(301) }, /title/],
    ['an over-long text', { text: 'x'.repeat(40_001) }, /longer/]
  ])('rejects %s', async (_name, draft, message) => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    await expect(world.core.router.call('opportunities.saveDraft', { id: opp.id, draft })).rejects.toMatchObject({ code: 'invalid_input', message: expect.stringMatching(message) })
    expect(draftRows(opp)).toHaveLength(0)
  })

  it('cannot edit what was already sent, is being sent, or waits for its send result', async () => {
    world = makeWorld()
    const sent = await world.readyReply()
    await world.sending.send(sent.id)
    await expect(world.core.router.call('opportunities.saveDraft', { id: sent.id, draft: { text: 'rewrite history' } })).rejects.toMatchObject({ code: 'invalid_state' })

    const pending = await world.readyReply()
    world.connector.publishScript.push({ kind: 'unknown' })
    await world.sending.send(pending.id)
    await expect(world.core.router.call('opportunities.saveDraft', { id: pending.id, draft: { text: 'x' } })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(world.core.router.call('opportunities.reject', { id: pending.id })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(world.core.router.call('opportunities.defer', { id: pending.id })).rejects.toMatchObject({ code: 'invalid_state' })
    expect(draftRows(sent)).toHaveLength(1)
  })

  it('returns not_found for an unknown opportunity', async () => {
    world = makeWorld()
    await expect(world.core.router.call('opportunities.saveDraft', { id: 'nope', draft: { text: 'x' } })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('approve, reject and defer', () => {
  it('binds the approval to the exact hash of content, account and destination', async () => {
    world = makeWorld()
    const opp = await world.readyReply({ text: 'Exactly this.' })
    const card = world.card(opp.id)
    const draft = world.core.repos.latestDraft(opp.id)!
    const destination = world.core.repos.comment(opp.commentId as string).url

    expect(card.approval?.approvedBy).toBe('user')
    expect(card.approval?.ruleId).toBeNull()
    expect(card.approval?.accountId).toBe(world.account.id)
    expect(card.approval?.destination).toBe(destination)
    expect(card.approval?.contentHash).toBe(contentHash(draft, world.account, destination))
    expect(card.opportunity.state).toBe('ready')
  })

  it('is idempotent: approving twice keeps one active approval', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await world.core.router.call('opportunities.approve', { id: opp.id })
    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect(approvals(opp).filter((a) => a.invalidated_at === null)).toHaveLength(1)
  })

  it('the database allows only one active approval per draft', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const draft = world.core.repos.latestDraft(opp.id)!
    expect(() => world.store.insertApproval({ draftId: draft.id, contentHash: 'x', accountId: world.account.id, identity: null, destination: 'd', approvedBy: 'user', ruleId: null })).toThrow(/UNIQUE/)
  })

  it('needs a draft, and a freshly discovered item cannot be approved at all', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    await expect(world.core.router.call('opportunities.approve', { id: opp.id })).rejects.toMatchObject({ code: 'invalid_state' })
    world.store.updateOpportunity(opp.id, { state: 'needs_user' })
    await expect(world.core.router.call('opportunities.approve', { id: opp.id })).rejects.toMatchObject({ code: 'no_draft' })
    expect(approvals(opp)).toHaveLength(0)
  })

  it('refuses to approve an attachment that has vanished from disk', async () => {
    world = makeWorld()
    const opp = await world.newOpportunity()
    const path = imageFile('gone.png')
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'see image', attachments: [att(path)] } })
    const { unlinkSync } = await import('node:fs')
    unlinkSync(path)
    await expect(world.core.router.call('opportunities.approve', { id: opp.id })).rejects.toMatchObject({ code: 'invalid_attachment' })
    expect(world.opportunity(opp.id).state).not.toBe('ready')
  })

  it('refuses approval of items that are already out', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    await world.sending.send(opp.id)
    await expect(world.core.router.call('opportunities.approve', { id: opp.id })).rejects.toMatchObject({ code: 'invalid_state' })
  })

  it('reject cancels the item and withdraws its approval; it can no longer be sent', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const card = await world.core.router.call('opportunities.reject', { id: opp.id, reason: 'Not worth answering' })
    expect(card.opportunity.state).toBe('cancelled')
    expect(card.opportunity.reason).toBe('Not worth answering')
    expect(card.approval).toBeNull()
    await expect(world.sending.send(opp.id)).rejects.toMatchObject({ block: { code: 'not_ready' } })
    expect(world.connector.published).toHaveLength(0)
  })

  it('defer withdraws readiness; coming back means approving again', async () => {
    world = makeWorld()
    const opp = await world.readyReply()
    const card = await world.core.router.call('opportunities.defer', { id: opp.id })
    expect(card.opportunity.state).toBe('deferred')
    expect(card.approval).toBeNull()
    await expect(world.sending.send(opp.id)).rejects.toMatchObject({ block: { code: 'not_ready' } })

    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect((await world.sending.send(opp.id)).state).toBe('confirmed')
  })
})

describe('invalidateForChangedFacts (REQ-001: a fact change forces re-review)', () => {
  const withLineage = async (lineage: string[], state: 'awaiting_approval' | 'ready' | 'draft' | 'deferred' = 'awaiting_approval'): Promise<Opportunity> => {
    const opp = await world.newOpportunity()
    world.store.insertDraft(opp.id, { title: null, text: `built on ${lineage.join(',')}`, link: null, attachments: [] }, { knowledgeVersionId: 'pv-1', usedClaimLineageIds: lineage, rationale: 'r', author: 'ai' })
    world.store.updateOpportunity(opp.id, { state: state === 'ready' || state === 'deferred' ? 'awaiting_approval' : state })
    if (state === 'ready') await world.core.router.call('opportunities.approve', { id: opp.id })
    if (state === 'deferred') await world.core.router.call('opportunities.defer', { id: opp.id })
    return world.opportunity(opp.id)
  }

  it('returns only the pending items that relied on the changed facts, invalidating approvals', async () => {
    world = makeWorld()
    const affected = await withLineage(['lin-c1', 'lin-c2'], 'ready')
    const unaffected = await withLineage(['lin-c3'], 'ready')
    const draftAffected = await withLineage(['lin-c1'], 'draft')
    const deferred = await withLineage(['lin-c1'], 'deferred')

    const count = world.core.services.pipeline!.invalidateForChangedFacts(world.product.id, ['lin-c1'])

    expect(count).toBe(3)
    for (const opp of [affected, draftAffected, deferred]) {
      const after = world.opportunity(opp.id)
      expect(after.state).toBe('awaiting_approval')
      expect(after.reason).toBe(FACTS_CHANGED_REASON)
      expect(world.card(opp.id).approval).toBeNull()
    }
    expect(world.opportunity(unaffected.id).state).toBe('ready')
    expect(world.card(unaffected.id).approval).not.toBeNull()
    // The previously approved one can no longer be sent without a new approval.
    await expect(world.sending.send(affected.id)).rejects.toMatchObject({ block: { code: 'not_ready' } })
  })

  it('never touches publications that were already sent, nor those in flight or with an unknown result', async () => {
    world = makeWorld()
    const sent = await world.readyReply()
    world.store.insertDraft(sent.id, { title: null, text: 'x', link: null, attachments: [] }, { knowledgeVersionId: 'pv-1', usedClaimLineageIds: ['lin-c1'], rationale: '', author: 'ai' })
    await world.core.router.call('opportunities.approve', { id: sent.id })
    await world.sending.send(sent.id)
    const unknown = await world.readyReply()
    world.store.insertDraft(unknown.id, { title: null, text: 'y', link: null, attachments: [] }, { knowledgeVersionId: 'pv-1', usedClaimLineageIds: ['lin-c1'], rationale: '', author: 'ai' })
    await world.core.router.call('opportunities.approve', { id: unknown.id })
    world.connector.publishScript.push({ kind: 'unknown' })
    await world.sending.send(unknown.id)

    expect(world.core.services.pipeline!.invalidateForChangedFacts(world.product.id, ['lin-c1'])).toBe(0)
    expect(world.opportunity(sent.id).state).toBe('confirmed')
    expect(world.opportunity(unknown.id).state).toBe('unknown_result')
  })

  it("does not affect another product's items", async () => {
    world = makeWorld()
    const opp = await withLineage(['lin-c1'])
    expect(world.core.services.pipeline!.invalidateForChangedFacts('another-product', ['lin-c1'])).toBe(0)
    expect(world.opportunity(opp.id).reason).not.toBe(FACTS_CHANGED_REASON)
  })

  it('does nothing without changed lineage ids, and after a fact change a new approval makes the item sendable again', async () => {
    world = makeWorld()
    const opp = await withLineage(['lin-c1'], 'ready')
    expect(world.core.services.pipeline!.invalidateForChangedFacts(world.product.id, [])).toBe(0)
    expect(world.opportunity(opp.id).state).toBe('ready')

    world.core.services.pipeline!.invalidateForChangedFacts(world.product.id, ['lin-c1'])
    await world.core.router.call('opportunities.approve', { id: opp.id })
    expect(world.opportunity(opp.id).state).toBe('ready')
  })

  it('also applies to AI-drafted standalone publications built on the changed facts', async () => {
    world = makeWorld()
    world.engine.on(
      'draft.publication',
      JSON.stringify({ topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: null, rationale: 'from c1', usedClaimIds: ['c1'] })
    )
    const card = await world.core.router.call('publications.suggest', { channelId: world.channel.id })
    expect(card.draft?.usedClaimLineageIds).toEqual(['lin-c1'])

    // A standalone publication goes back to the draft state, where the owner reviews and approves it again.
    await world.core.router.call('opportunities.approve', { id: card.opportunity.id })
    expect(world.opportunity(card.opportunity.id).state).toBe('ready')
    expect(world.core.services.pipeline!.invalidateForChangedFacts(world.product.id, ['lin-c1'])).toBe(1)
    const after = world.opportunity(card.opportunity.id)
    expect(after.state).toBe('draft')
    expect(after.reason).toBe(FACTS_CHANGED_REASON)
    expect(world.card(after.id).approval).toBeNull()
  })
})

describe('attachment validation (REQ-003: only images the connector can verify)', () => {
  const save = (attachments: Attachment[]) =>
    (async () => {
      const opp = await world.newOpportunity()
      return world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'with image', attachments } })
    })()

  it('accepts real images and computes mime type and sha256 itself, ignoring what the caller claims', async () => {
    world = makeWorld()
    const path = imageFile('shot.PNG')
    const card = await save([{ name: 'shot.png', path, mime: '', sha256: 'forged' }])
    const [a] = card.draft!.attachments
    expect(a.mime).toBe('image/png')
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a.sha256).not.toBe('forged')
  })

  it.each([
    ['jpeg', 'p.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['gif', 'p.gif', Buffer.from('GIF89a')],
    ['webp', 'p.webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])]
  ])('accepts %s', async (_name, file, head) => {
    world = makeWorld()
    const card = await save([att(imageFile(file, head), file)])
    expect(card.draft?.attachments).toHaveLength(1)
  })

  it.each([
    ['a relative path', () => att('relative/shot.png'), /absolute/],
    ['a missing file', () => att(join(dir(), 'missing.png')), /cannot be read/],
    ['a directory', () => att((() => { const d = join(dir(), 'folder.png'); mkdirSync(d); return d })()), /not a file/],
    ['an empty file', () => att((() => { const p = join(dir(), 'empty.png'); writeFileSync(p, ''); return p })()), /empty/],
    ['a non-image extension', () => att(imageFile('notes.txt')), /only PNG/],
    ['a file renamed to look like an image', () => att(imageFile('fake.png', Buffer.from('<?php echo 1;'))), /not a valid image\/png/],
    ['a declared type that does not match', () => ({ ...att(imageFile('x.png')), mime: 'image/jpeg' }), /does not match/]
  ])('rejects %s', async (_name, make, message) => {
    world = makeWorld()
    await expect(save([make()])).rejects.toMatchObject({ code: 'invalid_attachment', message: expect.stringMatching(message) })
  })

  it('rejects a file over the size cap and more than ten files', async () => {
    world = makeWorld()
    const big = join(dir(), 'big.png')
    writeFileSync(big, Buffer.concat([PNG_HEAD, Buffer.alloc(ATTACHMENT_MAX_BYTES)]))
    await expect(save([att(big)])).rejects.toMatchObject({ code: 'invalid_attachment', message: expect.stringMatching(/larger than/) })
    const one = att(imageFile('one.png'))
    await expect(save(Array.from({ length: 11 }, () => one))).rejects.toMatchObject({ code: 'invalid_attachment', message: expect.stringMatching(/At most 10/) })
  })
})

describe('standalone publications (REQ-003 criterion 5)', () => {
  it('publications.create stores the owner\'s draft in the draft state and never as approved', async () => {
    world = makeWorld()
    const card = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: ' Launch ', text: ' We launched ', link: 'https://natalmystic.com' } })
    expect(card.opportunity.kind).toBe('standalone')
    expect(card.opportunity.state).toBe('draft')
    expect(card.opportunity.commentId).toBeNull()
    expect(card.draft).toMatchObject({ title: 'Launch', text: 'We launched', link: 'https://natalmystic.com', author: 'user' })
    expect(card.approval).toBeNull()
    expect(card.channelTarget).toBe(world.channel.target)
  })

  it('rejects an empty publication but accepts one that is only a link or only an image', async () => {
    world = makeWorld()
    await expect(world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: '' } })).rejects.toMatchObject({ code: 'invalid_input' })
    const link = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: '', link: 'https://natalmystic.com' } })
    expect(link.draft?.link).toBe('https://natalmystic.com')
    const image = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: 'x', attachments: [att(imageFile('only.png'))] } })
    expect(image.draft?.attachments).toHaveLength(1)
  })

  it('is always approved by the owner, and the approval is bound to the channel as its destination', async () => {
    world = makeWorld({ mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } })
    const created = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'Hi', text: 'There' } })
    const card = await world.core.router.call('opportunities.approve', { id: created.opportunity.id })
    expect(card.approval?.approvedBy).toBe('user')
    expect(card.approval?.destination).toBe(world.channel.url)
    expect(card.opportunity.state).toBe('ready')
  })

  it('suggest asks the AI with the approved knowledge and saves a labelled draft with its basis', async () => {
    world = makeWorld()
    world.engine.on('draft.publication', JSON.stringify({ topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: 'https://natalmystic.com', rationale: 'from c1', usedClaimIds: ['c1'] }))

    const card = await world.core.router.call('publications.suggest', { channelId: world.channel.id })

    expect(world.engine.calls.map((c) => c.label)).toEqual(['draft.publication'])
    expect(card.opportunity.kind).toBe('standalone')
    expect(card.opportunity.state).toBe('draft')
    expect(card.opportunity.reason).toMatch(/Suggested topic: Charts/)
    expect(card.draft).toMatchObject({ author: 'ai', title: 'How charts work', knowledgeVersionId: 'pv-1', usedClaimLineageIds: ['lin-c1'] })
    expect(card.approval).toBeNull()
    expect(world.connector.published).toHaveLength(0)
  })

  it('suggest refuses without approved knowledge, with an unavailable AI, with garbage, and with an unsafe suggestion', async () => {
    world = makeWorld()
    world.knowledge.approved = []
    await expect(world.core.router.call('publications.suggest', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'no_knowledge' })

    world.knowledge.approved = [makeClaim('c1', 'Natal Mystic builds a natal chart from your birth date, time and place.')]
    world.engine.installed = false
    await expect(world.core.router.call('publications.suggest', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'ai_unavailable' })

    world.engine.installed = true
    world.engine.on('draft.publication', 'no json here')
    await expect(world.core.router.call('publications.suggest', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'ai_invalid' })

    world.engine.on('draft.publication', JSON.stringify({ topic: 'Promo', title: 'Big sale', text: 'Everything is 50% off, free for a week!', link: null, rationale: 'x', usedClaimIds: ['c1'] }))
    await expect(world.core.router.call('publications.suggest', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'blocked', message: expect.stringMatching(/discount/) })
    world.engine.on('draft.publication', JSON.stringify({ topic: 'Generic', title: 'Hello', text: 'We are great.', link: null, rationale: 'x', usedClaimIds: [] }))
    await expect(world.core.router.call('publications.suggest', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'blocked', message: expect.stringMatching(/approved claim/) })

    expect(world.core.db.prepare('SELECT COUNT(*) c FROM opportunities').pluck().get()).toBe(0)
  })

  it('schedule sets and clears the planned time without approving anything', async () => {
    world = makeWorld()
    const created = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'B' } })
    const at = '2026-12-01T09:30:00+02:00'

    const scheduled = await world.core.router.call('publications.schedule', { id: created.opportunity.id, at })
    expect(scheduled.opportunity.scheduledAt).toBe('2026-12-01T07:30:00.000Z')
    expect(scheduled.opportunity.state).toBe('draft')
    expect(scheduled.approval).toBeNull()

    const cleared = await world.core.router.call('publications.schedule', { id: created.opportunity.id, at: null })
    expect(cleared.opportunity.scheduledAt).toBeNull()
  })

  it('schedule rejects an invalid date, a reply, and a publication that is already sent', async () => {
    world = makeWorld()
    const created = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'B' } })
    await expect(world.core.router.call('publications.schedule', { id: created.opportunity.id, at: 'next tuesday' })).rejects.toMatchObject({ code: 'invalid_input' })

    const reply = await world.newOpportunity()
    await expect(world.core.router.call('publications.schedule', { id: reply.id, at: '2026-12-01T10:00:00Z' })).rejects.toMatchObject({ code: 'invalid_state' })

    await world.core.router.call('opportunities.approve', { id: created.opportunity.id })
    await world.sending.send(created.opportunity.id)
    await expect(world.core.router.call('publications.schedule', { id: created.opportunity.id, at: null })).rejects.toMatchObject({ code: 'invalid_state' })
  })
})

describe('opportunities.list / get', () => {
  it('lists cards filtered by channel, kind and states, with the channel target and account label', async () => {
    world = makeWorld()
    const second = world.addChannel({ target: 'r/second' })
    const reply = await world.readyReply()
    const other = await world.readyReply({ channel: second })
    const post = await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: 'post' } })

    // Both channels read the same fake platform, so the second one also discovers the first one's comment.
    const ids = (cards: { opportunity: Opportunity }[]): string[] => cards.map((c) => c.opportunity.id).sort()
    const inDb = (sql: string, ...params: string[]): string[] => (world.core.db.prepare(sql).all(...params) as { id: string }[]).map((r) => r.id).sort()

    expect(ids(await world.core.router.call('opportunities.list', {}))).toEqual(inDb('SELECT id FROM opportunities'))
    expect(ids(await world.core.router.call('opportunities.list', { channelId: second.id }))).toEqual(inDb('SELECT id FROM opportunities WHERE channel_id = ?', second.id))
    expect(ids(await world.core.router.call('opportunities.list', { channelId: second.id }))).toContain(other.id)
    expect(ids(await world.core.router.call('opportunities.list', { kind: 'standalone' }))).toEqual([post.opportunity.id])
    const ready = ids(await world.core.router.call('opportunities.list', { states: ['ready'] }))
    expect(ready).toEqual([reply.id, other.id].sort())
    const card = await world.core.router.call('opportunities.get', { id: reply.id })
    expect(card.channelTarget).toBe(world.channel.target)
    expect(card.accountLabel).toBe('Main (brand_account)')
    expect(card.comment?.body).toBe('How does the natal chart work?')
  })

  it('the card of a reply shows the thread around the comment: ancestors and replies', async () => {
    world = makeWorld()
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'top', author: 'alice', body: 'top-level' })
    world.connector.addComment('d1', { externalId: 'mid', parentExternalId: 'top', author: 'bob', body: 'middle' })
    world.connector.addComment('d1', { externalId: 'leaf', parentExternalId: 'mid', author: 'carol', body: 'the one we answer' })
    world.connector.addComment('d1', { externalId: 'kid', parentExternalId: 'leaf', author: 'dave', body: 'a follow-up' })
    await world.monitor.runChannel(world.channel.id)
    const id = world.core.db.prepare("SELECT o.id FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE c.external_id = 'leaf'").pluck().get() as string

    const card = await world.core.router.call('opportunities.get', { id })

    expect(card.comment?.body).toBe('the one we answer')
    expect(card.thread.map((c) => c.body)).toEqual(['top-level', 'middle', 'a follow-up'])
    expect(card.discussion?.title).toBe('Post d1')
  })
})
