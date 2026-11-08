import { describe, expect, it } from 'vitest'
import { makeHarness } from './scheduler-harness'
import { seedAccount, seedOpportunity, seedSend } from './scheduler-seed'

const HOUR = 60 * 60_000
const ago = (h: ReturnType<typeof makeHarness>, ms: number): string => new Date(h.clock.now().getTime() - ms).toISOString()

describe('history.list (REQ-006: what was sent, where, when and on what basis)', () => {
  function seedHistory() {
    const h = makeHarness()
    const channel = h.channel({ target: 'r/astrology' })
    const confirmedOpp = seedOpportunity(h.core, channel.id, { state: 'confirmed', destination: 'https://reddit.example/r/astrology/comments/abc/x/def' })
    const confirmed = seedSend(h.core, {
      opportunityId: confirmedOpp,
      accountId: h.account.id,
      state: 'confirmed',
      attemptedAt: ago(h, 2 * HOUR),
      completedAt: ago(h, 2 * HOUR - 5000),
      resultUrl: 'https://reddit.example/r/astrology/comments/abc/x/ghi',
      draftText: 'Natal Mystic can draw your chart from birth data.',
      basis: 'user approval a1',
      knowledgeVersionId: 'kv-3'
    })
    const unknownOpp = seedOpportunity(h.core, channel.id, { state: 'unknown_result' })
    const unknown = seedSend(h.core, { opportunityId: unknownOpp, accountId: h.account.id, state: 'unknown', attemptedAt: ago(h, 30 * 60_000), completedAt: null, basis: 'auto rule thanks-v1', draftText: 'Thanks!' })
    return { h, channel, confirmed, unknown, confirmedOpp, unknownOpp }
  }

  it('explains each send: content, destination, time, account, authorization basis, result link and knowledge version', async () => {
    const { h, confirmed, confirmedOpp } = seedHistory()

    const entries = await h.core.router.call('history.list', {})
    const entry = entries.find((e) => e.action.id === confirmed.actionId)!

    expect(entry.draft.text).toBe('Natal Mystic can draw your chart from birth data.')
    expect(entry.channelTarget).toBe('r/astrology')
    expect(entry.accountLabel).toBe('Main')
    expect(entry.opportunity.id).toBe(confirmedOpp)
    expect(entry.action).toMatchObject({
      state: 'confirmed',
      destination: 'https://reddit.example/r/astrology/comments/abc/x/def',
      authorizationBasis: 'user approval a1',
      resultUrl: 'https://reddit.example/r/astrology/comments/abc/x/ghi',
      knowledgeVersionId: 'kv-3'
    })
    expect(entry.action.attemptedAt).toBeTruthy()
    expect(entry.action.completedAt).toBeTruthy()
  })

  it('lists newest first and includes attempts whose outcome is unknown', async () => {
    const { h, confirmed, unknown } = seedHistory()
    const entries = await h.core.router.call('history.list', {})
    expect(entries.map((e) => e.action.id)).toEqual([unknown.actionId, confirmed.actionId])
    expect(entries[0].action).toMatchObject({ state: 'unknown', authorizationBasis: 'auto rule thanks-v1', completedAt: null })
  })

  it('honors the limit and keeps the evidence when an account was removed later', async () => {
    const { h, channel } = seedHistory()
    const gone = seedAccount(h.core, { label: 'Temp' })
    const opp = seedOpportunity(h.core, channel.id, { state: 'confirmed' })
    seedSend(h.core, { opportunityId: opp, accountId: gone.id, attemptedAt: ago(h, 1000) })
    h.core.db.prepare('DELETE FROM accounts WHERE id = ?').run(gone.id)

    const limited = await h.core.router.call('history.list', { limit: 1 })
    expect(limited).toHaveLength(1)
    expect(limited[0].accountLabel).toBe('(removed account)')
    // A missing or nonsensical limit falls back to the default instead of hiding history.
    expect(await h.core.router.call('history.list', { limit: 0 })).toHaveLength(3)
    expect(await h.core.router.call('history.list', { limit: 100000 })).toHaveLength(3)
  })

  it('is empty before anything was sent', async () => {
    const h = makeHarness()
    expect(await h.core.router.call('history.list', {})).toEqual([])
  })
})

describe('runs.list (REQ-005: each run exposes its time, status and short result)', () => {
  it('returns the most recent runs with start time, status and a short result, optionally per channel', async () => {
    const h = makeHarness()
    const a = h.channel({ target: 'r/a' })
    const b = h.channel({ target: 'r/b' })
    h.monitor.behaviors.set(a.id, async () => ({ status: 'ok' as const, summary: '4 new comments', newOpportunities: 4 }))
    h.monitor.behaviors.set(b.id, async () => {
      throw new Error('timeout while loading r/b')
    })
    h.drafting.result = { prepared: 1, autoSent: 1, needsUser: 1 }

    await h.start()

    const all = await h.core.router.call('runs.list', {})
    const runA = all.find((r) => r.channelId === a.id)!
    const runB = all.find((r) => r.channelId === b.id)!
    expect(runA).toMatchObject({ kind: 'monitor', status: 'ok', summary: '4 new comments, 1 draft, 1 auto-reply sent, 1 need you' })
    expect(runA.startedAt).toBe(h.clock.now().toISOString())
    expect(runA.finishedAt).not.toBeNull()
    expect(runB).toMatchObject({ status: 'failed', summary: 'timeout while loading r/b' })

    const onlyB = await h.core.router.call('runs.list', { channelId: b.id })
    expect(onlyB.every((r) => r.channelId === b.id)).toBe(true)
    expect(await h.core.router.call('runs.list', { limit: 1 })).toHaveLength(1)
  })
})
