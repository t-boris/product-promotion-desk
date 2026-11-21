// REQ-004: the research kind of mission in the AI agent service: started only by the quick-post helper, held to six reading tools, never asking the owner
// anything, shown to the owner while it works (the run of the AI browser and the progress panel), and ended in a way the helper can tell apart (finished,
// stopped, timeout, error, busy). It is the watch mission's own way of looking; the existing watch tests pin the part they share.

import { describe, expect, it } from 'vitest'
import type { AgentRun } from '../../shared/types'
import { AiError } from '../ports'
import { RESEARCH_TOOL_NAMES, TopicList, type ResearchBrief, type ResearchMissionRequest, type ResearchMissionService, type ResearchOutcome } from '../browser-agent/research'
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

const brief = (over: Partial<ResearchBrief> = {}): ResearchBrief => ({
  platform: 'Instagram',
  accountLabel: 'Main',
  product: { name: 'Natal Mystic', websiteUrl: null, description: null },
  about: ['It draws a natal chart from a birth date.'],
  wish: null,
  places: [
    { label: 'Search for "astrology"', url: 'https://www.instagram.com/explore/search/keyword/?q=astrology' },
    { label: 'Search for "birth chart"', url: 'https://www.instagram.com/explore/search/keyword/?q=birth%20chart' }
  ],
  maxTopics: 8,
  ...over
})

interface Searching {
  w: World
  list: TopicList
  request: ResearchMissionRequest
}

async function ready(): Promise<Searching> {
  const w = await makeReadyWorld()
  w.core.db.prepare("UPDATE accounts SET status = 'ready', identity = 'natal_bot' WHERE id = ?").run(w.account.id)
  w.t.browser.page(w.account.id).responses = [{ match: 'agent-snapshot', value: feed }]
  const list = new TopicList()
  const request: ResearchMissionRequest = { accountId: w.account.id, subject: 'quick-trends:channel-1', hosts: ['instagram.com'], brief: brief(), record: list.record }
  return { w, list, request }
}

const service = (w: World): ResearchMissionService => w.core.services.researchMissions as ResearchMissionService
const research = (x: Searching): Promise<ResearchOutcome> => service(x.w).research(x.request)
const state = (w: World) => w.call('agent.state', { accountId: w.account.id })
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
type Call = (name: string, args?: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>

/** What the AI does: a script that uses the tools through the host the application offered, as the engine would. */
const asTheAI = (w: World, work: (call: Call) => Promise<string | void>): void => {
  w.t.engine.on('agent.research', async () => {
    const tools = w.t.bridge.host
    return (await work((name, args = {}) => tools.call(name, args))) ?? 'Done.'
  })
}

describe('who may start a research mission', () => {
  it('is not a kind the owner can start, and is not the watch flow\'s: it is the quick-post helper\'s own service, which exists and says whether it can start', async () => {
    const x = await ready()
    expect(await x.w.refusal('agent.start', { accountId: x.w.account.id, kind: 'research' as never })).toBe('invalid_input')
    expect(await state(x.w)).toBeNull()
    expect(x.w.t.bridge.opened).toEqual([])
    expect(typeof service(x.w).research).toBe('function')
    expect(await service(x.w).researchReady(x.w.account.id)).toEqual({ ready: true, reason: null })
    // the watch flow's service is the same service, but a search is not a watch of a channel
    expect(await x.w.call('agent.canStart', { accountId: x.w.account.id, kind: 'watch' })).toEqual({ ready: true, reason: null })
  })
})

describe('what a research mission needs', () => {
  it('needs an account that is signed in', async () => {
    const x = await ready()
    x.w.core.db.prepare("UPDATE accounts SET status = 'login_required' WHERE id = ?").run(x.w.account.id)
    expect(await service(x.w).researchReady(x.w.account.id)).toMatchObject({ ready: false, reason: expect.stringContaining('is not signed in') })
    await expect(research(x)).rejects.toMatchObject({ code: 'not_ready' })
    expect(x.w.t.bridge.opened).toEqual([])
  })

  it('searches with an engine that cannot be held to the browser tools alone (Codex): any selected engine may, and the run is quiet, not confined', async () => {
    const x = await ready()
    x.w.t.engine.confinesAgent = false
    expect(await service(x.w).researchReady(x.w.account.id)).toEqual({ ready: true, reason: null })
    asTheAI(x.w, async () => undefined)
    await research(x)
    const agent = x.w.t.engine.calls.find((c) => c.label === 'agent.research')?.agent
    expect(agent).toMatchObject({ quiet: true })
    expect(agent?.confined).toBeUndefined()
  })

  it('needs an engine that can work the browser, an installed one and a selected one', async () => {
    const x = await ready()
    x.w.t.engine.supportsAgent = false
    await expect(research(x)).rejects.toMatchObject({ code: 'engine_cannot_drive' })
    x.w.t.engine.supportsAgent = true
    x.w.t.engine.installed = false
    await expect(research(x)).rejects.toMatchObject({ code: 'engine_unavailable' })
    x.w.t.engine.installed = true
    x.w.core.settings.updateApp({ engineId: null })
    await expect(research(x)).rejects.toMatchObject({ code: 'no_engine' })
    expect(x.w.t.engine.calls).toEqual([])
  })

  it('does not start while another task works the account, and does not disturb that task', async () => {
    const x = await ready()
    let release = (): void => undefined
    asTheAI(x.w, async () => {
      await new Promise<void>((resolve) => (release = resolve))
    })
    const first = research(x)
    await tick(5)
    await expect(research(x)).rejects.toMatchObject({ code: 'agent_running' })
    expect(await service(x.w).researchReady(x.w.account.id)).toMatchObject({ ready: false, reason: expect.stringContaining('already working') })
    release()
    expect((await first).ended).toBe('finished')
  })
})

describe('what a research mission gives the AI, and how it ends', () => {
  it('opens exactly the six reading tools, in a confined engine, with the brief, and keeps what the AI saw for the owner', async () => {
    const x = await ready()
    asTheAI(x.w, async (call) => {
      expect((await call('browser_snapshot')).isError).toBeFalsy()
      expect((await call('watch_open', { place: 1 })).isError).toBeFalsy()
      await call('browser_snapshot')
      expect((await call('watch_open', { ref: 'e1' })).isError).toBeFalsy()
      const recorded = await call('research_record', { items: [{ topic: 'Birth chart memes', what: 'People joke about their rising sign.', url: POST }] })
      expect(recorded.isError).toBeFalsy()
      await call('report_result', { status: 'done', reason: 'Looked at the search.' })
    })

    const outcome = await research(x)

    expect(outcome).toEqual({ ended: 'finished', reported: { status: 'done', reason: 'Looked at the search.' }, humanCheck: null, error: null })
    expect(x.list.topics).toEqual([{ topic: 'Birth chart memes', what: 'People joke about their rising sign.', url: 'https://www.instagram.com/p/Abc123' }])
    const task = x.w.t.engine.calls.at(-1)
    expect(task?.label).toBe('agent.research')
    // the progress panel shows the run under the subject the composer asked with, so that it shows only its own search
    expect(task?.subject).toBe('quick-trends:channel-1')
    expect(task?.agent?.confined).toBe(true)
    expect(task?.prompt).toContain('GOAL: Find out what people are talking about on Instagram')
    expect(task?.prompt).toContain('You only READ')
    expect(x.w.t.bridge.opened).toHaveLength(1)
    expect(x.w.t.bridge.closed).toBe(1)
    expect(x.w.t.bridge.host.tools.map((tool) => tool.name)).toEqual([...RESEARCH_TOOL_NAMES])
    // the AI only opened pages by address: nothing was clicked, typed or run
    const log = x.w.t.browser.page(x.w.account.id).log
    expect(log.filter((line) => line.startsWith('goto '))).toEqual(['goto https://www.instagram.com/explore/search/keyword/?q=astrology', `goto ${POST}`])
    expect(log.filter((line) => /^(click|fill|upload)/.test(line))).toEqual([])
    expect(x.w.t.browser.page(x.w.account.id).steps).toEqual([])
    expect(await state(x.w)).toMatchObject({ kind: 'research', status: 'done' })
  })

  it('cannot be made to click, type, run a script, ask the owner or record a post, whatever the AI calls', async () => {
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
        ['browser_press_key', { key: 'Enter' }],
        ['browser_submit', { submit_ref: 'e2' }],
        ['watch_record', { items: [{ url: POST, title: 'x', label: 'reply', relation: 'y' }] }]
      ] as const) {
        const result = await call(name, { ...args })
        if (result.isError) refused.push(name)
      }
      await call('report_result', { status: 'done', reason: 'Nothing to do.' })
    })

    await research(x)

    expect(refused).toEqual(['browser_click', 'browser_type', 'browser_evaluate', 'browser_navigate', 'ask_owner', 'browser_press_key', 'browser_submit', 'watch_record'])
    expect(x.w.t.browser.page(x.w.account.id).steps).toEqual([])
    expect(x.list.topics).toEqual([])
    expect(await x.w.call('agent.questions', undefined)).toEqual([])
  })

  it('shows the owner what it does while it works: the account\'s browser is brought to the front and the run says what the AI is doing', async () => {
    const x = await ready()
    let running: AgentRun | null = null
    asTheAI(x.w, async (call) => {
      await call('watch_open', { place: 1 })
      running = await state(x.w)
      await call('report_result', { status: 'done', reason: 'Looked.' })
    })
    await research(x)
    expect(running).toMatchObject({ kind: 'research', status: 'running' })
    expect((running as AgentRun | null)?.lines.some((line) => line.startsWith('Opened '))).toBe(true)
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
    const running = research(x)
    await tick(5)
    expect(await x.w.call('agent.stop', { accountId: x.w.account.id })).toMatchObject({ status: 'stopped' })
    release()

    expect(await running).toMatchObject({ ended: 'stopped' })
    expect(late).toMatchObject({ isError: true, text: expect.stringContaining('The owner stopped this task') })
    expect(x.w.t.browser.page(x.w.account.id).log.filter((line) => line.startsWith('goto '))).toEqual([])
  })

  it('ends as busy when the owner takes the browser: the AI is told to stop and does nothing more, and the run says the search stopped', async () => {
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

    const outcome = await research(x)

    expect(outcome.ended).toBe('busy')
    expect(after).toMatchObject({ isError: true })
    expect(x.w.t.browser.page(x.w.account.id).log.filter((line) => line.startsWith('goto '))).toEqual([])
    expect(await state(x.w)).toMatchObject({ kind: 'research', status: 'stopped', summary: expect.stringContaining('the search stops here') })
  })

  it('reports a timeout and an error of the engine, as what they are', async () => {
    const x = await ready()
    x.w.t.engine.on('agent.research', async () => {
      throw new AiError('timeout', 'too slow')
    })
    expect(await research(x)).toMatchObject({ ended: 'timeout', reported: null })
    expect(await state(x.w)).toMatchObject({ status: 'failed', summary: 'The AI did not finish in ten minutes and was stopped.' })

    x.w.t.engine.on('agent.research', async () => {
      throw new Error('the engine fell over')
    })
    expect(await research(x)).toMatchObject({ ended: 'error', error: 'the engine fell over' })
    expect(await state(x.w)).toMatchObject({ status: 'failed' })
  })

  it('tells what the AI reported, whatever it was: the helper decides what it is worth', async () => {
    const x = await ready()
    for (const status of ['needs_owner', 'failed'] as const) {
      asTheAI(x.w, async (call) => {
        await call('report_result', { status, reason: 'A page asked for something.' })
      })
      expect(await research(x)).toMatchObject({ ended: 'finished', reported: { status, reason: 'A page asked for something.' } })
    }
    asTheAI(x.w, async () => undefined)
    expect(await research(x)).toMatchObject({ ended: 'finished', reported: null })
  })

  it('tells the helper of a human check the last page showed', async () => {
    const x = await ready()
    x.w.t.browser.page(x.w.account.id).responses = [{ match: 'agent-snapshot', value: { ...feed, humanCheck: 'a CAPTCHA' } }]
    asTheAI(x.w, async (call) => {
      await call('browser_snapshot')
      await call('report_result', { status: 'needs_owner', reason: 'A check.' })
    })
    expect(await research(x)).toMatchObject({ reported: { status: 'needs_owner' }, humanCheck: expect.stringContaining('CAPTCHA') })
  })
})
