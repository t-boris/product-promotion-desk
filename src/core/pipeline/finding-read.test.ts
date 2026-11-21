// "Check with AI" on one post of the Feed: the AI opens the post in the channel's account and reads it in full; what it read is kept on the post (the thread,
// the analysis, the topics, the pictures). Through the API the owner presses (findings.readNow), with the AI's browser replaced by a scripted one.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WatchItem, WatchMissionRequest, WatchMissionService, WatchOutcome } from '../browser-agent/watch'
import type { DownloadDeps } from './picture-download'
import { FindingStore } from './findings'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  vi.restoreAllMocks()
  await closeWorld(world)
})

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8), Buffer.from([0, 0, 0, 4, 0, 0, 0, 3]), Buffer.alloc(20)])
const finished = (over: Partial<WatchOutcome> = {}): WatchOutcome => ({ ended: 'finished', reported: { status: 'done', reason: 'Read it.' }, humanCheck: null, error: null, said: '', outOfCalls: false, ...over })

class Reading implements WatchMissionService {
  readonly requests: WatchMissionRequest[] = []
  recorded: { stored: number; known: number; refused?: string[] }[] = []
  ready: { ready: boolean; reason: string | null } = { ready: true, reason: null }
  script: (request: WatchMissionRequest) => WatchOutcome | Promise<WatchOutcome> = () => finished()
  async watchReady(): Promise<{ ready: boolean; reason: string | null }> {
    return this.ready
  }
  async watch(request: WatchMissionRequest): Promise<WatchOutcome> {
    this.requests.push(request)
    return this.script(request)
  }
}

const URL_ = 'https://www.reddit.com/r/astrology/comments/abc123/which_app'
const read = (over: Partial<WatchItem> = {}): WatchItem => ({
  url: URL_,
  title: 'Which app draws a chart with houses?',
  author: 'poster',
  label: 'notice',
  relation: 'Asks for a chart tool.',
  about: 'The author asks which app shows the houses of a natal chart.',
  thread: 'Two people name apps; nobody explains the houses.',
  replyTo: '',
  comment: '',
  comments: [
    { author: 'anna', text: 'Try a free chart site', depth: 0, url: '' },
    { author: 'poster', text: 'Thanks, what do the houses mean?', depth: 1, url: '' }
  ],
  analysis: 'People recommend free chart sites. Nobody has explained what the houses mean, which is what the author wanted to know.',
  topics: [
    { topic: 'What the houses mean', idea: 'A short post: the twelve houses as twelve areas of life.' },
    { topic: 'Free chart sites', idea: 'Compare what a free chart shows and what it leaves out.' }
  ],
  images: [{ url: 'https://i.redd.it/chart.png', alt: 'A natal chart wheel' }],
  own: false,
  ...over
})

function setup(): { ai: Reading; id: string; fetched: string[] } {
  world = makeWorld({ mode: 'draft' })
  const ai = new Reading()
  world.core.services.watchMissions = ai
  const fetched: string[] = []
  const deps: DownloadDeps = {
    lookup: async () => ['93.184.216.34'],
    fetch: async (url) => {
      fetched.push(url)
      return new Response(PNG, { status: 200 })
    }
  }
  world.core.services.pictureDeps = deps
  new FindingStore(world.core).addWatched(
    world.product.id,
    world.channel.id,
    { url: URL_, title: 'Which app draws a chart with houses?', author: 'poster', label: 'notice', relation: 'Asks for a chart tool.', about: '', thread: '', replyTo: '', comment: '', comments: [], analysis: '', topics: [], images: [], own: false },
    false
  )
  const id = (world.core.db.prepare('SELECT id FROM findings ORDER BY rowid DESC LIMIT 1').get() as { id: string }).id
  return { ai, id, fetched }
}

const readNow = (id: string) => world.core.router.call('findings.readNow', { id })
const card = async (id: string) => (await world.core.router.call('findings.list', { productId: world.product.id })).find((c) => c.finding.id === id)?.finding

describe('Check with AI on a post', () => {
  it('opens the post alone, for the account of its channel, with the read brief and the allowance of a reading', async () => {
    const { ai, id } = setup()
    ai.script = (request) => {
      request.record([read()])
      return finished()
    }
    await readNow(id)
    expect(ai.requests).toHaveLength(1)
    const request = ai.requests[0]
    expect(request).toMatchObject({ accountId: world.account.id, channelId: world.channel.id })
    expect(request.brief).toMatchObject({ mode: 'read', maxPosts: 1, maxCalls: 40, known: [], firstLook: false })
    expect(request.brief.places).toEqual([{ label: 'The post to read: Which app draws a chart with houses?', url: URL_ }])
  })

  it('keeps what the AI read on the post: the summary, the thread, the analysis, the topics, the comments and the read time', async () => {
    const { ai, id } = setup()
    ai.script = (request) => {
      request.record([read()])
      return finished()
    }
    const before = await card(id)
    expect(before).toMatchObject({ about: '', analysis: '', topics: [], readAt: null })

    expect(await readNow(id)).toMatchObject({ state: 'read' })

    const after = await card(id)
    expect(after).toMatchObject({
      about: 'The author asks which app shows the houses of a natal chart.',
      thread: 'Two people name apps; nobody explains the houses.',
      analysis: expect.stringContaining('Nobody has explained what the houses mean'),
      topics: [
        { topic: 'What the houses mean', idea: 'A short post: the twelve houses as twelve areas of life.' },
        { topic: 'Free chart sites', idea: 'Compare what a free chart shows and what it leaves out.' }
      ],
      readAt: world.clock.now().toISOString(),
      label: 'notice'
    })
    expect((await world.core.router.call('findings.thread', { id })).map((c) => c.author)).toEqual(['anna', 'poster'])
  })

  it('fetches the pictures it named and shows them: waiting while the file is not here, ready after, as a data address', async () => {
    const { ai, id, fetched } = setup()
    ai.script = (request) => {
      request.record([read()])
      return finished()
    }
    await readNow(id)
    expect(fetched).toEqual(['https://i.redd.it/chart.png'])
    const pictures = await world.core.router.call('findings.pictures', { id })
    expect(pictures).toEqual([{ id: expect.any(String), alt: 'A natal chart wheel', width: 4, height: 3, state: 'ready', failure: '' }])
    const shown = await world.core.router.call('findings.picture', { id: pictures[0].id })
    expect(shown?.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(await world.core.router.call('findings.picture', { id: 'no-such-picture' })).toBeNull()
  })

  it('shows a picture the image tools of the system cannot read (a webp, which Reddit serves) as the file itself', async () => {
    const { ai, id } = setup()
    ;(world.core as { mediaTools: unknown }).mediaTools = {
      pick: async () => [],
      reveal: () => undefined,
      thumbnail: async () => {
        throw new Error('The picture could not be read.')
      }
    }
    ai.script = (request) => {
      request.record([read()])
      return finished()
    }
    await readNow(id)
    const [picture] = await world.core.router.call('findings.pictures', { id })
    expect(picture.state).toBe('ready')
    const shown = await world.core.router.call('findings.picture', { id: picture.id })
    expect(shown?.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('says why a picture could not be had, and the card still has everything else', async () => {
    const { ai, id } = setup()
    world.core.services.pictureDeps = { lookup: async () => ['93.184.216.34'], fetch: async () => new Response('no', { status: 403 }) }
    ai.script = (request) => {
      request.record([read()])
      return finished()
    }
    expect(await readNow(id)).toMatchObject({ state: 'read' })
    const [picture] = await world.core.router.call('findings.pictures', { id })
    expect(picture).toMatchObject({ state: 'failed', failure: expect.stringMatching(/not signed in/) })
    expect(await world.core.router.call('findings.picture', { id: picture.id })).toBeNull()
    expect((await card(id))?.analysis).not.toBe('')
  })

  it('keeps the verdict, except that a post the AI now calls worth a reply is one and starts starred', async () => {
    const { ai, id } = setup()
    ai.script = (request) => {
      request.record([read({ relation: 'Worth a reply: the question is still open.', replyTo: 'The author.', comment: 'Houses split the sky by the time and place of birth.' })])
      return finished()
    }
    expect((await card(id))?.starredAt).toBeNull()
    await readNow(id)
    expect(await card(id)).toMatchObject({ relation: 'Worth a reply: the question is still open.', suggestedComment: 'Houses split the sky by the time and place of birth.', replyTo: 'The author.' })
    expect((await card(id))?.starredAt).not.toBeNull()
  })

  it('does not take a star away, nor lower a post that was worth a reply, when the AI reads it again as a notice', async () => {
    const { ai, id } = setup()
    world.core.db.prepare("UPDATE findings SET relation = 'Worth a reply: asks.', starred_at = ? WHERE id = ?").run(world.clock.now().toISOString(), id)
    ai.script = (request) => {
      request.record([read({ relation: 'Asks for a chart tool.' })])
      return finished()
    }
    await readNow(id)
    expect(await card(id)).toMatchObject({ relation: 'Worth a reply: asks.' })
    expect((await card(id))?.starredAt).not.toBeNull()
  })

  it('replaces the comments when it reads the post again, and keeps a picture it has already, adding the new ones', async () => {
    const { ai, id, fetched } = setup()
    ai.script = (request) => {
      request.record([read()])
      return finished()
    }
    await readNow(id)
    ai.script = (request) => {
      request.record([read({ comments: [{ author: 'zed', text: 'A new answer', depth: 0, url: '' }], images: [{ url: 'https://i.redd.it/chart.png', alt: '' }, { url: 'https://i.redd.it/second.png', alt: 'A second picture' }] })])
      return finished()
    }
    await readNow(id)
    expect((await world.core.router.call('findings.thread', { id })).map((c) => c.author)).toEqual(['zed'])
    expect(await world.core.router.call('findings.pictures', { id })).toHaveLength(2)
    expect(fetched).toEqual(['https://i.redd.it/chart.png', 'https://i.redd.it/second.png'])
  })

  it('keeps at most four pictures of a post', async () => {
    const { ai, id } = setup()
    ai.script = (request) => {
      request.record([read({ images: Array.from({ length: 4 }, (_, i) => ({ url: `https://i.redd.it/${i}.png`, alt: '' })) })])
      return finished()
    }
    await readNow(id)
    ai.script = (request) => {
      request.record([read({ images: [{ url: 'https://i.redd.it/extra.png', alt: '' }] })])
      return finished()
    }
    await readNow(id)
    expect(await world.core.router.call('findings.pictures', { id })).toHaveLength(4)
  })

  it('records the post once: what it gives after the first is refused and said to the AI', async () => {
    const { ai, id } = setup()
    let second: { stored: number; known: number; refused?: string[] } | null = null
    ai.script = (request) => {
      request.record([read()])
      second = request.record([read({ analysis: 'Something else.' })])
      return finished()
    }
    await readNow(id)
    expect(second).toMatchObject({ stored: 1, refused: [expect.stringMatching(/one post and it is recorded/)] })
    expect((await card(id))?.analysis).toMatch(/Nobody has explained/)
  })

  it('refuses a record that carries nothing of what it read, tells the AI to read first, and says it did not save', async () => {
    const { ai, id } = setup()
    let answer: { stored: number; known: number; refused?: string[] } | null = null
    ai.script = (request) => {
      answer = request.record([read({ about: '', thread: '', analysis: '', comments: [], topics: [], images: [] })])
      return finished()
    }
    const result = await readNow(id)
    expect(answer).toMatchObject({ stored: 0, refused: [expect.stringMatching(/Read the post first/)] })
    expect(result).toMatchObject({ state: 'failed', message: expect.stringMatching(/did not save what it read/) })
    expect(await card(id)).toMatchObject({ about: '', readAt: null })
  })

  it('marks the post of the account itself as its own, found by its author', async () => {
    const { ai, id } = setup()
    world.core.db.prepare("UPDATE accounts SET identity = 'poster' WHERE id = ?").run(world.account.id)
    ai.script = (request) => {
      request.record([read()])
      return finished()
    }
    await readNow(id)
    expect((await card(id))?.own).toBe(true)
  })

  it('changes nothing else: no opportunity, no draft, no send', async () => {
    const { ai, id } = setup()
    ai.script = (request) => {
      request.record([read({ relation: 'Worth a reply: x.', replyTo: 'The author.', comment: 'Houses split the sky.' })])
      return finished()
    }
    await readNow(id)
    for (const table of ['opportunities', 'drafts', 'send_actions']) {
      expect((world.core.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, table).toBe(0)
    }
  })
})

describe('Check with AI when the AI cannot read the post', () => {
  it('says the AI is not ready, and does not start', async () => {
    const { ai, id } = setup()
    ai.ready = { ready: false, reason: 'Sign in to the account first.' }
    expect(await readNow(id)).toEqual({ state: 'unavailable', message: 'Sign in to the account first.' })
    expect(ai.requests).toEqual([])
  })

  it('leaves a paused channel alone', async () => {
    const { ai, id } = setup()
    world.core.db.prepare("UPDATE channels SET status = 'paused' WHERE id = ?").run(world.channel.id)
    expect(await readNow(id)).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/paused/) })
    expect(ai.requests).toEqual([])
  })

  it('says the browser was busy, that the owner stopped it, that it timed out or broke, that a check stopped it, and what the AI said', async () => {
    const { ai, id } = setup()
    const outcome = async (over: Partial<WatchOutcome>) => {
      ai.script = () => finished(over)
      return readNow(id)
    }
    expect(await outcome({ ended: 'busy' })).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/in use/) })
    expect(await outcome({ ended: 'stopped' })).toEqual({ state: 'stopped', message: 'You stopped the AI.' })
    expect(await outcome({ ended: 'timeout' })).toMatchObject({ state: 'failed', message: expect.stringMatching(/did not finish/) })
    expect(await outcome({ ended: 'error', error: 'engine died' })).toEqual({ state: 'failed', message: 'The AI stopped because of an error: engine died' })
    expect(await outcome({ humanCheck: 'a visible check frame' })).toMatchObject({ state: 'failed', message: expect.stringMatching(/human check/) })
    expect(await outcome({ reported: { status: 'needs_owner', reason: 'Sign in again.' } })).toEqual({ state: 'failed', message: 'The AI needs you: Sign in again.' })
    expect(await outcome({ reported: { status: 'failed', reason: 'The post is gone.' } })).toEqual({ state: 'failed', message: 'The AI could not read the post: The post is gone.' })
    expect(await outcome({ reported: null, said: 'I looked.' })).toMatchObject({ state: 'failed', message: expect.stringContaining('I looked.') })
  })

  it('answers a second press on the post while it is being read, and starts one reading only', async () => {
    const { ai, id } = setup()
    let release: () => void = () => undefined
    ai.script = async (request) => {
      await new Promise<void>((resolve) => (release = resolve))
      request.record([read()])
      return finished()
    }
    const first = readNow(id)
    await vi.waitFor(() => expect(ai.requests).toHaveLength(1))
    expect(await readNow(id)).toEqual({ state: 'unavailable', message: 'The AI is reading this post already.' })
    release()
    expect(await first).toMatchObject({ state: 'read' })
    expect(ai.requests).toHaveLength(1)
  })

  it('refuses a post that is not there and a missing id', async () => {
    setup()
    await expect(readNow('no-such-post')).rejects.toMatchObject({ code: 'not_found' })
    await expect(readNow('')).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('is unavailable when this version has no AI browser', async () => {
    const { id } = setup()
    world.core.services.watchMissions = undefined
    expect(await readNow(id)).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/not available/) })
  })
})
