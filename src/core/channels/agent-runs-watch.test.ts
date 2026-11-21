// DEC-042: the watch kind of mission in the AI agent service: started only by the monitor's watch flow, held to six reading tools, never asking the owner
// anything, and ended in a way the flow can tell apart (finished, stopped, timeout, error, busy).

import { describe, expect, it } from 'vitest'
import type { AgentRun } from '../../shared/types'
import { AiError } from '../ports'
import { WATCH_TOOL_NAMES, type WatchBrief, type WatchItem, type WatchMissionRequest, type WatchMissionService, type WatchOutcome } from '../browser-agent/watch'
import { makeReadyWorld, type World } from './test-helpers'

const POST = 'https://www.instagram.com/p/Abc123/'

const feed = {
  url: 'https://www.instagram.com/explore/search/keyword/?q=astrology',
  title: 'Search',
  text: 'Some posts',
  alerts: [] as string[],
  humanCheck: '',
  elements: [
    { ref: 'e1', role: 'link', name: 'A post about natal charts', to: '/p/Abc123/', href: POST },
    { ref: 'e2', role: 'button', name: 'Follow' }
  ]
}

const brief = (over: Partial<WatchBrief> = {}): WatchBrief => ({
  platform: 'Instagram',
  channelTarget: '@natalmystic',
  channelUrl: 'https://www.instagram.com/natalmystic/',
  accountLabel: 'Main',
  accountIdentity: 'natal_bot',
  product: { name: 'Natal Mystic', websiteUrl: null, description: null },
  goals: [],
  topics: ['astrology'],
  queries: ['astrology'],
  places: [
    { label: 'The channel', url: 'https://www.instagram.com/natalmystic/' },
    { label: 'Search', url: 'https://www.instagram.com/explore/search/keyword/?q=astrology' }
  ],
  firstLook: true,
  lookBackDays: 30,
  since: '2026-10-16T12:00:00.000Z',
  known: [],
  maxPosts: 60,
  ...over
})

interface Looking {
  w: World
  stored: WatchItem[]
  request: WatchMissionRequest
}

async function ready(): Promise<Looking> {
  const w = await makeReadyWorld()
  w.core.db.prepare("UPDATE accounts SET status = 'ready', identity = 'natal_bot' WHERE id = ?").run(w.account.id)
  w.t.browser.page(w.account.id).responses = [{ match: 'agent-snapshot', value: feed }]
  const stored: WatchItem[] = []
  const request: WatchMissionRequest = {
    accountId: w.account.id,
    channelId: 'channel-1',
    hosts: ['instagram.com'],
    brief: brief(),
    record: (items) => {
      stored.push(...items)
      return { stored: items.length, known: 0 }
    }
  }
  return { w, stored, request }
}

const service = (w: World): WatchMissionService => w.core.services.watchMissions as WatchMissionService
const watch = (x: Looking): Promise<WatchOutcome> => service(x.w).watch(x.request)
const state = (w: World) => w.call('agent.state', { accountId: w.account.id })
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
type Call = (name: string, args?: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>

/** What the AI does: a script that uses the tools through the host the application offered, as the engine would. */
const asTheAI = (w: World, work: (call: Call) => Promise<string | void>): void => {
  w.t.engine.on('agent.watch', async () => {
    const tools = w.t.bridge.host
    return (await work((name, args = {}) => tools.call(name, args))) ?? 'Done.'
  })
}

describe('who may start a watch mission', () => {
  it('is not a kind the owner can start, but is a readiness question the flow asks', async () => {
    const x = await ready()
    expect(await x.w.refusal('agent.start', { accountId: x.w.account.id, kind: 'watch' as never })).toBe('invalid_input')
    expect(await x.w.call('agent.canStart', { accountId: x.w.account.id, kind: 'watch' })).toEqual({ ready: true, reason: null })
    expect(await state(x.w)).toBeNull()
    expect(x.w.t.bridge.opened).toEqual([])
  })

  it('is started through its own service, which exists, and says whether it can start', async () => {
    const x = await ready()
    expect(typeof service(x.w).watch).toBe('function')
    expect(await service(x.w).watchReady(x.w.account.id)).toEqual({ ready: true, reason: null })
  })
})

describe('what a watch mission needs', () => {
  it('needs an account that is signed in', async () => {
    const x = await ready()
    x.w.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(x.w.account.id)
    expect(await service(x.w).watchReady(x.w.account.id)).toMatchObject({ ready: false, reason: expect.stringContaining('is not signed in') })
    await expect(watch(x)).rejects.toMatchObject({ code: 'not_ready' })
    expect(x.w.t.bridge.opened).toEqual([])
  })

  it('watches with an engine that cannot be held to the browser tools alone (Codex): any selected engine may, and the run is quiet, not confined', async () => {
    const x = await ready()
    x.w.t.engine.confinesAgent = false
    expect(await service(x.w).watchReady(x.w.account.id)).toEqual({ ready: true, reason: null })
    asTheAI(x.w, async () => undefined)
    await watch(x)
    const agent = x.w.t.engine.calls.find((c) => c.label === 'agent.watch')?.agent
    expect(agent).toMatchObject({ quiet: true })
    expect(agent?.confined).toBeUndefined()
  })

  it('needs an engine that can work the browser, an installed one and a selected one', async () => {
    const x = await ready()
    x.w.t.engine.supportsAgent = false
    await expect(watch(x)).rejects.toMatchObject({ code: 'engine_cannot_drive' })
    x.w.t.engine.supportsAgent = true
    x.w.t.engine.installed = false
    await expect(watch(x)).rejects.toMatchObject({ code: 'engine_unavailable' })
    x.w.t.engine.installed = true
    x.w.core.settings.updateApp({ engineId: null })
    await expect(watch(x)).rejects.toMatchObject({ code: 'no_engine' })
    expect(x.w.t.engine.calls).toEqual([])
  })

  it('does not start while another task works the account, and does not disturb that task', async () => {
    const x = await ready()
    let release = (): void => undefined
    asTheAI(x.w, async () => {
      await new Promise<void>((resolve) => (release = resolve))
    })
    const first = watch(x)
    await tick(5)
    await expect(watch(x)).rejects.toMatchObject({ code: 'agent_running' })
    expect(await service(x.w).watchReady(x.w.account.id)).toMatchObject({ ready: false, reason: expect.stringContaining('already working') })
    release()
    expect((await first).ended).toBe('finished')
  })
})

describe('what a watch mission gives the AI, and how it ends', () => {
  it('opens exactly the six reading tools, in a confined engine, with the brief, and records what the AI judged', async () => {
    const x = await ready()
    asTheAI(x.w, async (call) => {
      expect((await call('browser_snapshot')).isError).toBeFalsy()
      expect((await call('watch_open', { place: 2 })).isError).toBeFalsy()
      await call('browser_snapshot')
      expect((await call('watch_open', { ref: 'e1' })).isError).toBeFalsy()
      const recorded = await call('watch_record', { items: [{ url: POST, title: 'A post about natal charts', author: 'someone', label: 'reply', relation: 'Asks how to read a chart.' }] })
      expect(recorded.isError).toBeFalsy()
      await call('report_result', { status: 'done', reason: 'Looked at the search.' })
    })

    const outcome = await watch(x)

    expect(outcome).toEqual({ ended: 'finished', reported: { status: 'done', reason: 'Looked at the search.' }, humanCheck: null, error: null })
    expect(x.stored).toEqual([{ url: 'https://www.instagram.com/p/Abc123', title: 'A post about natal charts', author: 'someone', label: 'notice', relation: 'Worth a reply: Asks how to read a chart.' }])
    const task = x.w.t.engine.calls.at(-1)
    expect(task?.label).toBe('agent.watch')
    expect(task?.agent?.confined).toBe(true)
    expect(task?.prompt).toContain('GOAL: Look at what Instagram shows')
    expect(x.w.t.bridge.opened).toHaveLength(1)
    expect(x.w.t.bridge.closed).toBe(1)
    expect(x.w.t.bridge.host.tools.map((tool) => tool.name)).toEqual([...WATCH_TOOL_NAMES])
    // the AI only opened pages by address: nothing was clicked, typed or run
    const log = x.w.t.browser.page(x.w.account.id).log
    expect(log.filter((line) => line.startsWith('goto '))).toEqual(['goto https://www.instagram.com/explore/search/keyword/?q=astrology', `goto ${POST}`])
    expect(log.filter((line) => /^(click|fill|upload)/.test(line))).toEqual([])
    expect(x.w.t.browser.page(x.w.account.id).steps).toEqual([])
    expect(await state(x.w)).toMatchObject({ kind: 'watch', status: 'done', channelId: 'channel-1' })
  })

  it('cannot be made to click, type, run a script or ask the owner, whatever the AI calls', async () => {
    const x = await ready()
    const refused: string[] = []
    asTheAI(x.w, async (call) => {
      await call('browser_snapshot')
      for (const [name, args] of [
        ['browser_click', { ref: 'e2' }],
        ['browser_type', { ref: 'e2', value: 'x' }],
        ['browser_evaluate', { script: 'document.cookie' }],
        ['browser_navigate', { url: 'https://evil.example' }],
        ['ask_owner', { question: 'May I?' }],
        ['browser_press_key', { key: 'Enter' }]
      ] as const) {
        const result = await call(name, { ...args })
        if (result.isError) refused.push(name)
      }
      await call('report_result', { status: 'done', reason: 'Nothing to do.' })
    })

    await watch(x)

    expect(refused).toEqual(['browser_click', 'browser_type', 'browser_evaluate', 'browser_navigate', 'ask_owner', 'browser_press_key'])
    expect(x.w.t.browser.page(x.w.account.id).steps).toEqual([])
    expect(await x.w.call('agent.questions', undefined)).toEqual([])
  })

  it('shows the owner what it does while it works, and nothing about the AI to the owner afterwards beyond its own words', async () => {
    const x = await ready()
    let running: AgentRun | null = null
    asTheAI(x.w, async (call) => {
      await call('browser_snapshot')
      running = await state(x.w)
      await call('report_result', { status: 'done', reason: 'Looked.' })
    })
    await watch(x)
    expect(running).toMatchObject({ kind: 'watch', status: 'running', channelId: 'channel-1' })
    expect(x.w.t.browser.agentShown).toContain(x.w.account.id)
  })

  it('ends as stopped when the owner presses Stop, and nothing the AI does afterwards is done', async () => {
    const x = await ready()
    let release = (): void => undefined
    let late: { text: string; isError?: boolean } | null = null
    asTheAI(x.w, async (call) => {
      await new Promise<void>((resolve) => (release = resolve))
      late = await call('watch_open', { place: 1 })
      throw new AiError('cancelled', 'cancelled')
    })
    const running = watch(x)
    await tick(5)
    expect(await x.w.call('agent.stop', { accountId: x.w.account.id })).toMatchObject({ status: 'stopped' })
    release()

    expect(await running).toMatchObject({ ended: 'stopped' })
    expect(late).toMatchObject({ isError: true, text: expect.stringContaining('The owner stopped this task') })
    expect(x.w.t.browser.page(x.w.account.id).log.filter((line) => line.startsWith('goto '))).toEqual([])
  })

  it('ends as busy, and is made again later, when the owner takes the browser: the AI is told to stop and does nothing more', async () => {
    const x = await ready()
    let after: { text: string; isError?: boolean } | null = null
    asTheAI(x.w, async (call) => {
      await call('browser_snapshot')
      x.w.t.browser.session(x.w.account).takeControl()
      const taken = await call('watch_open', { place: 1 })
      expect(taken.isError).toBe(true)
      x.w.t.browser.session(x.w.account).releaseControl()
      after = await call('watch_open', { place: 2 })
      await call('report_result', { status: 'done', reason: 'Looked.' })
    })

    const outcome = await watch(x)

    expect(outcome.ended).toBe('busy')
    expect(after).toMatchObject({ isError: true })
    expect(x.w.t.browser.page(x.w.account.id).log.filter((line) => line.startsWith('goto '))).toEqual([])
    expect(await state(x.w)).toMatchObject({ kind: 'watch', status: 'stopped' })
  })

  it('reports a timeout and an error of the engine, as what they are', async () => {
    const x = await ready()
    x.w.t.engine.on('agent.watch', async () => {
      throw new AiError('timeout', 'too slow')
    })
    expect(await watch(x)).toMatchObject({ ended: 'timeout', reported: null })
    expect(await state(x.w)).toMatchObject({ status: 'failed' })

    x.w.t.engine.on('agent.watch', async () => {
      throw new Error('the engine fell over')
    })
    expect(await watch(x)).toMatchObject({ ended: 'error', error: 'the engine fell over' })
    expect(await state(x.w)).toMatchObject({ status: 'failed' })
  })

  it('tells what the AI reported, whatever it was: the flow decides what counts', async () => {
    const x = await ready()
    for (const status of ['needs_owner', 'failed'] as const) {
      asTheAI(x.w, async (call) => {
        await call('report_result', { status, reason: 'A page asked for something.' })
      })
      expect(await watch(x)).toMatchObject({ ended: 'finished', reported: { status, reason: 'A page asked for something.' } })
    }
    asTheAI(x.w, async () => undefined)
    expect(await watch(x)).toMatchObject({ ended: 'finished', reported: null })
  })

  it('tells the flow of a human check the last page showed', async () => {
    const x = await ready()
    x.w.t.browser.page(x.w.account.id).responses = [{ match: 'agent-snapshot', value: { ...feed, humanCheck: 'a CAPTCHA' } }]
    asTheAI(x.w, async (call) => {
      await call('browser_snapshot')
      await call('report_result', { status: 'needs_owner', reason: 'A check.' })
    })
    expect(await watch(x)).toMatchObject({ reported: { status: 'needs_owner' }, humanCheck: expect.stringContaining('CAPTCHA') })
  })
})
