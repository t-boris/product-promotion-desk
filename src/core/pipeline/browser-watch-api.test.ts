// DEC-042 through the API the owner presses: Activate plans the first look and does not make it inside the call, "Check now" looks and drafts nothing,
// and pausing and resuming a watched channel puts it back to work with nothing to say about itself.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WatchMissionRequest, WatchMissionService, WatchOutcome } from '../browser-agent/watch'
import { toJson } from '../db/database'
import { DraftingFlow } from './drafting'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  vi.restoreAllMocks()
  await closeWorld(world)
})

class Looking implements WatchMissionService {
  readonly requests: WatchMissionRequest[] = []
  async watchReady(): Promise<{ ready: boolean; reason: string | null }> {
    return { ready: true, reason: null }
  }
  async watch(request: WatchMissionRequest): Promise<WatchOutcome> {
    this.requests.push(request)
    request.record([{ url: 'https://www.instagram.com/p/Abc', title: 'A post about charts', author: 'someone', label: 'notice', relation: 'Astrology fans talk about birth charts.' }])
    return { ended: 'finished', reported: { status: 'done', reason: 'ok' }, humanCheck: null, error: null, said: '', outOfCalls: false }
  }
}

/** A world whose only channel is an Instagram one the app does not read, as connected and not yet activated. */
function watchedWorld(options: { status?: 'setup' | 'active' | 'paused'; platform?: string } = {}): { ai: Looking; channelId: string } {
  world = makeWorld({ mode: 'observe', baselineDone: false })
  world.connector.canRead = false
  const ai = new Looking()
  world.core.services.watchMissions = ai
  const channel = world.addChannel({ platform: options.platform ?? 'instagram', reads: false, baselineDone: false, mode: 'observe', status: options.status ?? 'setup', target: '@natalmystic' })
  return { ai, channelId: channel.id }
}

const call = <M extends Parameters<World['core']['router']['call']>[0]>(method: M, args: Parameters<World['core']['router']['call']>[1]) => world.core.router.call(method, args as never)
const channelOf = (id: string) => world.core.repos.channel(id)

describe('activating a channel that is watched in the browser', () => {
  it('makes it active at once with nothing to say about itself, and plans the first look for now without making it', async () => {
    const { ai, channelId } = watchedWorld()

    const channel = await call('channels.activate', { channelId })

    expect(channel).toMatchObject({ status: 'active', statusDetail: '', reads: false, watchedInBrowser: true, baselineDoneAt: null, nextCheckAt: world.clock.now().toISOString() })
    expect(ai.requests).toEqual([])
    expect(world.core.runs.list({ channelId }).filter((r) => r.kind === 'monitor')).toEqual([])
  })

  it('needs the account signed in, and nothing else: whether posts can be made there is not asked of a channel that is only read (DEC-045)', async () => {
    const { channelId } = watchedWorld()
    world.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(world.account.id)
    await expect(call('channels.activate', { channelId })).rejects.toMatchObject({ code: 'account_not_ready' })
    world.core.db.prepare("UPDATE accounts SET status = 'ready' WHERE id = ?").run(world.account.id)
    const caps = channelOf(channelId).capabilities.map((c) => (c.key === 'publish_post' ? { ...c, status: 'unavailable' as const } : c))
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(caps), channelId)
    expect(await call('channels.activate', { channelId })).toMatchObject({ status: 'active', watchedInBrowser: true })
  })

  it('does not activate a paused channel', async () => {
    const { channelId } = watchedWorld({ status: 'paused' })
    await expect(call('channels.activate', { channelId })).rejects.toMatchObject({ code: 'channel_paused' })
  })

  it('watches a channel of any site too, not only of the platforms that were listed (DEC-045)', async () => {
    const { channelId } = watchedWorld({ platform: 'web' })
    const channel = await call('channels.activate', { channelId })
    expect(channel).toMatchObject({ status: 'active', statusDetail: '', watchedInBrowser: true })
    expect(channel.nextCheckAt).not.toBeNull()
  })
})

describe('"Check now" on a channel that is watched in the browser', () => {
  it('makes one look, records it as a run, and prepares no draft, no approval and no send', async () => {
    const { ai, channelId } = watchedWorld({ status: 'active' })
    const drafting = vi.spyOn(DraftingFlow.prototype, 'processChannel')

    const run = await call('channels.checkNow', { channelId })

    expect(ai.requests).toHaveLength(1)
    expect(run).toMatchObject({ kind: 'monitor', channelId, status: 'ok', summary: 'Watched in the browser: 1 noted, 0 judged not relevant, 0 already known' })
    expect(drafting).not.toHaveBeenCalled()
    for (const table of ['opportunities', 'drafts', 'approvals', 'send_actions']) expect((world.core.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c, table).toBe(0)
    expect((world.core.db.prepare('SELECT COUNT(*) c FROM findings WHERE channel_id = ?').get(channelId) as { c: number }).c).toBe(1)
    expect(channelOf(channelId)).toMatchObject({ reads: false, status: 'active' })
  })

  it('looks at a channel of any site, not only of the platforms that were listed (DEC-045)', async () => {
    const { ai, channelId } = watchedWorld({ status: 'active', platform: 'web' })
    await call('channels.checkNow', { channelId })
    expect(ai.requests).toHaveLength(1)
  })

  it('refuses a paused channel', async () => {
    const { channelId } = watchedWorld({ status: 'paused' })
    await expect(call('channels.checkNow', { channelId })).rejects.toMatchObject({ code: 'channel_paused' })
  })
})

describe('pausing and resuming a channel that is watched in the browser', () => {
  it('puts a resumed channel back to work with nothing to say about itself, not back to setup and not as own posts', async () => {
    const { channelId } = watchedWorld({ status: 'active' })
    await call('channels.setPaused', { channelId, paused: true })
    expect(channelOf(channelId).status).toBe('paused')

    const resumed = await call('channels.setPaused', { channelId, paused: false })

    expect(resumed).toMatchObject({ status: 'active', statusDetail: '' })
  })

  it('does not start a channel that was never activated: resume is not a way round Activate', async () => {
    const { channelId } = watchedWorld({ status: 'setup' })
    const resumed = await call('channels.setPaused', { channelId, paused: false })
    expect(resumed.status).toBe('setup')
  })
})
