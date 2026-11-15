// DEC-031: the AI browser carries the pictures of an approved post. What the toolbox holds to: a picture goes into a form only by its approved
// name, only into a file input the AI was shown, only on the approved page, only while no form holds text, only if the file is still the
// one that was approved, and once; from the first picture on only a step forward is clicked; and nothing publishes without browser_submit.

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlledSession } from '../browser-session'
import type { PageStep, PageStepResult } from '../ports'
import { FakeClock, FakePage } from '../testing/fakes'
import { TicketAuthority } from '../tickets'
import { TestAuthority } from './post-test-helpers'
import type { ApprovedContent, ApprovedFile } from './post-submit'
import { BrowserToolbox } from './toolbox'

interface Item {
  ref: string
  role: string
  name: string
  disabled?: boolean
  submits?: boolean
}

/** A new-post wizard like the ones of the sites that take pictures: a file input, Next, a caption, Share, and decoys. */
class WizardPage extends FakePage {
  items: Item[] = [
    { ref: 'e1', role: 'input:file', name: 'Select pictures' },
    { ref: 'e2', role: 'button', name: 'Select from computer' },
    { ref: 'e3', role: 'button', name: 'Next' },
    { ref: 'e4', role: 'textarea', name: 'Write a caption' },
    { ref: 'e5', role: 'button', name: 'Share' },
    { ref: 'e6', role: 'button', name: 'Done' },
    { ref: 'e7', role: 'button', name: 'Create' },
    { ref: 'e8', role: 'input:file', name: 'Other file input', disabled: true },
    { ref: 'e9', role: 'button', name: 'Continue' },
    { ref: 'e10', role: 'combobox', name: 'Audience' }
  ]
  fields = new Map<string, string>()
  /** Every upload step, in order: the paths it carried. */
  readonly uploaded: { ref: string; paths: string[] }[] = []
  /** What the file input holds now: an input keeps the files of its LAST step, as a real one does. */
  held: string[] = []
  /** A site that reads the files and empties the input at once (a wizard). */
  clearsInput = false
  /** The document: a new one starts on every load but a change of the fragment. */
  document = 1
  /** What a form-aware page says about the forms of elements, by ref. */
  forms: Record<string, number> = {}
  readonly clicked: string[] = []
  /** What a press of Share published: the caption and how many pictures were in the form. */
  readonly shared: { caption: string; pictures: number }[] = []

  override async goto(url: string): Promise<void> {
    const previous = this.currentUrl
    await super.goto(url)
    this.currentUrl = url
    if (url.includes('#') && url.split('#')[0] === previous.split('#')[0]) return
    this.document += 1
    this.fields.clear()
    this.held = []
  }
  /** A link that loads a page of its own (the document changes, the form is empty). */
  loadAnotherDocument(): void {
    this.document += 1
    this.fields.clear()
    this.held = []
  }
  override async read<T>(script: string): Promise<T> {
    if (script.includes('ppd-document')) return String(this.document) as T
    const files = /ppd-files (e\d+)/.exec(script)
    if (files) {
      const item = this.items.find((i) => i.ref === files[1])
      if (item?.role !== 'input:file') return null as T
      return this.held.map((path) => ({ name: path.split('/').pop(), size: statSync(path).size })) as T
    }
    if (script.includes('ppd-form-text')) return [...this.fields].filter(([, text]) => text.trim() !== '').map(([ref, text]) => ({ ref, text })) as T
    if (script.includes('agent-snapshot')) return { url: this.currentUrl, title: 'New post', text: 'Create a post', alerts: [], humanCheck: '', elements: this.items.map((i) => ({ ...i, ...(this.forms[i.ref] !== undefined ? { form: this.forms[i.ref] } : {}) })) } as T
    const field = /ppd-field (e\d+)/.exec(script)
    if (field) return (this.fields.get(field[1] as string) ?? null) as T
    return undefined as T
  }
  override async pageStep(step: PageStep): Promise<PageStepResult> {
    this.steps.push({ step, hosts: [] })
    if (!('ref' in step)) return { status: 'done', detail: 'ok' }
    const item = this.items.find((i) => i.ref === step.ref)
    if (!item) return { status: 'not_found', detail: 'no such element' }
    if (step.do === 'upload') {
      const paths = [step.path, ...(step.also ?? [])]
      this.uploaded.push({ ref: step.ref, paths })
      this.held = this.clearsInput ? [] : paths
      return { status: 'done', detail: 'uploaded' }
    }
    if (step.do === 'type') {
      this.fields.set(step.ref, step.text)
      return { status: 'done', detail: 'typed' }
    }
    if (step.do === 'click') {
      this.clicked.push(step.ref)
      if (step.ref === 'e5') {
        this.shared.push({ caption: this.fields.get('e4') ?? '', pictures: this.held.length })
        this.fields.clear()
      }
    }
    return { status: 'done', detail: 'ok' }
  }
}

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

function approvedFile(name: string, bytes = name): ApprovedFile {
  const folder = (dir ??= mkdtempSync(join(tmpdir(), 'ppd-attach-')))
  const path = join(folder, name)
  writeFileSync(path, bytes)
  return { name, path, sha256: createHash('sha256').update(bytes).digest('hex') }
}

const REDDIT = 'https://fake.test/r/test'
const content = (over: Partial<ApprovedContent> = {}): ApprovedContent => ({ kind: 'post', title: null, text: 'A caption for the picture.', link: null, destination: REDDIT, attachments: [approvedFile('first.png'), approvedFile('second.png')], ...over })

function setup(approved: ApprovedContent = content(), url = 'https://fake.test/r/test/submit', submitName = 'Post') {
  const clock = new FakeClock()
  const tickets = new TicketAuthority(clock)
  const page = new WizardPage()
  page.currentUrl = url
  page.items[4] = { ref: 'e5', role: 'button', name: submitName }
  const session = new ControlledSession('acc', async () => page, tickets)
  const authority = new TestAuthority(tickets, approved)
  const time = { now: 10_000 }
  const reports: { status: string; reason: string }[] = []
  const toolbox = new BrowserToolbox({
    withPage: (work) => session.withAgentControl('post', work),
    hosts: ['fake.test'],
    values: {},
    sleep: async (ms) => {
      time.now += ms
    },
    say: () => undefined,
    ask: async () => 'done',
    note: () => undefined,
    report: (result) => reports.push(result),
    askWaitMs: 20,
    post: { authority, minGapMs: 2000, now: () => time.now }
  })
  return { page, authority, toolbox, reports, approved }
}
type Setup = ReturnType<typeof setup>
const look = (t: Setup) => t.toolbox.call('browser_snapshot', {})
const attach = (t: Setup, ref = 'e1') => t.toolbox.call('browser_attach', { ref })
const share = (t: Setup, extra: Record<string, unknown> = {}) => t.toolbox.call('browser_submit', { text_ref: 'e4', submit_ref: 'e5', ...extra })
const pathsOf = (t: Setup): string[] => (t.approved.attachments as ApprovedFile[]).map((f) => f.path)

describe('the tool that puts the approved pictures into a form', () => {
  it('exists only for a post with approved pictures, takes a label and nothing else, and names the pictures', () => {
    const withPictures = setup()
    const tool = withPictures.toolbox.tools.find((t) => t.name === 'browser_attach')
    expect(tool).toBeDefined()
    expect(Object.keys(tool?.inputSchema.properties as object)).toEqual(['ref'])
    expect(JSON.stringify(tool?.inputSchema)).not.toMatch(/path|url/i)
    expect(tool?.description).toContain('first.png, second.png')
    expect(withPictures.toolbox.instructions).toContain('browser_attach')

    const without = setup(content({ attachments: [] }))
    expect(without.toolbox.tools.map((t) => t.name)).not.toContain('browser_attach')
    expect(without.toolbox.instructions).not.toContain('browser_attach')
    const none = setup(content({ attachments: undefined }))
    expect(none.toolbox.tools.map((t) => t.name)).not.toContain('browser_attach')
  })

  it('puts every approved file, by the paths the application holds, into the file input the AI was shown, in one step', async () => {
    const t = setup()
    await look(t)
    const result = await attach(t)
    expect(result.isError).toBeUndefined()
    expect(t.page.uploaded).toEqual([{ ref: 'e1', paths: pathsOf(t) }])
    expect(t.authority.leases).toBe(0) // nothing is published, and no ticket was needed
  })

  it('takes no name and no path from the AI: any argument beyond the label is ignored', async () => {
    const t = setup()
    await look(t)
    const result = await t.toolbox.call('browser_attach', { ref: 'e1', file: '../../etc/passwd', path: '/etc/passwd', files: ['/etc/hosts'] })
    expect(result.isError).toBeUndefined()
    expect(t.page.uploaded).toEqual([{ ref: 'e1', paths: pathsOf(t) }])
  })

  it('goes only into a file input: not a button that opens a chooser, not a text box, not a disabled input', async () => {
    const t = setup()
    await look(t)
    for (const ref of ['e2', 'e4', 'e3', 'e8']) expect(await attach(t, ref)).toMatchObject({ isError: true, text: expect.stringContaining('not a file input') })
    expect(t.page.uploaded).toEqual([])
  })

  it('needs the element to have been shown, to be the same one now, and to be on the page', async () => {
    const t = setup()
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('not shown') }) // never looked
    await look(t)
    t.page.items[0] = { ref: 'e1', role: 'input:file', name: 'Something else now' }
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('not what it was') })
    t.page.items.shift()
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('not on the page') })
    expect(t.page.uploaded).toEqual([])
  })

  it('works only on the approved page of the platform, and for a community only on its compose page', async () => {
    const other = setup(content(), 'https://fake.test/r/another/submit')
    await look(other)
    expect(await attach(other)).toMatchObject({ isError: true, text: expect.stringContaining('not where the approved post goes') })
    const away = setup(content(), 'https://evil.example/r/test/submit')
    await look(away)
    expect(await attach(away)).toMatchObject({ isError: true })
    // the community's own page has a file input too (a banner, an icon): not the place of a new post
    const community = setup(content(), 'https://fake.test/r/test/')
    await look(community)
    expect(await attach(community)).toMatchObject({ isError: true, text: expect.stringContaining('submit page') })
    for (const t of [other, away, community]) expect(t.page.uploaded).toEqual([])
  })

  it('works only while no form holds text', async () => {
    const t = setup()
    t.page.fields.set('e4', 'text that nobody approved')
    await look(t)
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('holds text') })
    expect(t.page.uploaded).toEqual([])
  })

  it('refuses when any file is not the one that was approved any more, or is gone, and puts nothing in', async () => {
    const t = setup()
    await look(t)
    const [first, second] = t.approved.attachments as ApprovedFile[]
    writeFileSync(second.path, 'replaced on disk')
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('is not the picture that was approved') })
    rmSync(first.path)
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('cannot be read any more') })
    expect(t.page.uploaded).toEqual([])
  })

  it('goes in once for a document: a second call is refused, and a second input cannot replace what the first took', async () => {
    const t = setup()
    await look(t)
    expect((await attach(t)).isError).toBeUndefined()
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('in the form already') })
    expect(t.page.uploaded).toHaveLength(1)
    expect(t.page.held).toEqual(pathsOf(t))
  })

  it('does nothing after the mission was over', async () => {
    const t = setup()
    await look(t)
    t.authority.seal()
    expect(await attach(t)).toMatchObject({ isError: true })
    expect(t.page.uploaded).toEqual([])
  })

  it('does not count the pictures as in the form when the page did not take them', async () => {
    const t = setup()
    await look(t)
    const original = t.page.pageStep.bind(t.page)
    t.page.pageStep = async (step: PageStep): Promise<PageStepResult> => (step.do === 'upload' ? { status: 'refused', detail: 'the input rejected the files' } : original(step))
    expect(await attach(t)).toMatchObject({ isError: true })
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('not in the form') })
    t.page.pageStep = original
    expect((await attach(t)).isError).toBeUndefined()
  })

  it('does not count them either when the input holds other files than the approved ones afterwards', async () => {
    const t = setup()
    await look(t)
    const original = t.page.pageStep.bind(t.page)
    // an input that kept only the last file of the step
    t.page.pageStep = async (step: PageStep): Promise<PageStepResult> => {
      const result = await original(step)
      if (step.do === 'upload') t.page.held = t.page.held.slice(-1)
      return result
    }
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('holds 1 file now, not the 2 approved') })
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('not in the form') })
  })

  it('does not count them either when the input holds as many files, but not the approved ones (other bytes)', async () => {
    const t = setup()
    await look(t)
    const original = t.page.pageStep.bind(t.page)
    t.page.pageStep = async (step: PageStep): Promise<PageStepResult> => {
      const result = await original(step)
      if (step.do === 'upload') {
        // the site replaced them with two other files of the same number
        const [a, b] = ['other-one.png', 'other-two.png'].map((name) => join((dir ??= mkdtempSync(join(tmpdir(), 'ppd-attach-'))), name))
        writeFileSync(a, 'x'.repeat(500))
        writeFileSync(b, 'y'.repeat(900))
        t.page.held = [a, b]
      }
      return result
    }
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('holds 2 files now, not the 2 approved') })
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('not in the form') })
  })

  it('takes an input that the site emptied at once (a wizard has read the files) at its word', async () => {
    const t = setup()
    t.page.clearsInput = true
    await look(t)
    expect((await attach(t)).isError).toBeUndefined()
    expect(t.page.held).toEqual([])
    await look(t)
    expect((await share(t)).isError).toBeUndefined()
  })

  it('works for one approved picture as it does for many', async () => {
    const t = setup(content({ attachments: [approvedFile('only.png')] }))
    await look(t)
    expect((await attach(t)).isError).toBeUndefined()
    expect(t.page.uploaded).toEqual([{ ref: 'e1', paths: pathsOf(t) }])
  })

  it('refuses when the pictures went into another form of the page than the fields and the control', async () => {
    const t = setup()
    t.page.forms = { e1: 1, e4: 2, e5: 2 }
    await look(t)
    expect((await attach(t)).isError).toBeUndefined()
    await look(t)
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('another form') })
    expect(t.page.shared).toEqual([])
    // a page that marks no form for the fields takes the picture at its word (a dialog is not a form)
    const dialog = setup()
    dialog.page.forms = { e1: 1 }
    await look(dialog)
    await attach(dialog)
    await look(dialog)
    expect((await share(dialog)).isError).toBeUndefined()
  })
})

describe('while the pictures are in the form, the AI only goes on to a next step', () => {
  it('clicks Next and Continue, and nothing else of its own: not Done, not Create, not Skip, not a choice in a list', async () => {
    const t = setup()
    await look(t)
    await attach(t)
    expect((await t.toolbox.call('browser_click', { ref: 'e3' })).isError).toBeUndefined()
    expect((await t.toolbox.call('browser_click', { ref: 'e9' })).isError).toBeUndefined()
    for (const ref of ['e6', 'e7']) expect(await t.toolbox.call('browser_click', { ref })).toMatchObject({ isError: true, text: expect.stringContaining('only a control named Next or Continue') })
    expect(await t.toolbox.call('browser_select', { ref: 'e10', option: 'Everyone' })).toMatchObject({ isError: true, text: expect.stringContaining('nothing is chosen in a list') })
    expect(t.page.clicked).toEqual(['e3', 'e9'])
  })

  it('never clicks what opens the system\'s file chooser, with or without the pictures in the form: they go in by browser_attach', async () => {
    const t = setup()
    await look(t)
    for (const ref of ['e1', 'e2']) expect(await t.toolbox.call('browser_click', { ref })).toMatchObject({ isError: true, text: expect.stringContaining('file chooser') })
    await attach(t)
    for (const ref of ['e1', 'e2']) expect(await t.toolbox.call('browser_click', { ref })).toMatchObject({ isError: true })
    expect(t.page.clicked).toEqual([])
  })

  it('may click what it likes before the pictures are in, as before (the form is empty)', async () => {
    const t = setup()
    await look(t)
    expect((await t.toolbox.call('browser_click', { ref: 'e7' })).isError).toBeUndefined()
    expect(t.page.clicked).toEqual(['e7'])
  })

  it('never clicks the control that publishes, with or without pictures, and with or without text in the form', async () => {
    const t = setup()
    await look(t)
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('publishes') })
    await attach(t)
    expect(await t.toolbox.call('browser_click', { ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('publishes') })
    expect(t.page.shared).toEqual([])
  })

  it('is read from the page, not from a history of calls: a change of the fragment keeps the document, so the pictures are still in the form and the clicks stay narrow', async () => {
    const t = setup()
    await look(t)
    await attach(t)
    expect((await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/submit#again' })).isError).toBeUndefined()
    await look(t)
    expect(await t.toolbox.call('browser_click', { ref: 'e7' })).toMatchObject({ isError: true, text: expect.stringContaining('only a control named Next or Continue') })
    expect(await attach(t)).toMatchObject({ isError: true, text: expect.stringContaining('in the form already') })
    expect((await share(t)).isError).toBeUndefined()
    expect(t.page.shared).toEqual([{ caption: 'A caption for the picture.', pictures: 2 }])
  })

  it('starts over when a new document is loaded (a link, a reload): its form is empty, the clicks are free again, and the pictures must go in again', async () => {
    const t = setup()
    await look(t)
    await attach(t)
    t.page.loadAnotherDocument() // a "Next" link that loads a page of its own, the AI's call to browser_navigate, a form that posted
    await look(t)
    expect((await t.toolbox.call('browser_click', { ref: 'e7' })).isError).toBeUndefined()
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('not in the form of this page yet') })
    expect((await attach(t)).isError).toBeUndefined()
    await look(t)
    expect((await share(t)).isError).toBeUndefined()
    expect(t.page.shared).toHaveLength(1)
  })

  it('starts over after browser_navigate to the same address too (a reload)', async () => {
    const t = setup()
    await look(t)
    await attach(t)
    expect((await t.toolbox.call('browser_navigate', { url: 'https://fake.test/r/test/submit' })).isError).toBeUndefined()
    await look(t)
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('not in the form of this page yet') })
  })
})

describe('browser_submit with pictures', () => {
  it('is refused until the approved pictures are in the form', async () => {
    const t = setup()
    await look(t)
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('not in the form of this page yet') })
    expect(t.authority.leases).toBe(0)
    expect(t.page.shared).toEqual([])
  })

  it('types the approved caption and presses Share, under a ticket, once the pictures are in', async () => {
    const t = setup()
    await look(t)
    await attach(t)
    await look(t)
    const result = await share(t)
    expect(result.isError).toBeUndefined()
    expect(t.page.shared).toEqual([{ caption: 'A caption for the picture.', pictures: 2 }])
    expect(t.authority.committed).toBe(true)
    expect(t.authority.leases).toBe(1)
  })

  it('reads the files from disk once more before the press: a file replaced after the pictures went in is not published with the post', async () => {
    const t = setup()
    await look(t)
    await attach(t)
    await look(t)
    writeFileSync((t.approved.attachments as ApprovedFile[])[1].path, 'replaced between the attach and the press')
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('is not the picture that was approved') })
    expect(t.page.shared).toEqual([])
    expect(t.authority.leases).toBe(0)
  })

  it('publishes a post that is only pictures: nothing is typed, the control is pressed under a ticket', async () => {
    const t = setup(content({ text: '', attachments: [approvedFile('only.png')] }))
    await look(t)
    await attach(t)
    await look(t)
    const result = await t.toolbox.call('browser_submit', { submit_ref: 'e5' })
    expect(result.isError).toBeUndefined()
    expect(t.page.shared).toEqual([{ caption: '', pictures: 1 }])
    expect(t.page.steps.some((s) => s.step.do === 'type')).toBe(false)
    expect(t.authority.leases).toBe(1)
  })

  it('still says there is nothing to publish for a post with neither words nor pictures', async () => {
    const t = setup(content({ text: '', attachments: [] }))
    await look(t)
    expect(await t.toolbox.call('browser_submit', { submit_ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('nothing to publish') })
  })

  it('does not take a file input for the field of the text', async () => {
    const t = setup()
    await look(t)
    await attach(t)
    await look(t)
    expect(await t.toolbox.call('browser_submit', { text_ref: 'e1', submit_ref: 'e5' })).toMatchObject({ isError: true })
    expect(t.page.shared).toEqual([])
  })
})

describe('a platform whose new post is a dialog over its own pages', () => {
  const INSTAGRAM = 'https://www.instagram.com/brand/'
  function on(destination: string, url: string, hosts = ['instagram.com']) {
    const clock = new FakeClock()
    const tickets = new TicketAuthority(clock)
    const page = new WizardPage()
    page.currentUrl = url
    const session = new ControlledSession('acc', async () => page, tickets)
    const authority = new TestAuthority(tickets, content({ destination, attachments: [approvedFile('photo.png')] }))
    const toolbox = new BrowserToolbox({
      withPage: (work) => session.withAgentControl('post', work),
      hosts,
      values: {},
      sleep: async () => undefined,
      say: () => undefined,
      ask: async () => 'done',
      note: () => undefined,
      report: () => undefined,
      askWaitMs: 20,
      post: { authority, minGapMs: 0 }
    })
    return { page, toolbox, authority }
  }

  it('is worked on from the front page of the site, with the pictures put in and Share pressed by browser_submit', async () => {
    const { page, toolbox } = on(INSTAGRAM, 'https://www.instagram.com/')
    await toolbox.call('browser_snapshot', {})
    expect((await toolbox.call('browser_attach', { ref: 'e1' })).isError).toBeUndefined()
    expect((await toolbox.call('browser_click', { ref: 'e3' })).isError).toBeUndefined() // Next
    await toolbox.call('browser_snapshot', {})
    expect((await toolbox.call('browser_submit', { text_ref: 'e4', submit_ref: 'e5' })).isError).toBeUndefined()
    expect(page.shared).toEqual([{ caption: 'A caption for the picture.', pictures: 1 }])
  })

  it('does not follow the AI to other pages of the site, and does not put a picture into an input of one', async () => {
    const { page, toolbox } = on(INSTAGRAM, 'https://www.instagram.com/accounts/edit/')
    await toolbox.call('browser_snapshot', {})
    expect(await toolbox.call('browser_navigate', { url: 'https://www.instagram.com/accounts/logout/' })).toMatchObject({ isError: true })
    expect(await toolbox.call('browser_attach', { ref: 'e1' })).toMatchObject({ isError: true })
    expect(page.uploaded).toEqual([])
  })

  it('has the same fence when the channel address is the root of the site: the front page and nothing under it', async () => {
    const root = on('https://www.instagram.com/', 'https://www.instagram.com/direct/inbox/')
    await root.toolbox.call('browser_snapshot', {})
    expect(await root.toolbox.call('browser_attach', { ref: 'e1' })).toMatchObject({ isError: true })
    expect(await root.toolbox.call('browser_navigate', { url: 'https://www.instagram.com/accounts/edit/' })).toMatchObject({ isError: true })
    expect((await root.toolbox.call('browser_navigate', { url: 'https://www.instagram.com/' })).isError).toBeUndefined()
    expect(root.page.uploaded).toEqual([])
  })
})

describe('"Share" publishes a post of a platform with a composer dialog, and shares the page anywhere else', () => {
  it('is not taken for the control that publishes a reply', async () => {
    const reply: ApprovedContent = { kind: 'reply', title: null, text: 'Glad it helps.', link: null, destination: 'https://fake.test/r/test/comments/abc/slug/def' }
    const t = setup(reply, 'https://fake.test/r/test/comments/abc/slug/', 'Share')
    await look(t)
    expect(await t.toolbox.call('browser_submit', { text_ref: 'e4', submit_ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('shares the page') })
    expect(t.page.shared).toEqual([])
    expect(t.authority.committed).toBe(false)
  })

  it('is not taken for the control that publishes a reply on a platform that has a composer dialog either', async () => {
    const thread = 'https://www.instagram.com/p/abc123/'
    const clock = new FakeClock()
    const tickets = new TicketAuthority(clock)
    const page = new WizardPage()
    page.currentUrl = thread
    page.items[4] = { ref: 'e5', role: 'button', name: 'Share' }
    const session = new ControlledSession('acc', async () => page, tickets)
    const authority = new TestAuthority(tickets, { kind: 'reply', title: null, text: 'Glad it helps.', link: null, destination: thread })
    const toolbox = new BrowserToolbox({
      withPage: (work) => session.withAgentControl('post', work),
      hosts: ['instagram.com'],
      values: {},
      sleep: async () => undefined,
      say: () => undefined,
      ask: async () => 'done',
      note: () => undefined,
      report: () => undefined,
      askWaitMs: 20,
      post: { authority, minGapMs: 0 }
    })
    await toolbox.call('browser_snapshot', {})
    expect(await toolbox.call('browser_submit', { text_ref: 'e4', submit_ref: 'e5' })).toMatchObject({ isError: true, text: expect.stringContaining('shares the page') })
    expect(page.shared).toEqual([])
  })

  it('is not taken for the control that publishes a post on a platform without a composer dialog', async () => {
    const t = setup(content({ attachments: [] }), 'https://fake.test/r/test/submit', 'Share')
    await look(t)
    expect(await share(t)).toMatchObject({ isError: true, text: expect.stringContaining('shares the page') })
    expect(t.page.shared).toEqual([])
  })
})
