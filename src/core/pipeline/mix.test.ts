import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Channel, ChannelPlan, MixSetting } from '../../shared/types'
import { toJson } from '../db/database'
import { DEFAULT_PERIODIC, PeriodicTasks } from './scheduler-periodic'
import { RecordingSink } from './scheduler-harness'
import { DEFAULT_EVERY_DAYS, dueAtMs, MIX_RETRY_GAP_MS, MIX_RETRY_MAX_MS, MIX_WAITING_CAP, mixBlocker, proposalFromPlan, retryAtMs, retryGapMs } from './mix'
import { UPDATE_SYSTEM } from './draft-prompt'
import { addressesNotInNote, numbersNotInNote } from './update-check'
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
    const later = Date.parse(last) + 100 * DAY
    const a = dueAtMs('ch1', 'own_update', 7, last, later)
    expect(dueAtMs('ch1', 'own_update', 7, last, later)).toBe(a)
    for (const kind of ['product_post', 'own_update', 'showcase'] as const) {
      for (const channel of ['a', 'b', 'c', 'd', 'e', 'f']) {
        const at = dueAtMs(channel, kind, 10, last, later)
        expect(at).toBeGreaterThanOrEqual(Date.parse(last) + 9 * DAY - 1)
        expect(at).toBeLessThanOrEqual(Date.parse(last) + 11 * DAY + 1)
      }
    }
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((c) => dueAtMs(c, 'showcase', 10, last, later))).size).toBeGreaterThan(1)
    expect(dueAtMs('ch1', 'showcase', 30, null, later)).toBe(0)
  })

  it('counts a last draft that lies in the future (the clock was set back) as now, so a kind never waits for months', () => {
    const now = Date.parse('2026-11-15T12:00:00.000Z')
    const future = new Date(now + 200 * DAY).toISOString()
    const at = dueAtMs('ch1', 'own_update', 7, future, now)
    expect(at).toBeLessThanOrEqual(now + 7.7 * DAY)
    expect(at).toBeGreaterThanOrEqual(now + 6.3 * DAY)
    expect(retryAtMs(future, 1, now)).toBe(now + retryGapMs(1))
  })

  it('waits longer after each failure in a row, up to a day', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => retryGapMs(n) / 3_600_000)).toEqual([3, 6, 12, 24, 24, 24])
    expect(retryGapMs(1)).toBe(MIX_RETRY_GAP_MS)
    expect(retryGapMs(50)).toBe(MIX_RETRY_MAX_MS)
    expect(retryAtMs(null, 3, 1000)).toBe(0)
    expect(retryAtMs('2026-11-15T12:00:00.000Z', 0, Date.parse('2026-11-16T00:00:00.000Z'))).toBe(0)
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

  it('prepares at most one draft per channel per scan when there are several channels, one for each', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    const other = world.addChannel({ target: 'r/second', mode: 'approval', settings: { mix: mix({ kind: 'product_post' }, { kind: 'showcase' }) } })
    withMix(mix({ kind: 'product_post' }, { kind: 'showcase' }))
    expect(await run()).toBe(2)
    const perChannel = world.core.db.prepare("SELECT channel_id, COUNT(*) AS n FROM opportunities WHERE kind = 'standalone' GROUP BY channel_id").all() as { channel_id: string; n: number }[]
    expect(perChannel.map((r) => r.n)).toEqual([1, 1])
    expect(perChannel.map((r) => r.channel_id).sort()).toEqual([world.channel.id, other.id].sort())
  })

  it('serves the kind that has waited longest, so a short rhythm does not starve the others when one slot is free', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    script('draft.update', UPDATE)
    await note()
    withMix(mix({ kind: 'product_post', everyDays: 1 }, { kind: 'own_update', everyDays: 7 }))
    expect(await run()).toBe(1) // never drafted, in the order of the list: the post about the product
    world.core.db.prepare("UPDATE opportunities SET state = 'cancelled'").run() // the owner decided: the slot is free
    world.clock.advance(2 * DAY) // the post about the product is due again; the update never was drafted
    expect(await run()).toBe(1)
    expect(drafts().map((d) => /Own update/.test(d.reason))).toEqual([false, true])
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

  it('does nothing before the uncertain sends of the last run were reconciled, and prepares what is due once they were', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix())
    const tasks = new PeriodicTasks(world.core, DEFAULT_PERIODIC, new RecordingSink())
    const start = world.core.clock.now().getTime()
    tasks.tick(start, false) // the gate is closed: only the reconciliation starts
    await tasks.idle()
    expect(drafts()).toHaveLength(0)
    expect(tasks.gateOpen).toBe(true)
    tasks.tick(start + 1000, false)
    await tasks.idle()
    expect(drafts()).toHaveLength(1)
  })

  it('stays quiet for good while the reconciliation keeps failing', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    withMix(mix())
    vi.spyOn(world.core.services.sending!, 'reconcileAllUnknown').mockRejectedValue(new Error('the platform is not reachable'))
    const tasks = new PeriodicTasks(world.core, DEFAULT_PERIODIC, new RecordingSink())
    const start = world.core.clock.now().getTime()
    for (let i = 0; i < 6; i += 1) {
      tasks.tick(start + i * 10 * 60_000, false)
      await tasks.idle()
    }
    expect(tasks.gateOpen).toBe(false)
    expect(drafts()).toHaveLength(0)
    expect(world.engine.calls).toHaveLength(0)
  })

  it('looks again after the clock was set back instead of waiting for the old next scan', async () => {
    world = makeWorld({ mode: 'approval' })
    withMix(mix())
    const scans = vi.spyOn(world.core.services.mix!, 'runDue').mockResolvedValue(0)
    const tasks = new PeriodicTasks(world.core, DEFAULT_PERIODIC, new RecordingSink())
    const start = world.core.clock.now().getTime()
    tasks.tick(start, false)
    await tasks.idle()
    tasks.tick(start + 1000, false)
    await tasks.idle()
    expect(scans).toHaveBeenCalledTimes(1)
    tasks.tick(start + 2000, false) // not yet the next scan
    await tasks.idle()
    expect(scans).toHaveBeenCalledTimes(1)
    tasks.tick(start - 30 * DAY, false) // the clock was set back a month
    await tasks.idle()
    expect(scans).toHaveBeenCalledTimes(2)
  })

  for (const [what, stopIt] of [
    ['automation is paused', (tasks: PeriodicTasks, at: number) => tasks.tick(at, true)],
    ['the app is closing', (tasks: PeriodicTasks) => tasks.halt()]
  ] as const) {
    it(`ends a scan that the scheduler runs, between channels, when ${what}`, async () => {
      world = makeWorld({ mode: 'approval' })
      world.addChannel({ target: 'r/second', mode: 'approval', settings: { mix: mix() } })
      withMix(mix())
      const tasks = new PeriodicTasks(world.core, DEFAULT_PERIODIC, new RecordingSink())
      const start = world.core.clock.now().getTime()
      world.engine.on('draft.publication', async () => {
        stopIt(tasks, start + 5000) // while the first channel is being written
        return JSON.stringify(POST)
      })
      tasks.tick(start, false)
      await tasks.idle()
      tasks.tick(start + 1000, false)
      await tasks.idle()
      expect(world.engine.calls).toHaveLength(1)
      expect(drafts()).toHaveLength(1)
    })
  }

  it('ends a scan between channels when automation is paused or the app is closing', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', POST)
    world.addChannel({ target: 'r/second', mode: 'approval', settings: { mix: mix() } })
    withMix(mix())
    expect(await world.core.services.mix!.runDue(() => true)).toBe(0)
    expect(world.engine.calls).toHaveLength(0)
    let asked = 0
    expect(await world.core.services.mix!.runDue(() => (asked += 1) > 1)).toBe(1) // it may start the first channel, not the second
    expect(drafts()).toHaveLength(1)
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

  it('does not treat the mode "observe" as a reason to stop on a channel the app does not read: it has no replies to watch (DEC-034)', async () => {
    world = makeWorld({ mode: 'observe', baselineDone: false })
    const own = world.addChannel({ reads: false, mode: 'observe', target: '@brand' })
    script('draft.publication', POST)
    world.core.db.prepare('UPDATE channels SET settings_json = ? WHERE id = ?').run(toJson({ ...own.settings, mix: mix() }), own.id)
    expect(mixBlocker(world.refresh(own))).toBeNull()
    expect(await run()).toBe(1)
    expect(drafts()).toHaveLength(1)
    // The same mode on a channel the app reads still means "only watches".
    const read = world.addChannel({ reads: true, mode: 'observe', target: 'r/read' })
    expect(mixBlocker(world.refresh(read))).toMatch(/only watches/)
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

  it('waits twice as long after the second failure in a row, and starts again from the short wait after a success', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.publication', { ...POST, text: 'Use the code SAVE and get 90% off.' })
    withMix(mix())
    expect(await run()).toBe(0)
    world.clock.advance(MIX_RETRY_GAP_MS + 1000)
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(2)
    world.clock.advance(MIX_RETRY_GAP_MS + 1000) // 3 hours is not enough any more
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(2)
    script('draft.publication', POST)
    world.clock.advance(MIX_RETRY_GAP_MS)
    expect(await run()).toBe(1)
    expect((world.core.db.prepare('SELECT failures FROM mix_state').get() as { failures: number }).failures).toBe(0)
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
         VALUES ('p1', 'Mara', ?, 'astrologer', 'Warm.', '[]', 'Show real charts to curious people', '', 'Mara', 'K', 'Mara K', 'mara', '1990-01-01', 'female', 'Lisbon', 'I read charts for fun and build tools for it.', '', '', '{}', NULL, 'approved', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
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

  it('does not tell the AI what a profile says that the owner has not approved', async () => {
    world = makeWorld({ mode: 'approval' })
    world.core.db
      .prepare(
        `INSERT INTO profiles (id, label, product_id, role_name, role_voice, platforms_json, purpose, strategy, first_name, last_name, display_name, username, birth_date, gender, place, about, website, picture_idea, reasons_json, picture_file, status, created_at, updated_at)
         VALUES ('p2', 'Mara', ?, 'astrologer', 'Warm.', '[]', 'A purpose nobody has read', '', 'Mara', 'K', 'Mara K', 'mara', '1990-01-01', 'female', 'Lisbon', 'A biography nobody has read.', '', '', '{}', NULL, 'proposed', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
      )
      .run(world.product.id)
    world.core.db.prepare('UPDATE accounts SET profile_id = ? WHERE id = ?').run('p2', world.account.id)
    script('draft.update', UPDATE)
    await note()
    withMix(mix({ kind: 'own_update' }))
    expect(await run()).toBe(1)
    expect(world.engine.calls[0].prompt).not.toContain('A biography nobody has read.')
    expect(world.engine.calls[0].prompt).not.toContain('A purpose nobody has read')
  })

  const refused: [string, Record<string, unknown>, RegExp, string?][] = [
    ['a number the note does not contain', { text: 'I fixed the birth time bug that hit 1200 users.' }, /number the note does not contain \(1200\)/],
    ['an address the note does not contain', { text: 'I fixed the birth time bug, details on https://elsewhere.example.com/post.' }, /elsewhere\.example\.com/],
    ['a link the note does not contain, in the link field', { link: 'https://elsewhere.example.com' }, /elsewhere\.example\.com/],
    ['a fact the model says it added', { addsFactsBeyondNote: true }, /something the note does not/],
    ['a price', { text: 'I fixed the birth time bug. It costs $9 a month.' }, /price/],
    ['a discount, though the note names the number', { text: 'I fixed the birth time bug, and there is 20% off today.' }, /discount/, `${NOTE}, 20 of them`],
    ['a number written in words', { text: 'I fixed the birth time bug that hit two thousand people.' }, /numbers? the note does not contain \(two, thousand\)/],
    ['a number written in other digits', { text: 'I fixed the birth time bug for ٣٠٠ people.' }, /number the note does not contain/],
    ['a fraction', { text: 'I fixed the birth time bug in ½ of the charts.' }, /number the note does not contain/],
    ['an address on the note\'s host that the note does not give', { text: `${NOTE}. See https://github.com/someone-else/malware.`, link: null }, /someone-else\/malware/, `${NOTE}, code at https://github.com/owner/repo`],
    ['an address on the note\'s host in the link field that the note does not give', { link: 'https://github.com/someone-else/malware' }, /someone-else\/malware/, `${NOTE}, code at https://github.com/owner/repo`],
    ['an answer that does not say whether it added anything', { addsFactsBeyondNote: undefined }, /something the note does not/],
    ['a credential', { text: 'I fixed the birth time bug. The password: hunter2 works.' }, /credential/]
  ]
  for (const [name, bad, reason, text] of refused) {
    it(`refuses ${name}, keeps the note unused and records the failure`, async () => {
      world = makeWorld({ mode: 'approval' })
      script('draft.update', { ...UPDATE, ...bad })
      const id = await note(text)
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

  it('does not hold it against the note when the AI itself fails, and ends the scan: the other channels would meet the same', async () => {
    world = makeWorld({ mode: 'approval' })
    world.engine.on('draft.update', async () => {
      throw new Error('the engine is not running')
    })
    const mine = await note()
    world.clock.advance(1000)
    await note('Started a newsletter') // a second note: a channel that went on would write from it
    withMix(mix({ kind: 'own_update' }))
    world.addChannel({ target: 'r/second', mode: 'approval', settings: { mix: mix({ kind: 'own_update' }) } })
    world.addChannel({ target: 'r/third', mode: 'approval', settings: { mix: mix({ kind: 'own_update' }) } })
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(1)
    const row = (await world.core.router.call('updates.list', { productId: world.product.id })).find((n) => n.id === mine)
    expect(row?.failedTries).toBe(0)
    expect(row?.usedInOpportunityId).toBeNull()
    expect((await world.core.router.call('mix.get', { channelId: world.channel.id })).kinds.find((k) => k.kind === 'own_update')?.problem).toMatch(/last try failed/)
  })

  it('tries a note once per scan, however many channels of the product want it', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', { ...UPDATE, text: 'I fixed it for 5000 people.' })
    const mine = await note()
    withMix(mix({ kind: 'own_update' }))
    world.addChannel({ target: 'r/second', mode: 'approval', settings: { mix: mix({ kind: 'own_update' }) } })
    world.addChannel({ target: 'r/third', mode: 'approval', settings: { mix: mix({ kind: 'own_update' }) } })
    expect(await run()).toBe(0)
    expect(world.engine.calls).toHaveLength(1)
    expect((await world.core.router.call('updates.list', { productId: world.product.id })).find((n) => n.id === mine)?.failedTries).toBe(1)
  })

  it('gives the note back when its post was rejected before anything was sent, so it can be written again or removed', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', UPDATE)
    const mine = await note()
    withMix(mix({ kind: 'own_update', everyDays: 1 }))
    expect(await run()).toBe(1)
    const used = (): Promise<string | null | undefined> => world.core.router.call('updates.list', { productId: world.product.id }).then((l) => l.find((n) => n.id === mine)?.usedInOpportunityId)
    expect(await used()).not.toBeNull()
    await expect(world.core.router.call('updates.remove', { id: mine })).rejects.toMatchObject({ code: 'invalid_state' })
    await world.core.router.call('opportunities.reject', { id: drafts()[0]!.id, reason: 'The wording is poor' })
    // the first thing that looks is the card: it counts the note as usable again
    expect((await world.core.router.call('mix.get', { channelId: world.channel.id })).unusedUpdates).toBe(1)
    expect(await used()).toBeNull()
    world.clock.advance(2 * DAY)
    expect(await run()).toBe(1) // written again from the same note
    expect(drafts()).toHaveLength(2)
    // and when the first thing that looks is the job
    await world.core.router.call('opportunities.reject', { id: drafts()[1]!.id })
    world.clock.advance(2 * DAY)
    expect(await run()).toBe(1)
    expect(drafts()).toHaveLength(3)
    await world.core.router.call('opportunities.reject', { id: drafts()[2]!.id })
    await world.core.router.call('updates.remove', { id: mine })
    expect(await world.core.router.call('updates.list', { productId: world.product.id })).toHaveLength(0)
  })

  it('keeps the note of a post that was sent, or may have been: the news was told', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', UPDATE)
    const mine = await note()
    withMix(mix({ kind: 'own_update' }))
    expect(await run()).toBe(1)
    const id = drafts()[0]!.id
    for (const sent of ['confirmed', 'unknown', 'sending'] as const) {
      world.core.db.prepare('DELETE FROM send_actions').run()
      const draft = world.core.db.prepare('SELECT id FROM drafts WHERE opportunity_id = ?').get(id) as { id: string }
      world.core.db.pragma('foreign_keys = OFF')
      world.core.db
        .prepare(`INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis) VALUES (?, ?, ?, 'none', 'h', ?, 'd', ?, ?, 'owner')`)
        .run(`act-${sent}`, id, draft.id, world.account.id, sent, world.core.clock.now().toISOString())
      world.core.db.pragma('foreign_keys = ON')
      world.core.db.prepare("UPDATE opportunities SET state = 'cancelled' WHERE id = ?").run(id)
      const listed = await world.core.router.call('updates.list', { productId: world.product.id })
      expect(listed.find((n) => n.id === mine)?.usedInOpportunityId).toBe(id)
    }
    world.core.db.prepare("UPDATE send_actions SET state = 'failed'").run() // it never went out
    const listed = await world.core.router.call('updates.list', { productId: world.product.id })
    expect(listed.find((n) => n.id === mine)?.usedInOpportunityId).toBeNull()
  })

  it('lets the note\'s own bare domain through: "Launched on producthunt.com" may be repeated', async () => {
    world = makeWorld({ mode: 'approval' })
    script('draft.update', { ...UPDATE, text: 'I launched on producthunt.com today.' })
    await note('Launched on producthunt.com')
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
      world.clock.advance(MIX_RETRY_MAX_MS + 1000)
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

  it('reads number words, other scripts and the ways of writing a thousand', () => {
    expect(numbersNotInNote('It reached two thousand people.', 'Fixed a bug')).toEqual(['two', 'thousand'])
    expect(numbersNotInNote('Three bugs fixed.', 'Fixed 3 bugs')).toEqual([]) // the word is the amount of the digit
    expect(numbersNotInNote('A dozen bugs.', 'Fixed 12 bugs')).toEqual([])
    expect(numbersNotInNote('Fixed one bug.', 'Fixed a bug')).toEqual([]) // "one" is mostly a pronoun
    expect(numbersNotInNote('٣٠٠ users, ½ of them, ３ days, ² and Ⅷ', 'none')).toHaveLength(5)
    expect(numbersNotInNote('1,000 users', 'Reached 1000 users')).toEqual([])
    expect(numbersNotInNote('1000 users', 'Reached 1,000 users')).toEqual([])
    expect(numbersNotInNote('1 000 users', 'Reached 1000 users')).toEqual(['1', '000']) // a space is not a separator it knows: refused, never let through
    expect(numbersNotInNote('1,500 users', 'Reached 1,000 users')).toEqual(['1.500'])
  })
})

describe('addresses of a post against its note', () => {
  it('lets through what the note gives, in full or below it, and what is on another host or on the product site', () => {
    const note = 'Code at https://github.com/owner/repo, docs on docs.example.com'
    expect(addressesNotInNote('See github.com/owner/repo and https://github.com/owner/repo/issues/3', note, null)).toEqual([])
    expect(addressesNotInNote('See https://github.com/someone-else/malware', note, null)).toEqual(['github.com/someone-else/malware'])
    expect(addressesNotInNote('See https://github.com/owner/repository', note, null)).toEqual(['github.com/owner/repository'])
    expect(addressesNotInNote('See https://github.com/owner', note, null)).toEqual(['github.com/owner'])
    expect(addressesNotInNote('See https://docs.example.com/guide', note, null)).toEqual(['docs.example.com/guide']) // the host alone allows the host alone
    expect(addressesNotInNote('See docs.example.com', note, null)).toEqual([])
    expect(addressesNotInNote('See https://elsewhere.example.org/x', note, null)).toEqual([]) // another host is the safety check's business
    expect(addressesNotInNote('See https://github.com/anything', note, 'github.com')).toEqual([]) // the product's own site is allowed anywhere
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
