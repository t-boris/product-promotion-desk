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
  maxCalls: 120,
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

  it('does not start beside a mission that acts on the account (a sign-in, a profile, a join, a publication), and does not disturb it', async () => {
    const x = await ready()
    // the account has an e-mail, a saved password and a profile, so a sign-up can run
    await x.w.call('accounts.setEmail', { accountId: x.w.account.id, email: 'natal.mystic@example.com' })
    await x.w.call('vault.savePassword', { accountId: x.w.account.id, loginName: 'natal.mystic@example.com', password: 'S3cret-Pa$$w0rd!' })
    const made = await x.w.call('profiles.create', { label: 'Selena', productId: x.w.productId, accountIds: [x.w.account.id] })
    await x.w.call('profiles.save', {
      id: made.id,
      profile: { firstName: 'Selena', lastName: 'Marlowe', displayName: 'Selena Marlowe', username: 'selena.builds', birthDate: '1989-04-02', gender: 'female', place: '', about: '', website: '', pictureIdea: '' },
      purpose: 'Be approachable'
    })
    await x.w.call('profiles.approve', { id: made.id })
    let release = (): void => undefined
    x.w.t.engine.on('agent.signup', async () => {
      await new Promise<void>((resolve) => (release = resolve))
      return 'Done.'
    })
    await x.w.call('agent.start', { accountId: x.w.account.id, kind: 'signup' })
    await tick(5)

    await expect(watch(x)).rejects.toMatchObject({ code: 'agent_running' })
    expect(await service(x.w).watchReady(x.w.account.id)).toMatchObject({ ready: false, reason: expect.stringContaining('already working') })
    expect(await state(x.w)).toMatchObject({ kind: 'signup', status: 'running' })
    release()
  })

  it('does not let a mission that acts start while a look works the account', async () => {
    const x = await ready()
    let release = (): void => undefined
    asTheAI(x.w, async () => {
      await new Promise<void>((resolve) => (release = resolve))
    })
    const look = watch(x)
    await tick(5)
    expect(await x.w.refusal('agent.start', { accountId: x.w.account.id, kind: 'profile' })).toBe('agent_running')
    release()
    expect((await look).ended).toBe('finished')
  })
})

describe('looks of one account side by side', () => {
  /** Two looks at two channels of one account, both waiting inside the AI until `release()`; returns what each saw. */
  async function twoLooks(x: Looking) {
    const releases: Array<() => void> = []
    const seen: Array<'snapshot' | 'failed'> = []
    asTheAI(x.w, async (call) => {
      seen.push((await call('browser_snapshot')).isError ? 'failed' : 'snapshot')
      await new Promise<void>((resolve) => releases.push(resolve))
      await call('report_result', { status: 'done', reason: 'Looked.' })
    })
    const first = service(x.w).watch({ ...x.request, channelId: 'channel-1' })
    await tick(5)
    const second = service(x.w).watch({ ...x.request, channelId: 'channel-2' })
    await tick(5)
    return { first, second, seen, releaseAll: () => releases.forEach((release) => release()), releases }
  }

  it('looks at two channels of one account at the same time, each with a tool server and a window of its own', async () => {
    const x = await ready()
    const both = await twoLooks(x)

    expect(both.releases).toHaveLength(2) // both are inside the AI now: neither waited for the other
    expect(both.seen).toEqual(['snapshot', 'snapshot'])
    expect(x.w.t.bridge.opened).toHaveLength(2)
    expect(x.w.t.browser.agentShown).toEqual([x.w.account.id, x.w.account.id])
    expect(x.w.t.browser.agentFocused).toEqual([])
    // the owner tells the windows apart by what each is looking at
    expect(x.w.t.browser.agentTitles).toEqual(['the AI is looking at @natalmystic', 'the AI is looking at @natalmystic'])
    expect(await service(x.w).watchReady(x.w.account.id)).toEqual({ ready: true, reason: null })
    // the screen of the account shows the look that began last
    expect(await state(x.w)).toMatchObject({ kind: 'watch', status: 'running', channelId: 'channel-2' })
    expect(x.w.core.services.agent?.working(x.w.account.id)).toBe(true)

    both.releaseAll()
    expect(await both.first).toMatchObject({ ended: 'finished', reported: { status: 'done' } })
    expect(await both.second).toMatchObject({ ended: 'finished', reported: { status: 'done' } })
    expect(x.w.t.bridge.closed).toBe(2)
    expect(x.w.t.browser.page(x.w.account.id).disposed).toBe(2) // each look closed its own window
    expect(x.w.core.services.agent?.working(x.w.account.id)).toBe(false)
    expect(await state(x.w)).toMatchObject({ kind: 'watch', status: 'done' })
  })

  it('Stop on the account stops every look of it', async () => {
    const x = await ready()
    const both = await twoLooks(x)

    expect(await x.w.call('agent.stop', { accountId: x.w.account.id })).toMatchObject({ status: 'stopped' })
    both.releaseAll()

    expect(await both.first).toMatchObject({ ended: 'stopped' })
    expect(await both.second).toMatchObject({ ended: 'stopped' })
    expect(x.w.core.services.agent?.working(x.w.account.id)).toBe(false)
  })

  it('one look ending does not end the other, and the account stays busy until the last one is over', async () => {
    const x = await ready()
    const both = await twoLooks(x)

    both.releases[0]?.()
    expect(await both.first).toMatchObject({ ended: 'finished' })
    expect(x.w.core.services.agent?.working(x.w.account.id)).toBe(true)
    expect(x.w.t.browser.page(x.w.account.id).disposed).toBe(1)

    both.releases[1]?.()
    await both.second
    expect(x.w.core.services.agent?.working(x.w.account.id)).toBe(false)
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

    expect(outcome).toEqual({ ended: 'finished', reported: { status: 'done', reason: 'Looked at the search.' }, humanCheck: null, error: null, said: 'Done.', outOfCalls: false })
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

  it('opens a window for the look, shows it without the focus, and closes it when the look is over, however it ends', async () => {
    const x = await ready()
    const page = x.w.t.browser.page(x.w.account.id)
    let whileRunning = -1
    asTheAI(x.w, async (call) => {
      await call('browser_snapshot')
      whileRunning = page.disposed
      await call('report_result', { status: 'done', reason: 'Looked.' })
    })
    await watch(x)
    expect(whileRunning).toBe(0) // the window stays through the look
    expect(x.w.t.browser.agentShown).toEqual([x.w.account.id])
    expect(x.w.t.browser.agentFocused).toEqual([]) // it is never put in front of what the owner is doing
    expect(page.disposed).toBe(1) // and goes with the look

    const failing = await ready()
    asTheAI(failing.w, async () => {
      throw new Error('the engine broke')
    })
    await watch(failing)
    expect(failing.w.t.browser.page(failing.w.account.id).disposed).toBe(1)
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

  it('keeps in the log how far a look got when it ends without saying how it went, and tells the flow its last words', async () => {
    const x = await ready()
    asTheAI(x.w, async (call) => {
      await call('browser_snapshot')
      await call('watch_open', { place: 2 })
      return 'I read the newest posts of the community and none of them is about the product.'
    })

    const outcome = await watch(x)

    expect(outcome).toMatchObject({ ended: 'finished', reported: null, said: 'I read the newest posts of the community and none of them is about the product.' })
    const line = x.w.core.log.list(50).find((entry) => /ended without a report/.test(entry.message))
    expect(line?.level).toBe('warn')
    expect(line?.message).toContain('2 tool calls, 0 posts recorded')
    expect(line?.message).toContain('The last page: www.instagram.com/explore/search/keyword/')
    expect(line?.message).toContain('The AI\'s last words: "I read the newest posts of the community and none of them is about the product."')
    // the address is logged without its query, and the page's own text is never logged
    expect(line?.message).not.toContain('q=astrology')
    expect(line?.message).not.toContain('Some posts')
  })

  it('does not log a look that said how it went as one that did not', async () => {
    const x = await ready()
    asTheAI(x.w, async (call) => {
      await call('report_result', { status: 'done', reason: 'Looked.' })
    })
    await watch(x)
    expect(x.w.core.log.list(50).some((entry) => /ended without a report/.test(entry.message))).toBe(false)
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
