import { afterEach, describe, expect, it } from 'vitest'
import type { Channel, ChannelPlan, MixSetting } from '../../shared/types'
import { toJson } from '../db/database'
import { DEFAULT_PERIODIC, PeriodicTasks } from './scheduler-periodic'
import { RecordingSink } from './scheduler-harness'
import { DEFAULT_EVERY_DAYS, dueAtMs, MIX_RETRY_GAP_MS, MIX_WAITING_CAP, mixBlocker, proposalFromPlan } from './mix'
import { UPDATE_SYSTEM } from './draft-prompt'
import { numbersNotInNote } from './update-check'
import { closeWorld, makeClaim, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const DAY = 86_400_000
const POST = { topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'], disclosesConnection: false }
const UPDATE = { title: 'The birth time bug is fixed', text: 'I fixed the bug that put the birth time in the wrong place.', link: '', rationale: 'from the note', disclosesConnection: false, addsFactsBeyondNote: false }
const NOTE = 'Fixed the bug that put the birth time in the wrong place'

const mix = (...entries: Partial<MixSetting>[]): MixSetting[] => (entries.length > 0 ? entries : [{}]).map((e) => ({ kind: 'product_post', enabled: true, everyDays: 7, ...e }))
const withMix = (settings: MixSetting[]): void => world.setSettings(world.channel.id, { mix: settings })
const run = (): Promise<number> => world.core.services.mix!.runDue()
const drafts = (): { id: string; state: string; reason: string }[] =>
  world.core.db.prepare("SELECT id, state, reason FROM opportunities WHERE kind = 'standalone' ORDER BY rowid").all() as { id: string; state: string; reason: string }[]
const count = (table: string): number => (world.core.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

function script(label: 'draft.publication' | 'draft.update', value: Record<string, unknown>): void {
  world.engine.on(label, JSON.stringify(value))
}
const note = async (text = NOTE): Promise<string> => (await world.core.router.call('updates.add', { productId: world.product.id, text })).id

describe('when a draft of the mix is due', () => {
  it('prepares a draft of a post for the channel, and only a draft: nothing is approved, scheduled or sent', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix({ kind: 'product_post' }))
    expect(await run()).toBe(1)
    const [opp] = drafts()
    expect(opp).toMatchObject({ state: 'draft' })
    expect(opp.reason).toMatch(/^From your content mix\. Suggested topic: Charts/)
    expect(world.core.repos.latestDraft(opp.id)).toMatchObject({ author: 'ai', text: POST.text })
    expect(count('approvals')).toBe(0)
    expect(count('send_actions')).toBe(0)
    expect(world.connector.published).toHaveLength(0)
    expect(world.opportunity(opp.id).scheduledAt).toBeNull()
  })

  it('does nothing for a kind that is off, a channel with no mix, or a mix that is empty', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    expect(await run()).toBe(0)
    withMix(mix({ enabled: false }))
    expect(await run()).toBe(0)
    withMix([])
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(0)
  })

  it('waits for the rhythm of the kind, moved by a small steady jitter, and then prepares the next one', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix({ everyDays: 4 }))
    expect(await run()).toBe(1)
    // 4 days ± 10%: not yet after 3 days, due after 4.5
    world.clock.advance(3 * DAY)
    expect(await run()).toBe(0)
    world.clock.advance(1.5 * DAY)
    expect(await run()).toBe(1)
    expect(drafts()).toHaveLength(2)
  })

  it('moves the due time by the same amount for the same inputs, within 10 percent', () => {
    const last = '2026-11-08T12:00:00.000Z'
    const a = dueAtMs('ch1', 'own_update', 7, last)
    expect(dueAtMs('ch1', 'own_update', 7, last)).toBe(a)
    for (const kind of ['product_post', 'own_update', 'showcase'] as const) {
      for (const channel of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const at = dueAtMs(channel, kind, 10, last)
        expect(at).toBeGreaterThanOrEqual(Date.parse(last) + 9 * DAY - 1)
        expect(at).toBeLessThanOrEqual(Date.parse(last) + 11 * DAY + 1)
      }
    }
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((c) => dueAtMs(c, 'showcase', 10, last))).size).toBeGreaterThan(1)
    expect(dueAtMs('ch1', 'showcase', 30, null)).toBe(0)
  })

  it('prepares one draft per channel per scan, for the first kind that is due', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix({ kind: 'product_post' }, { kind: 'showcase' }))
    expect(await run()).toBe(1)
    expect(drafts()).toHaveLength(1)
    expect(await run()).toBe(1) // the next scan prepares the other kind
    expect(world.engine.calls).toHaveLength(2)
    expect(world.engine.calls[1].prompt).toMatch(/showcase/)
    expect(drafts()).toHaveLength(2)
  })
})

describe('what stops the mix', () => {
  it(`prepares nothing while ${MIX_WAITING_CAP} posts of the channel wait for the owner, and goes on when one is decided`, async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    for (let i = 0; i < MIX_WAITING_CAP; i += 1) await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: `Mine ${i}` } })
    withMix(mix())
    expect(await run()).toBe(0)
    const first = drafts()[0]!
    await world.core.router.call('opportunities.approve', { id: first.id })
    expect(await run()).toBe(1) // an approved post waits for a send, not for a decision
    expect(world.engine.calls).toHaveLength(1)
  })

  it('does not count replies that wait: they have their own queue', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    for (let i = 0; i < MIX_WAITING_CAP + 1; i += 1) {
      const reply = await world.newOpportunity({ commentId: `t1_wait${i}` })
      world.core.db.prepare("UPDATE opportunities SET state = 'awaiting_approval' WHERE id = ?").run(reply.id)
    }
    withMix(mix())
    expect(await run()).toBe(1)
    expect((await world.core.router.call('mix.get', { channelId: world.channel.id })).waiting).toBe(1)
  })

  it('does nothing while the owner has paused automation, and when it runs again prepares what is due', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix())
    const tasks = new PeriodicTasks(world.core, DEFAULT_PERIODIC, new RecordingSink())
    await tasks.reconcileAtStartup()
    const now = world.core.clock.now().getTime()
    tasks.tick(now, true)
    await tasks.idle()
    expect(drafts()).toHaveLength(0)
    tasks.tick(now + 1, false)
    await tasks.idle()
    expect(drafts()).toHaveLength(1)
  })

  it('does nothing before the uncertain sends of the last run were reconciled', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix())
    const tasks = new PeriodicTasks(world.core, DEFAULT_PERIODIC, new RecordingSink())
    tasks.tick(world.core.clock.now().getTime(), false)
    await tasks.idle()
    expect(drafts()).toHaveLength(0)
  })

  it('leaves an observe-only channel, a paused one, one that cannot publish and one that needs the owner alone', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix())
    world.setMode(world.channel.id, 'observe')
    expect(await run()).toBe(0)
    world.setMode(world.channel.id, 'approval')
    world.core.db.prepare("UPDATE channels SET status = 'paused' WHERE id = ?").run(world.channel.id)
    expect(await run()).toBe(0)
    world.core.db.prepare("UPDATE channels SET status = 'needs_user' WHERE id = ?").run(world.channel.id)
    expect(await run()).toBe(0)
    world.core.db.prepare("UPDATE channels SET status = 'active' WHERE id = ?").run(world.channel.id)
    const caps = world.channel.capabilities.map((c) => (c.key === 'publish_post' ? { ...c, status: 'restricted' } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), world.channel.id)
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(0)
    expect(mixBlocker(world.refresh())).toMatch(/restricted/)
  })

  it('does nothing when the account needs the owner to sign in', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix())
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(0)
  })

  it('does nothing when no AI engine is chosen', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix())
    world.core.settings.updateApp({ engineId: null })
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(0)
    expect(count('mix_state')).toBe(0) // not tried, so not a failed try either
  })

  it('does not try a post about the product while no fact is approved, and does not count that as a failure', async () => {
    world = makeWorld({ mode: 'approval', claims: [] })
    script('draft.publication', POST)
    withMix(mix({ kind: 'product_post' }, { kind: 'showcase' }))
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(0)
    expect(count('mix_state')).toBe(0)
    const card = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(card.kinds.find((k) => k.kind === 'product_post')?.problem).toMatch(/no approved facts/)
  })

  it('does not go on while a scan is still running', async () => {
    world = makeWorld({ mode: 'approval' })
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    world.engine.on('draft.publication', async () => {
      await gate
      return JSON.stringify(POST)
    })
    withMix(mix())
    const first = run()
    await new Promise((resolve) => setImmediate(resolve))
    expect(await run()).toBe(0)
    release()
    expect(await first).toBe(1)
    expect(world.engine.calls).toHaveLength(1)
  })
})

describe('a failed try', () => {
  it('is recorded and told, and is not repeated before the gap, then is tried again', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', { ...POST, text: 'Use the code SAVE and get 90% off.' })
    withMix(mix())
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(1)
    expect(drafts()).toHaveLength(0)
    const card = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(card.kinds[0]?.problem).toMatch(/last try failed.*safety checks/)
    expect(Date.parse(card.kinds[0]!.nextAt!)).toBeGreaterThanOrEqual(world.core.clock.now().getTime() + MIX_RETRY_GAP_MS - 1000)

    world.clock.advance(MIX_RETRY_GAP_MS - 60_000)
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(1)

    script('draft.publication', POST)
    world.clock.advance(120_000)
    expect(await run()).toBe(1)
    expect(world.engine.calls).toHaveLength(2)
    const after = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(after.kinds[0]?.problem).toBeNull()
  })
})

describe('an own update, written from the owner\'s note only', () => {
  it('waits for a note without trying, and does not call that a failure', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', UPDATE)
    withMix(mix({ kind: 'own_update' }))
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(0)
    expect(count('mix_state')).toBe(0)
    const card = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(card.kinds.find((k) => k.kind === 'own_update')?.problem).toMatch(/Waiting for a note/)
    expect(card.unusedUpdates).toBe(0)
  })

  it('writes a draft from the oldest unused note, marks the note used by it, and writes nothing from a note twice', async () => {
    world = makeWorld({ mode: 'approval' })
    world.setRole(world.account.id, { name: 'astrologer', voice: 'Plain and warm.' })
    script('draft.update', UPDATE)
    const first = await note()
    world.clock.advance(1000)
    await note('Started a newsletter')
    withMix(mix({ kind: 'own_update', everyDays: 1 }))
    expect(await run()).toBe(1)
    const [opp] = drafts()
    expect(opp.state).toBe('draft')
    expect(opp.reason).toMatch(/^From your content mix\. Own update, from your note: "Fixed the bug/)
    expect(world.core.repos.latestDraft(opp.id)).toMatchObject({ author: 'ai', text: UPDATE.text, usedClaimLineageIds: [] })
    const notes = await world.core.router.call('updates.list', { productId: world.product.id })
    expect(notes.find((n) => n.id === first)?.usedInOpportunityId).toBe(opp.id)
    expect(notes.filter((n) => n.usedInOpportunityId === null)).toHaveLength(1)
    // the prompt carries the note, the role and the rule; it carries no claim to rest on
    const prompt = world.engine.calls[0].prompt
    expect(world.engine.calls[0].system).toBe(UPDATE_SYSTEM)
    expect(prompt).toContain(NOTE)
    expect(prompt).toContain('astrologer')
    expect(prompt).not.toContain('Newsletter')
    expect(prompt).not.toContain('birth date, time and place')
    // the next one waits for its day, and then uses the other note
    world.clock.advance(2 * DAY)
    expect(await run()).toBe(1)
    expect(world.engine.calls[1].prompt).toContain('Started a newsletter')
    world.clock.advance(2 * DAY)
    expect(await run()).toBe(0) // no unused note left
    expect(world.engine.calls).toHaveLength(2)
  })

  it('tells the AI who writes, from the profile of the login: what the person is about and what the person is for', async () => {
    world = makeWorld({ mode: 'approval' })
    world.core.db
      .prepare(
        `INSERT INTO profiles (id, label, product_id, role_name, role_voice, platforms_json, purpose, strategy, first_name, last_name, display_name, username, birth_date, gender, place, about, website, picture_idea, reasons_json, picture_file, status, created_at, updated_at)
         VALUES ('p1', 'Mara', ?, 'astrologer', 'Warm.', '[]', 'Show real charts to curious people', '', 'Mara', 'K', 'Mara K', 'mara', '1990-01-01', 'female', 'Lisbon', 'I read charts for fun and build tools for it.', '', '', '{}', NULL, 'ready', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
      )
      .run(world.product.id)
    world.core.db.prepare('UPDATE accounts SET profile_id = ? WHERE id = ?').run('p1', world.account.id)
    script('draft.update', UPDATE)
    await note()
    withMix(mix({ kind: 'own_update' }))
    expect(await run()).toBe(1)
    const prompt = world.engine.calls[0].prompt
    expect(prompt).toContain('I read charts for fun and build tools for it.')
    expect(prompt).toContain('Show real charts to curious people')
    expect(prompt).toContain('Mara K')
  })

  const refused: [string, Record<string, unknown>, RegExp][] = [
    ['a number the note does not contain', { text: 'I fixed the birth time bug that hit 1200 users.' }, /number the note does not contain \(1200\)/],
    ['an address the note does not contain', { text: 'I fixed the birth time bug, details on https://elsewhere.example.com/post.' }, /elsewhere\.example\.com/],
    ['a link the note does not contain, in the link field', { link: 'https://elsewhere.example.com' }, /elsewhere\.example\.com/],
    ['a fact the model says it added', { addsFactsBeyondNote: true }, /something the note does not/],
    ['a price', { text: 'I fixed the birth time bug. It costs $9 a month.' }, /price/],
    ['a discount', { text: 'I fixed the birth time bug, and there is 20% off today.' }, /discount|number/],
    ['a credential', { text: 'I fixed the birth time bug. The password: hunter2 works.' }, /credential/]
  ]
  for (const [name, bad, reason] of refused) {
    it(`refuses ${name}, keeps the note unused and records the failure`, async () => {
      world = makeWorld({ mode: 'approval' })
      script('draft.update', { ...UPDATE, ...bad })
      const id = await note()
      withMix(mix({ kind: 'own_update' }))
      expect(await run()).toBe(0)
      expect(drafts()).toHaveLength(0)
      expect((await world.core.router.call('updates.list', { productId: world.product.id })).find((n) => n.id === id)?.usedInOpportunityId).toBeNull()
      const card = await world.core.router.call('mix.get', { channelId: world.channel.id })
      expect(card.kinds.find((k) => k.kind === 'own_update')?.problem).toMatch(reason)
    })
  }

  it('never states a price in an own update, even when the note and an approved fact name it: a price is for the posts that cite their fact', async () => {
    world = makeWorld({ mode: 'approval', claims: [makeClaim('c1', 'The plan costs $9 a month.')] })
    script('draft.update', { ...UPDATE, text: 'I lowered the price to $9 a month.' })
    await note('Lowered the price to $9 a month')
    withMix(mix({ kind: 'own_update' }))
    expect(await run()).toBe(0)
    expect(drafts()).toHaveLength(0)
    expect((await world.core.router.call('mix.get', { channelId: world.channel.id })).kinds.find((k) => k.kind === 'own_update')?.problem).toMatch(/price/)
  })

  it('lets the note\'s own numbers and address through, and the product\'s own site', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', { ...UPDATE, text: 'Version 2.1 is out: details on https://github.com/owner/repo, product at https://natalmystic.com.', link: 'https://github.com/owner/repo' })
    await note('Released version 2.1, notes at https://github.com/owner/repo')
    withMix(mix({ kind: 'own_update' }))
    expect(await run()).toBe(1)
  })

  it('says that the author is connected, in the card, when the post names the product without it (as for any post), and the approval still refuses it', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', { ...UPDATE, text: 'Natal Mystic now keeps the birth time where it belongs.', disclosesConnection: false })
    await note()
    withMix(mix({ kind: 'own_update' }))
    expect(await run()).toBe(1)
    const [opp] = drafts()
    expect(opp.reason).toMatch(/connected|connection/i)
    await expect(world.core.router.call('opportunities.approve', { id: opp.id })).rejects.toMatchObject({ code: expect.any(String) })
    expect(count('approvals')).toBe(0)
  })

  it('does not write from a note of another product, nor from a note that was used already, when asked directly', async () => {
    world = makeWorld({ mode: 'approval' })
    const other = world.addProduct('Other')
    const foreign = (await world.core.router.call('updates.add', { productId: other.id, text: 'Something else' })).id
    script('draft.update', UPDATE)
    const mine = await note()
    const flow = (await import('./publications')).PublicationsFlow
    const publications = new flow(world.core, world.store)
    await expect(publications.suggestUpdate(world.channel.id, foreign)).rejects.toMatchObject({ code: 'not_found' })
    await publications.suggestUpdate(world.channel.id, mine)
    await expect(publications.suggestUpdate(world.channel.id, mine)).rejects.toMatchObject({ code: 'invalid_state' })
    expect(drafts()).toHaveLength(1)
    expect(world.engine.calls).toHaveLength(1) // the second was refused before the AI was asked
  })

  it('writes one post from a note when two are asked for at once: the second finds the note taken', async () => {
    world = makeWorld({ mode: 'approval' })
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    world.engine.on('draft.update', async () => {
      await gate
      return JSON.stringify(UPDATE)
    })
    const mine = await note()
    const publications = new (await import('./publications')).PublicationsFlow(world.core, world.store)
    const first = publications.suggestUpdate(world.channel.id, mine).catch((e: unknown) => e)
    const second = publications.suggestUpdate(world.channel.id, mine).catch((e: unknown) => e)
    await new Promise((resolve) => setImmediate(resolve))
    release()
    const outcomes = await Promise.all([first, second])
    expect(outcomes.filter((o) => o instanceof Error)).toHaveLength(1)
    expect(outcomes.find((o) => o instanceof Error)).toMatchObject({ code: 'invalid_state' })
    expect(drafts()).toHaveLength(1)
  })

  it('sets a note aside after three failed tries, goes on with the next one, and says so when none is left', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', { ...UPDATE, text: 'I fixed it for 5000 people.' })
    const stuck = await note('Cut the price')
    world.clock.advance(1000)
    const later = await note('Started a newsletter')
    withMix(mix({ kind: 'own_update', everyDays: 1 }))
    for (let i = 0; i < 3; i += 1) {
      expect(await run()).toBe(0)
      world.clock.advance(MIX_RETRY_GAP_MS + 1000)
    }
    expect(world.engine.calls).toHaveLength(3)
    expect((await world.core.router.call('updates.list', { productId: world.product.id })).find((n) => n.id === stuck)?.failedTries).toBe(3)
    // the oldest note is set aside: the next one is used
    script('draft.update', { ...UPDATE, text: 'I started a newsletter.' })
    expect(await run()).toBe(1)
    expect(world.engine.calls[3].prompt).toContain('Started a newsletter')
    expect(world.engine.calls[3].prompt).not.toContain('Cut the price')
    const notes = await world.core.router.call('updates.list', { productId: world.product.id })
    expect(notes.find((n) => n.id === later)?.usedInOpportunityId).not.toBeNull()
    // only the one that was set aside is left: nothing is tried, and the card says why
    world.clock.advance(2 * DAY)
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(4)
    const card = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(card.unusedUpdates).toBe(0)
    expect(card.kinds.find((k) => k.kind === 'own_update')?.problem).toMatch(/could not make a post from a note/)
  })
})

describe('numbers of a post against its note', () => {
  it('finds the numbers that the note does not contain, and reads 1,5 and 1.5 as one', () => {
    expect(numbersNotInNote('I fixed 3 bugs in 2 days, version 2.1.', 'Fixed 3 bugs, version 2.1')).toEqual(['2'])
    expect(numbersNotInNote('It takes 1,5 seconds.', 'It takes 1.5 seconds')).toEqual([])
    expect(numbersNotInNote('No numbers here.', 'Nothing')).toEqual([])
    expect(numbersNotInNote('12 and 12 and 13', 'none')).toEqual(['12', '13'])
  })
})

describe('the card of the mix', () => {
  it('shows each kind with when the next draft is due, what waits and what is unused', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    await note()
    withMix(mix({ kind: 'product_post', everyDays: 10 }, { kind: 'own_update', enabled: false, everyDays: 3 }))
    const before = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(before.kinds.map((k) => [k.kind, k.enabled, k.everyDays])).toEqual([
      ['product_post', true, 10],
      ['own_update', false, 3],
      ['showcase', false, DEFAULT_EVERY_DAYS.showcase]
    ])
    expect(before.kinds[0]?.lastDraftAt).toBeNull()
    expect(before.kinds[0]?.nextAt).toBe(world.core.clock.now().toISOString()) // starts at once
    expect(before.kinds[1]?.nextAt).toBeNull()
    expect(before).toMatchObject({ waiting: 0, cap: MIX_WAITING_CAP, unusedUpdates: 1, blocked: null })
    await run()
    const after = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(after.kinds[0]?.lastDraftAt).toBe(world.core.clock.now().toISOString())
    expect(Date.parse(after.kinds[0]!.nextAt!)).toBeGreaterThan(world.core.clock.now().getTime() + 8 * DAY)
    expect(after.waiting).toBe(1)
    world.setMode(world.channel.id, 'observe')
    expect((await world.core.router.call('mix.get', { channelId: world.channel.id })).blocked).toMatch(/only watches/)
    world.setMode(world.channel.id, 'approval')
    world.core.db.prepare("UPDATE channels SET status = 'paused' WHERE id = ?").run(world.channel.id)
    expect((await world.core.router.call('mix.get', { channelId: world.channel.id })).blocked).toMatch(/paused/)
  })

  it('says how many posts wait when the cap is reached', async () => {
    world = makeWorld({ mode: 'approval' })
    for (let i = 0; i < MIX_WAITING_CAP; i += 1) await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: `Mine ${i}` } })
    withMix(mix())
    const card = await world.core.router.call('mix.get', { channelId: world.channel.id })
    expect(card.kinds[0]?.problem).toBe(`${MIX_WAITING_CAP} posts of this channel are waiting for you.`)
  })
})

describe('the mix is saved with the channel settings', () => {
  it('accepts a valid mix and refuses a kind it does not know, a kind twice, a rhythm out of range and an unknown field', async () => {
    world = makeWorld({ mode: 'approval' })
    const save = (m: unknown): Promise<Channel> => world.core.router.call('channels.updateSettings', { channelId: world.channel.id, settings: { mix: m } as never })
    const saved = await save(mix({ kind: 'own_update', everyDays: 7 }, { kind: 'showcase', enabled: false, everyDays: 30 }))
    expect(saved.settings.mix).toEqual([
      { kind: 'own_update', enabled: true, everyDays: 7 },
      { kind: 'showcase', enabled: false, everyDays: 30 }
    ])
    for (const bad of [[{ kind: 'sell', enabled: true, everyDays: 3 }], [{ kind: 'showcase', enabled: true, everyDays: 3 }, { kind: 'showcase', enabled: true, everyDays: 4 }], [{ kind: 'showcase', enabled: true, everyDays: 0 }], [{ kind: 'showcase', enabled: true, everyDays: 91 }], [{ kind: 'showcase', enabled: true, everyDays: 2.5 }], [{ kind: 'showcase', enabled: 'yes', everyDays: 3 }], [{ kind: 'showcase', enabled: true, everyDays: 3, extra: 1 }], 'weekly']) {
      await expect(save(bad)).rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(world.refresh().settings.mix).toHaveLength(2)
  })
})

describe('the proposal of a mix', () => {
  const plan = (steps: ChannelPlan['steps']): ChannelPlan => ({ generatedAt: '2026-11-08T12:00:00.000Z', engineId: 'claude', summary: 's', steps, watchOut: [] })
  const step = (extra: Record<string, unknown>) => ({ title: 'T', detail: 'D', format: 'text' as const, youPrepare: null, frequency: null, ...extra })

  it('takes the first step of each kind a post can have, with its rhythm, and leaves out replies and what has no kind', () => {
    expect(
      proposalFromPlan(
        plan([step({ kind: 'replies', everyDays: 1 }), step({ kind: 'own_update', everyDays: 5 }), step({ kind: 'own_update', everyDays: 9 }), step({ kind: 'showcase' }), step({ kind: null }), step({})])
      )
    ).toEqual([
      { kind: 'own_update', enabled: true, everyDays: 5 },
      { kind: 'showcase', enabled: true, everyDays: DEFAULT_EVERY_DAYS.showcase }
    ])
    expect(proposalFromPlan(null)).toEqual([])
  })

  it('uses the plan of the channel when it has a rhythm, saves nothing and asks the AI for nothing', async () => {
    world = makeWorld({ mode: 'approval' })
    world.core.db.prepare('UPDATE channels SET plan_json = ? WHERE id = ?').run(toJson(plan([step({ kind: 'product_post', everyDays: 12 })])), world.channel.id)
    const proposal = await world.core.router.call('mix.propose', { channelId: world.channel.id })
    expect(proposal).toEqual([{ kind: 'product_post', enabled: true, everyDays: 12 }])
    expect(world.refresh().settings.mix).toEqual([])
    expect(world.engine.calls).toHaveLength(0)
  })

  it('plans the channel first when the plan has no rhythm, and refuses when even that gives none', async () => {
    world = makeWorld({ mode: 'approval' })
    let prepared = 0
    world.core.services.channels = {
      markCapabilityVerified: () => undefined,
      preparePlan: async (channelId) => {
        prepared += 1
        world.core.db.prepare('UPDATE channels SET plan_json = ? WHERE id = ?').run(toJson(plan([step({ kind: 'own_update', everyDays: 6 })])), channelId)
        return world.refresh()
      }
    }
    expect(await world.core.router.call('mix.propose', { channelId: world.channel.id })).toEqual([{ kind: 'own_update', enabled: true, everyDays: 6 }])
    expect(prepared).toBe(1)
    world.core.db.prepare('UPDATE channels SET plan_json = NULL WHERE id = ?').run(world.channel.id)
    world.core.services.channels = { markCapabilityVerified: () => undefined, preparePlan: async () => world.refresh() }
    await expect(world.core.router.call('mix.propose', { channelId: world.channel.id })).rejects.toMatchObject({ code: 'no_proposal' })
  })
})

describe('the notes', () => {
  it('adds a note as a line, lists the newest first, and removes a note that was not used', async () => {
    world = makeWorld({ mode: 'approval' })
    const a = await world.core.router.call('updates.add', { productId: world.product.id, text: '  Fixed   the\nbug  ' })
    expect(a.text).toBe('Fixed the bug')
    world.clock.advance(1000)
    await world.core.router.call('updates.add', { productId: world.product.id, text: 'Second' })
    expect((await world.core.router.call('updates.list', { productId: world.product.id })).map((n) => n.text)).toEqual(['Second', 'Fixed the bug'])
    await world.core.router.call('updates.remove', { id: a.id })
    expect(await world.core.router.call('updates.list', { productId: world.product.id })).toHaveLength(1)
  })

  it('refuses an empty note, a long one, a product that does not exist, and removing a note a post was written from', async () => {
    world = makeWorld({ mode: 'approval' })
    await expect(world.core.router.call('updates.add', { productId: world.product.id, text: '   ' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(world.core.router.call('updates.add', { productId: world.product.id, text: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(world.core.router.call('updates.add', { productId: 'nope', text: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    script('draft.update', UPDATE)
    const id = await note()
    withMix(mix({ kind: 'own_update' }))
    await run()
    await expect(world.core.router.call('updates.remove', { id })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(world.core.router.call('updates.remove', { id: 'nope' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('the ask for a note, in the attention list', () => {
  const asks = async (): Promise<string[]> => (await world.core.router.call('attention.list', undefined)).filter((i) => i.id.startsWith('note:')).map((i) => i.title)

  it('asks what is new when an own update is due and no note is left, and stops asking when a note exists', async () => {
    world = makeWorld({ mode: 'approval' })
    withMix(mix({ kind: 'own_update', everyDays: 7 }))
    expect(await asks()).toEqual([`Tell what is new for ${world.channel.target}`])
    const item = (await world.core.router.call('attention.list', undefined)).find((i) => i.id.startsWith('note:'))
    expect(item).toMatchObject({ kind: 'question', refType: 'channel', refId: world.channel.id })
    await note()
    expect(await asks()).toEqual([])
  })

  it('does not ask when the kind is off, the channel cannot work, 3 posts already wait, or the next update is not due yet', async () => {
    world = makeWorld({ mode: 'approval' })
    withMix(mix({ kind: 'own_update', enabled: false }))
    expect(await asks()).toEqual([])
    withMix(mix({ kind: 'own_update' }))
    world.setMode(world.channel.id, 'observe')
    expect(await asks()).toEqual([])
    world.setMode(world.channel.id, 'approval')
    world.core.db.prepare("INSERT INTO mix_state (channel_id, kind, last_draft_at, last_attempt_at, last_error) VALUES (?, 'own_update', ?, ?, NULL)").run(world.channel.id, world.core.clock.now().toISOString(), world.core.clock.now().toISOString())
    expect(await asks()).toEqual([])
    world.clock.advance(8 * DAY)
    expect(await asks()).toHaveLength(1)
    for (let i = 0; i < MIX_WAITING_CAP; i += 1) await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { text: `Mine ${i}` } })
    expect(await asks()).toEqual([])
  })

  it('is found by the job too: a scan that finds a note missing tells the attention list to look again', async () => {
    world = makeWorld({ mode: 'approval' })
    withMix(mix({ kind: 'own_update' }))
    let told = 0
    world.core.events.subscribe((event) => {
      if (event.type === 'changed' && event.scope === 'channels') told += 1
    })
    expect(await run()).toBe(0)
    expect(told).toBeGreaterThan(0)
  })
})

describe('what the mix can never do', () => {
  it('leaves every post it prepares as a draft through many scans: no approval, no send, nothing published, nothing scheduled', async () => {
    world = makeWorld({ mode: 'auto' })
    script('draft.publication', POST)
    script('draft.update', UPDATE)
    for (let i = 0; i < 6; i += 1) await note(`Did thing ${i}`)
    withMix(mix({ kind: 'product_post', everyDays: 1 }, { kind: 'own_update', everyDays: 1 }, { kind: 'showcase', everyDays: 1 }))
    for (let i = 0; i < 12; i += 1) {
      world.clock.advance(2 * DAY)
      await run()
      for (const opp of drafts()) await world.core.router.call('opportunities.reject', { id: opp.id, reason: 'x' }).catch(() => undefined)
    }
    expect(world.engine.calls.length).toBeGreaterThan(3)
    expect(count('approvals')).toBe(0)
    expect(count('send_actions')).toBe(0)
    expect(world.connector.published).toHaveLength(0)
    expect((world.core.db.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE scheduled_at IS NOT NULL").get() as { n: number }).n).toBe(0)
    expect((world.core.db.prepare("SELECT DISTINCT state FROM opportunities").all() as { state: string }[]).map((r) => r.state).sort()).toEqual(['cancelled'])
  })
})
