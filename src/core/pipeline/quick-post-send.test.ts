// REQ-006 / DEC-044: an approved quick post (one picture and a caption, `postType: 'quick'`, stored as plain words) is sent with its picture on
// Instagram, Threads and Facebook, and what stops it is said at the approval, before the press.
//
// Three layers are driven together, with nothing faked in between but the page and the engine: the approval and the gate (the real ones), the
// mission authority (the real one: a gate renewal, the ticket bound to the approved draft), and the real post toolbox (browser_attach, the clicks
// that go on, browser_submit) working a stand-in composer page of the platform. So what is asserted is what the page was given: which file went
// into which input, and which characters were typed. Whether a REAL Instagram, Threads or Facebook composer behaves like the stand-in is not
// known: the real sites were not touched (live acceptance, issue #8).

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { judgedForFit, renderForPlatform } from '../../shared/post-format'
import type { MediaItem } from '../../shared/types'
import { BrowserToolbox } from '../browser-agent/toolbox'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import { ControlledSession } from '../browser-session'
import type { PageStep, PageStepResult } from '../ports'
import { FakePage } from '../testing/fakes'
import { chooseExecutor, sendWays } from './send-ways'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

// ───────────────────────────── pictures: valid down to the fields the code reads (lesson 189) ─────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG whose header says `width` × `height`; `extra` bytes follow it so a test can make the file big. */
function png(width: number, height: number, extra = 8): Buffer {
  const head = Buffer.alloc(33)
  Buffer.from(PNG_SIGNATURE).copy(head)
  head.writeUInt32BE(13, 8)
  head.write('IHDR', 12, 'latin1')
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return Buffer.concat([head, Buffer.alloc(extra, 7)])
}

/** A JPEG with a start-of-frame marker that says `width` × `height`. */
function jpeg(width: number, height: number): Buffer {
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01])
  return Buffer.concat([head, Buffer.alloc(16, 9)])
}

/** A GIF whose header says `width` × `height`. */
function gif(width: number, height: number): Buffer {
  const head = Buffer.alloc(13)
  head.write('GIF89a', 0, 'latin1')
  head.writeUInt16LE(width, 6)
  head.writeUInt16LE(height, 8)
  return Buffer.concat([head, Buffer.alloc(8, 5)])
}

/** A WebP (lossy) whose header says `width` × `height`. */
function webp(width: number, height: number): Buffer {
  const b = Buffer.alloc(40)
  b.write('RIFF', 0, 'latin1')
  b.writeUInt32LE(32, 4)
  b.write('WEBP', 8, 'latin1')
  b.write('VP8 ', 12, 'latin1')
  b.writeUInt16LE(width, 26)
  b.writeUInt16LE(height, 28)
  return b
}

// ───────────────────────────── the world: a channel the app does not read, on a platform with a composer dialog ─────────────────────────────

interface Platform {
  platform: 'instagram' | 'threads' | 'facebook'
  /** The channel's address, the page the compose dialog is on, and what its controls are called. */
  url: string
  page: string
  steps: string[]
  field: { role: string; name: string }
  submit: string
}

const PLATFORMS: Platform[] = [
  { platform: 'instagram', url: 'https://www.instagram.com/brand/', page: 'https://www.instagram.com/', steps: ['e3', 'e3'], field: { role: 'textarea', name: 'Write a caption...' }, submit: 'Share' },
  { platform: 'threads', url: 'https://www.threads.net/@brand', page: 'https://www.threads.net/', steps: [], field: { role: 'textbox', name: "What's new?" }, submit: 'Post' },
  { platform: 'facebook', url: 'https://www.facebook.com/brandpage', page: 'https://www.facebook.com/brandpage', steps: [], field: { role: 'textbox', name: "What's on your mind?" }, submit: 'Post' }
]
const byName = (name: string): Platform => PLATFORMS.find((p) => p.platform === name) as Platform

interface Item {
  ref: string
  role: string
  name: string
  near?: string
}

/**
 * A stand-in for the compose dialog of a platform: a hidden file input (which keeps the files of its LAST step, as a real one does), a button
 * that goes on to the next step, the caption field and the control that publishes. It records what it was given, never what the code meant to give.
 */
class ComposerPage extends FakePage {
  readonly items: Item[]
  readonly uploaded: string[][] = []
  readonly typed: { ref: string; text: string }[] = []
  readonly clicked: string[] = []
  /** What a press of the control that publishes put out: the caption as the field held it, and the files the input held. */
  readonly published: { caption: string; files: string[] }[] = []
  private held: string[] = []
  private readonly fields = new Map<string, string>()

  constructor(private readonly shape: Platform) {
    super()
    this.currentUrl = shape.page
    this.items = [
      { ref: 'e1', role: 'input:file', name: '', near: 'Create new post' },
      { ref: 'e2', role: 'button', name: 'Select from computer' },
      { ref: 'e3', role: 'button', name: 'Next' },
      { ref: 'e4', role: shape.field.role, name: shape.field.name },
      { ref: 'e5', role: 'button', name: shape.submit }
    ]
  }

  override async read<T>(script: string): Promise<T> {
    if (script.includes('ppd-document')) return '1' as T
    const files = /ppd-files (e\d+)/.exec(script)
    if (files) return (this.items.find((i) => i.ref === files[1])?.role === 'input:file' ? this.held.map((path) => ({ name: path.split('/').pop(), size: readFileSync(path).length })) : null) as T
    if (script.includes('ppd-form-text')) return [...this.fields].filter(([, text]) => text.trim() !== '').map(([ref, text]) => ({ ref, text })) as T
    if (script.includes('agent-snapshot')) return { url: this.currentUrl, title: 'New post', text: 'Create new post', alerts: [], humanCheck: '', elements: this.items } as T
    const field = /ppd-field (e\d+)/.exec(script)
    if (field) return (this.fields.get(field[1] as string) ?? null) as T
    return undefined as T
  }

  override async pageStep(step: PageStep): Promise<PageStepResult> {
    this.steps.push({ step, hosts: [] })
    if (!('ref' in step)) return { status: 'done', detail: 'ok' }
    if (step.do === 'upload') {
      const paths = [step.path, ...(step.also ?? [])]
      this.uploaded.push(paths)
      this.held = paths
    } else if (step.do === 'type') {
      this.typed.push({ ref: step.ref, text: step.text })
      this.fields.set(step.ref, step.text)
    } else if (step.do === 'click') {
      this.clicked.push(step.ref)
      if (step.ref === 'e5') {
        this.published.push({ caption: this.fields.get('e4') ?? '', files: [...this.held] })
        this.fields.clear()
      }
    }
    return { status: 'done', detail: 'ok' }
  }
}

/**
 * The AI of a post mission, as a script that does what the brief says (put the pictures in, go on, name the fields and the control) with the REAL
 * toolbox, the real authority of the send flow and the real ticket authority: the only fake things are the page and who is talking.
 */
class ComposerMissions implements PostMissionService {
  readonly requests: PostMissionRequest[] = []
  readonly pages: ComposerPage[] = []
  /** What each tool answered, in order: a refusal is read here when a step did not happen. */
  readonly told: string[] = []
  constructor(
    private readonly w: () => World,
    private readonly shape: Platform
  ) {}

  async run(request: PostMissionRequest): Promise<PostMissionOutcome> {
    this.requests.push(request)
    const page = new ComposerPage(this.shape)
    this.pages.push(page)
    const session = new ControlledSession(request.accountId, async () => page, this.w().core.tickets)
    const toolbox = new BrowserToolbox({
      withPage: (work) => session.withAgentControl('post', work),
      hosts: request.hosts,
      values: {},
      sleep: async () => undefined,
      say: () => undefined,
      ask: async () => 'done',
      note: () => undefined,
      report: () => undefined,
      askWaitMs: 20,
      post: { authority: request.authority, minGapMs: 0 }
    })
    const content = request.authority.content
    const did = async (tool: string, args: Record<string, unknown>): Promise<void> => {
      try {
        const result = await toolbox.call(tool, args)
        this.told.push(`${tool}: ${result.isError ? 'REFUSED ' : ''}${result.text}`)
      } catch (error) {
        this.told.push(`${tool}: THREW ${error instanceof Error ? error.stack : String(error)}`)
      }
    }
    await did('browser_snapshot', {})
    if ((content.attachments ?? []).length > 0) {
      await did('browser_attach', { ref: 'e1' })
      for (const step of this.shape.steps) await did('browser_click', { ref: step })
      await did('browser_snapshot', {})
    }
    await did('browser_submit', content.text.trim() === '' ? { submit_ref: 'e5' } : { text_ref: 'e4', submit_ref: 'e5' })
    return { ended: 'finished', committed: request.authority.committed, reported: null, humanCheck: null, warning: null, error: null }
  }
}

function setUp(name: Platform['platform']): { shape: Platform; missions: ComposerMissions } {
  const shape = byName(name)
  world = makeWorld({ mode: 'observe', baselineDone: false })
  world.connector.canRead = false
  world.channel = world.addChannel({ reads: false, baselineDone: false, mode: 'observe', status: 'active', target: '@brand', platform: name })
  world.core.db.prepare('UPDATE channels SET url = ? WHERE id = ?').run(shape.url, world.channel.id)
  world.channel = world.refresh()
  const missions = new ComposerMissions(() => world, shape)
  world.core.services.postMissions = missions
  return { shape, missions }
}

type Call = (method: string, args: unknown) => Promise<unknown>
const call = (): Call => (method, args) => (world.core.router as unknown as { call: Call }).call(method, args)

async function addPicture(bytes: Buffer, name = 'card.png'): Promise<MediaItem> {
  return (await call()('media.add', { productId: world.product.id, name, base64: bytes.toString('base64'), origin: 'picked' })) as MediaItem
}

const attach = (item: MediaItem) => ({ name: item.name, path: item.path, mime: '', sha256: '', mediaId: item.id })

/** A quick post for the channel, made the way the composer makes it: no title, no marks, one picture. */
async function quick(caption: string, picture: MediaItem): Promise<{ id: string }> {
  const created = (await call()('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', text: caption, attachments: [attach(picture)] } })) as { opportunity: { id: string } }
  return { id: created.opportunity.id }
}

const approve = (id: string): Promise<unknown> => call()('opportunities.approve', { id })

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

// ───────────────────────────── the path, platform by platform ─────────────────────────────

const CAPTION = 'Chart notes for the week ✨\n\n#astrology #natalchart @friend *not bold* _not italic_ 100% free?\nLine three.'

describe.each(PLATFORMS.map((p) => p.platform))('%s: an approved quick post is sent with its one picture and its caption, exactly', (name) => {
  it('is approved with the setting never touched, goes by the AI browser, and the page is given the approved file and the approved characters', async () => {
    const { missions } = setUp(name)
    expect(world.core.settings.app().publishWith).toBe('connector') // never chosen: this channel has no other way (DEC-035)
    const picture = await addPicture(png(1080, 1080))
    const { id } = await quick(CAPTION, picture)
    const draft = world.core.repos.latestDraft(id)!
    expect(draft).toMatchObject({ postType: 'quick', markup: 'legacy', title: null })

    await expect(approve(id)).resolves.toBeDefined()
    expect(sendWays(world.core, undefined, world.channel)).toEqual({ aiBrowser: true, noConnector: true })
    const action = await world.sending.send(id)

    expect(missions.requests).toHaveLength(1)
    const content = missions.requests[0]!.authority.content
    expect(content).toMatchObject({ kind: 'post', title: null, text: CAPTION, link: null, destination: world.channel.url })
    expect(content.attachments).toHaveLength(1)
    expect(content.attachments![0]).toMatchObject({ name: 'picture-1.png', path: picture.path, sha256: picture.sha256 })

    const page = missions.pages[0]!
    // The picture: the one library file, put into the file input once, and it is the file that was approved.
    expect(page.uploaded).toEqual([[picture.path]])
    expect(sha(page.uploaded[0]![0]!)).toBe(draft.attachments[0]!.sha256)
    // The caption: typed once, character for character (no Markdown reading of #, @, * or _), into the caption field and nowhere else.
    expect(page.typed).toEqual([{ ref: 'e4', text: CAPTION }])
    // The control that publishes was pressed once, by the application, after both were in.
    expect(page.published).toEqual([{ caption: CAPTION, files: [picture.path] }])
    expect(page.clicked.filter((ref) => ref === 'e5')).toHaveLength(1)
    // The app cannot read this platform back, so the result is the owner's to confirm (DEC-034).
    expect(action.state).toBe('unknown')
    expect(world.connector.published).toHaveLength(0)
  })

  it('a picture alone (no caption) is a post too: nothing is typed, the control is pressed under a ticket', async () => {
    const { missions } = setUp(name)
    const picture = await addPicture(png(1080, 1080))
    const { id } = await quick('', picture)
    await expect(approve(id)).resolves.toBeDefined()
    await world.sending.send(id)
    const page = missions.pages[0]!
    expect(page.uploaded).toEqual([[picture.path]])
    expect(page.typed).toEqual([])
    expect(page.published).toEqual([{ caption: '', files: [picture.path] }])
  })

  it('sends nothing for a caption or a picture that is not the one approved: the gate asks again at the press', async () => {
    const { missions } = setUp(name)
    const picture = await addPicture(png(1080, 1080))
    const { id } = await quick('The approved caption.', picture)
    await approve(id)
    // the caption changes behind the approval
    const draft = world.core.repos.latestDraft(id)!
    world.core.db.prepare('UPDATE drafts SET text = ? WHERE id = ?').run('Another caption.', draft.id)
    await expect(world.sending.send(id)).rejects.toMatchObject({ block: { code: 'approval_stale', effect: 'review' } })
    expect(missions.requests).toHaveLength(0)

    // approved again, then the picture file changes on disk
    world.core.db.prepare('UPDATE drafts SET text = ? WHERE id = ?').run('The approved caption.', draft.id)
    await approve(id)
    writeFileSync(picture.path, png(1080, 1080, 40))
    await expect(world.sending.send(id)).rejects.toMatchObject({ block: { code: 'attachment_changed', effect: 'review' } })
    expect(missions.requests).toHaveLength(0)
  })

  it('an edit of the caption or of the picture withdraws the approval: it must be approved again before anything is sent', async () => {
    const { missions } = setUp(name)
    const picture = await addPicture(png(1080, 1080))
    const other = await addPicture(png(1080, 1350), 'other.png')
    const { id } = await quick('The approved caption.', picture)
    await approve(id)
    await call()('opportunities.saveDraft', { id, draft: { text: 'A changed caption.', attachments: [attach(picture)] } })
    await expect(world.sending.send(id)).rejects.toThrow()
    await approve(id)
    await call()('opportunities.saveDraft', { id, draft: { text: 'A changed caption.', attachments: [attach(other)] } })
    await expect(world.sending.send(id)).rejects.toThrow()
    expect(missions.requests).toHaveLength(0)
    await approve(id)
    await world.sending.send(id)
    expect(missions.pages[0]!.published).toEqual([{ caption: 'A changed caption.', files: [other.path] }])
  })

  it('is never sent by a scheduled or an automatic send: the AI browser carries only a press of the owner, and Approve says so before', async () => {
    const { missions } = setUp(name)
    const picture = await addPicture(png(1080, 1080))
    const { id } = await quick('A caption.', picture)
    await approve(id)
    const sending = world.sending as unknown as { send(id: string, options: { automatic: boolean }): Promise<unknown> }
    await expect(sending.send(id, { automatic: true })).rejects.toMatchObject({ message: expect.stringMatching(/scheduled or automatic send.*press Send/s) })
    expect(missions.requests).toHaveLength(0)
  })
})

// ───────────────────────────── what stops it is said at the approval, before the press ─────────────────────────────

const refusal = async (name: Platform['platform'], caption: string, bytes: Buffer): Promise<string | null> => {
  setUp(name)
  const picture = await addPicture(bytes)
  const { id } = await quick(caption, picture)
  try {
    await approve(id)
    return null
  } catch (error) {
    expect((error as { code: string }).code).toBe('post_does_not_fit')
    return (error as Error).message
  }
}

describe('the caption is judged as it is written, against the limit of the platform', () => {
  it.each([
    ['instagram', 2200, true],
    ['instagram', 2201, false],
    ['threads', 500, true],
    ['threads', 501, false],
    ['facebook', 5000, true]
  ] as const)('%s: a caption of %i characters is %s', async (name, length, fits) => {
    const said = await refusal(name, 'a'.repeat(length), png(1080, 1080))
    if (fits) expect(said).toBeNull()
    else expect(said).toMatch(new RegExp(`The text is ${length} characters; ${name === 'instagram' ? 'Instagram' : 'Threads'} allows ${length === 2201 ? 2200 : 500}`))
  })

  it('counts characters, not UTF-16 units: 500 emoji fit on Threads and 501 do not', async () => {
    expect(await refusal('threads', '🙂'.repeat(500), png(1080, 1080))).toBeNull()
    expect(await refusal('threads', '🙂'.repeat(501), png(1080, 1080))).toMatch(/501 characters; Threads allows 500/)
  })

  it('does not read the caption as Markdown: marks count as the characters they are', async () => {
    // 250 × "**" is 500 characters on the page, and would be 0 if the marks were read as emphasis
    expect(await refusal('threads', '**'.repeat(250), png(1080, 1080))).toBeNull()
    expect(await refusal('threads', '**'.repeat(251), png(1080, 1080))).toMatch(/502 characters; Threads allows 500/)
  })

  it('counts a link added to the end of the text (Threads has no link field)', async () => {
    setUp('threads')
    const picture = await addPicture(png(1080, 1080))
    const created = (await call()('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', text: 'x'.repeat(480), link: 'https://natalmystic.com', attachments: [attach(picture)] } })) as { opportunity: { id: string } }
    await expect(approve(created.opportunity.id)).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/505 characters; Threads allows 500/) })
  })

  it('says all of it at once, in words, and nothing was approved', async () => {
    setUp('threads')
    const picture = await addPicture(webp(1080, 1080))
    const { id } = await quick('b'.repeat(600), picture)
    await expect(approve(id)).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/600 characters; Threads allows 500.*Threads takes PNG or JPEG pictures; this one is WebP/) })
    expect(world.core.repos.activeApproval(world.core.repos.latestDraft(id)!.id)).toBeNull()
  })
})

describe('the picture is judged by the platform that has to take it', () => {
  it.each([
    ['square 1080 × 1080', 1080, 1080, true],
    ['portrait 1080 × 1350 (4:5, the tallest)', 1080, 1350, true],
    ['wide 1080 × 566 (1.91:1, the widest)', 1080, 566, true],
    ['one pixel under the wide end, 1080 × 565', 1080, 565, true],
    ['a little taller than 4:5, 1080 × 1351 (inside the slack)', 1080, 1351, true],
    ['too tall, 1080 × 1360', 1080, 1360, false],
    ['too tall, 1000 × 2000', 1000, 2000, false],
    ['too wide, 1080 × 540 (2:1)', 1080, 540, false],
    ['too wide, 3000 × 1000', 3000, 1000, false]
  ] as const)('Instagram: %s', async (_label, width, height, fits) => {
    const said = await refusal('instagram', 'A caption.', png(width, height))
    if (fits) expect(said).toBeNull()
    else expect(said).toMatch(new RegExp(`${width} × ${height} pixels, ${height > width ? 'taller' : 'wider'} than Instagram takes .*${height > width ? '4:5' : '1.91:1'}.*crop`))
  })

  it.each([
    ['png', png(1080, 1080)],
    ['jpeg', jpeg(1080, 1080)]
  ] as const)('Instagram, Threads and Facebook take a %s', async (_type, bytes) => {
    for (const name of ['instagram', 'threads', 'facebook'] as const) expect(await refusal(name, 'A caption.', bytes)).toBeNull()
  })

  it.each([
    ['instagram', 'gif', gif(1080, 1080), /Instagram takes PNG or JPEG pictures; this one is GIF/],
    ['instagram', 'webp', webp(1080, 1080), /Instagram takes PNG or JPEG pictures; this one is WebP/],
    ['threads', 'gif', gif(1080, 1080), /Threads takes PNG or JPEG pictures; this one is GIF/],
    ['threads', 'webp', webp(1080, 1080), /Threads takes PNG or JPEG pictures; this one is WebP/],
    ['facebook', 'webp', webp(1080, 1080), /Facebook takes PNG, JPEG or GIF pictures; this one is WebP/]
  ] as const)('%s refuses a %s with the way out', async (name, _type, bytes, words) => {
    expect(await refusal(name, 'A caption.', bytes)).toMatch(words)
  })

  it('Facebook takes a GIF and a picture of any shape', async () => {
    expect(await refusal('facebook', 'A caption.', gif(1080, 1080))).toBeNull()
    expect(await refusal('facebook', 'A caption.', png(4000, 400))).toBeNull()
    expect(await refusal('facebook', 'A caption.', png(400, 4000))).toBeNull()
  })

  it('Threads takes a very wide or tall picture up to 10:1 and refuses beyond it', async () => {
    expect(await refusal('threads', 'A caption.', png(3000, 400))).toBeNull()
    expect(await refusal('threads', 'A caption.', png(3000, 250))).toMatch(/wider than Threads takes/)
    expect(await refusal('threads', 'A caption.', png(250, 3000))).toMatch(/taller than Threads takes/)
  })

  it('Instagram and Threads refuse a picture over 8 MB, and take one just under it', async () => {
    const MB = 1024 * 1024
    expect(await refusal('instagram', 'A caption.', png(1080, 1080, 8 * MB - 100))).toBeNull()
    expect(await refusal('instagram', 'A caption.', png(1080, 1080, 9 * MB))).toMatch(/The picture is 9 MB; Instagram takes up to 8 MB/)
    expect(await refusal('threads', 'A caption.', png(1080, 1080, 9 * MB))).toMatch(/The picture is 9 MB; Threads takes up to 8 MB/)
    expect(await refusal('facebook', 'A caption.', png(1080, 1080, 9 * MB))).toBeNull()
  })

  it('a picture whose header gives no shape is not refused for it (a header that says 0 × 0 is not a shape)', async () => {
    expect(await refusal('instagram', 'A caption.', png(0, 0))).toBeNull()
  })

  it('Instagram needs a picture: a quick post that lost it is refused with the words, and so is a text-only post with none to send', async () => {
    setUp('instagram')
    const picture = await addPicture(png(1080, 1080))
    const { id } = await quick('A caption.', picture)
    world.core.db.prepare("UPDATE drafts SET attachments_json = '[]' WHERE opportunity_id = ?").run(id)
    await expect(approve(id)).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/Instagram needs a picture: add one/) })
  })
})

describe('the gate asks again at the press', () => {
  it('a picture the platform would refuse (the rule or the library row changed since the approval) is not sent, with the words', async () => {
    const { missions } = setUp('instagram')
    const picture = await addPicture(png(1080, 1080))
    const { id } = await quick('A caption.', picture)
    await approve(id)
    // the library row now says the picture is 1000 × 2000
    world.core.db.prepare('UPDATE media SET width = 1000, height = 2000 WHERE id = ?').run(picture.id)
    await expect(world.sending.send(id)).rejects.toMatchObject({ block: { code: 'post_does_not_fit', effect: 'review' }, message: expect.stringMatching(/taller than Instagram takes/) })
    expect(missions.requests).toHaveLength(0)
  })

  it('the caption over the limit at the press is not sent either', async () => {
    const { missions } = setUp('threads')
    const picture = await addPicture(png(1080, 1080))
    const { id } = await quick('A caption.', picture)
    await approve(id)
    const draft = world.core.repos.latestDraft(id)!
    world.core.db.prepare('UPDATE drafts SET text = ? WHERE id = ?').run('c'.repeat(501), draft.id)
    // the approval is bound to the text, so the gate says that first; both are a stop with nothing sent
    await expect(world.sending.send(id)).rejects.toMatchObject({ block: { effect: 'review' } })
    expect(missions.requests).toHaveLength(0)
  })
})

describe('the group view and the preview judge a quick post by the same rules as the approval (lesson 209)', () => {
  it('postGroups.channels says a quick post does not fit Instagram with a tall picture, and fits Threads', async () => {
    setUp('instagram')
    const instagram = world.channel
    const threads = world.addChannel({ reads: false, baselineDone: false, mode: 'observe', status: 'active', target: '@brand-threads', platform: 'threads' })
    const picture = await addPicture(png(1000, 2000))
    const options = (await call()('postGroups.channels', { productId: world.product.id, draft: { postType: 'quick', text: 'A caption.', attachments: [attach(picture)] } })) as { channelId: string; fits: boolean; reason: string }[]
    const forInstagram = options.find((o) => o.channelId === instagram.id)!
    expect(forInstagram.fits).toBe(false)
    expect(forInstagram.reason).toMatch(/taller than Instagram takes/)
    // 1000 × 2000 is inside Threads' 10:1, and a PNG: it fits
    expect(options.find((o) => o.channelId === threads.id)!.fits).toBe(true)
  })

  it('the render says the same problems the approval says: one function, the caption counted as it is written', () => {
    const base = { title: null, link: null, attachments: [], markup: 'legacy' as const }
    const quickDraft = { ...base, postType: 'quick' as const, text: 'q'.repeat(501) }
    expect(judgedForFit(quickDraft)).toBe(true)
    expect(renderForPlatform(quickDraft, 'threads').problems).toEqual(['The text is 501 characters; Threads allows 500.'])
    expect(renderForPlatform(quickDraft, 'threads').text).toBe('q'.repeat(501))
    // an older draft is judged by its connector, as before: nothing is said of the same words
    expect(judgedForFit(base)).toBe(false)
    expect(renderForPlatform({ ...base, text: 'q'.repeat(501) }, 'threads').problems).toEqual([])
    expect(judgedForFit({ ...base, markup: 'markdown' })).toBe(true)
  })
})

describe('an older or article draft is judged as before (this slice changes picture sending of quick posts only)', () => {
  it('a legacy draft on Threads over the limit, with a WebP picture, is still approved: its connector judges it', async () => {
    setUp('threads')
    const picture = await addPicture(webp(1080, 1080))
    const created = (await call()('publications.create', { channelId: world.channel.id, draft: { text: 'd'.repeat(600), attachments: [attach(picture)] } })) as { opportunity: { id: string } }
    await expect(approve(created.opportunity.id)).resolves.toBeDefined()
  })

  it('a markdown post on Instagram with a tall picture is still approved (its pictures were never judged by shape)', async () => {
    setUp('instagram')
    const picture = await addPicture(png(1000, 2000))
    const created = (await call()('publications.create', { channelId: world.channel.id, draft: { text: 'A caption.', markup: 'markdown', attachments: [attach(picture)] } })) as { opportunity: { id: string } }
    await expect(approve(created.opportunity.id)).resolves.toBeDefined()
  })
})

describe('who carries a quick post on a channel the app CAN read (a site profile exists for it)', () => {
  it('the AI browser, when the owner chose it; and without that Approve says what to choose instead of the connector failing at the press', async () => {
    world = makeWorld()
    const channel = world.addChannel({ platform: 'facebook', target: 'brandpage', reads: true })
    const picture = await addPicture(png(1080, 1080))
    const created = (await call()('publications.create', { channelId: channel.id, draft: { postType: 'quick', text: 'A caption.', attachments: [attach(picture)] } })) as { opportunity: { id: string } }
    await expect(approve(created.opportunity.id)).rejects.toMatchObject({ code: 'post_does_not_fit', message: expect.stringMatching(/Pictures go to Facebook only through the AI browser/) })

    world.core.services.postMissions = new ComposerMissions(() => world, byName('facebook'))
    world.core.settings.updateApp({ publishWith: 'ai_browser' })
    await expect(approve(created.opportunity.id)).resolves.toBeDefined()
    const draft = world.core.repos.latestDraft(created.opportunity.id)!
    expect(chooseExecutor(sendWays(world.core, undefined, channel), draft, 'facebook')).toBe('ai_browser')
    // an older draft with a picture keeps going through its connector, as before
    expect(chooseExecutor(sendWays(world.core, undefined, channel), { ...draft, postType: 'article' }, 'facebook')).toBe('connector')
  })
})
