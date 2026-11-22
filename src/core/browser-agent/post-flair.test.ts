// The flair of a post: the owner approves a name from the community's own list, the application chooses exactly that one on the form (the AI only names the
// control that opens the picker), reads it back, and presses nothing while the form lacks it or asks for something the post does not answer.

import { afterEach, describe, expect, it } from 'vitest'
import { ControlledSession } from '../browser-session'
import type { PageStep, PageStepResult } from '../ports'
import { FakeClock, FakePage } from '../testing/fakes'
import { TicketAuthority } from '../tickets'
import { TestAuthority } from './post-test-helpers'
import type { ApprovedContent } from './post-submit'
import { BrowserToolbox } from './toolbox'

interface Item {
  ref: string
  role: string
  name: string
  checked?: boolean
  disabled?: boolean
  value?: string
  required?: boolean
  submits?: boolean
}

const FLAIRS = ['Question - Career', 'Question - Transits', 'Question - Synastry', 'Discussion']

/** A compose page like Reddit's: a title, a body, "Add flair and tags *" that opens a picker with the first flairs, "View all flairs", Cancel and Add. */
class ComposePage extends FakePage {
  fields = new Map<string, string>()
  /** The flair applied to the form (what the pill shows), or null. */
  applied: string | null = null
  /** The flair chosen in the open picker, not applied yet. */
  chosen: string | null = null
  pickerOpen = false
  showAll = false
  /** A community whose picker never offers the approved flair. */
  offers = FLAIRS
  /** Whether the picker applies the choice by itself (no Add). */
  plain = false
  /** A page that has another control marked required. */
  extraRequired = false
  readonly clicked: string[] = []
  readonly published: { title: string; body: string; flair: string | null }[] = []
  /** What a real mouse click on the control does: nothing when the page ignores it. */
  ignoresClicks = false

  items(): Item[] {
    const list: Item[] = [
      { ref: 'e1', role: 'textarea', name: 'Title' },
      { ref: 'e2', role: 'textbox', name: 'Post body text field' }
    ]
    if (this.applied) list.push({ ref: 'e3', role: 'button', name: this.applied }, { ref: 'e4', role: 'button', name: 'edit flair' })
    else list.push({ ref: 'e3', role: 'button', name: 'Add flair and tags *' })
    if (this.extraRequired) list.push({ ref: 'e5', role: 'button', name: 'Add a poll option *' })
    if (this.pickerOpen) {
      const shown = this.showAll ? this.offers : this.offers.slice(0, 3)
      list.push({ ref: 'e20', role: 'radio', name: 'No flair', checked: this.chosen === null })
      shown.forEach((name, i) => list.push({ ref: `e${21 + i}`, role: 'radio', name, checked: this.chosen === name }))
      if (!this.showAll && this.offers.length > 3) list.push({ ref: 'e30', role: 'button', name: 'View all flairs' })
      list.push({ ref: 'e31', role: 'button', name: 'Cancel' })
      if (!this.plain) list.push({ ref: 'e32', role: 'button', name: 'Add' })
    }
    list.push({ ref: 'e40', role: 'button', name: 'Post', submits: true })
    return list
  }

  override async read<T>(script: string): Promise<T> {
    if (script.includes('ppd-document')) return '1' as T
    if (script.includes('ppd-form-text')) return [...this.fields].filter(([, text]) => text.trim() !== '').map(([ref, text]) => ({ ref, text })) as T
    if (script.includes('agent-snapshot')) return { url: this.currentUrl, title: 'Create post', text: 'Create a post', alerts: [], humanCheck: '', elements: this.items() } as T
    const field = /ppd-field (e\d+)/.exec(script)
    if (field) return (this.fields.get(field[1] as string) ?? null) as T
    return undefined as T
  }

  override async pageStep(step: PageStep): Promise<PageStepResult> {
    this.steps.push({ step, hosts: [] })
    if (!('ref' in step)) return { status: 'done', detail: 'ok' }
    const item = this.items().find((i) => i.ref === step.ref)
    if (!item) return { status: 'not_found', detail: 'no such element' }
    if (step.do === 'type') {
      this.fields.set(step.ref, step.text)
      return { status: 'done', detail: 'typed' }
    }
    if (step.do !== 'click') return { status: 'done', detail: 'ok' }
    this.clicked.push(`${item.ref} ${item.name}`)
    if (this.ignoresClicks) return { status: 'done', detail: 'ok' }
    if (item.name === 'Add flair and tags *') this.pickerOpen = true
    else if (item.name === 'View all flairs') this.showAll = true
    else if (item.role === 'radio') {
      this.chosen = item.name === 'No flair' ? null : item.name
      if (this.plain) this.apply()
    } else if (item.name === 'Add') this.apply()
    else if (item.name === 'Cancel') this.pickerOpen = false
    else if (item.name === 'Post') this.published.push({ title: this.fields.get('e1') ?? '', body: this.fields.get('e2') ?? '', flair: this.applied })
    return { status: 'done', detail: 'ok' }
  }

  private apply(): void {
    this.applied = this.chosen
    this.pickerOpen = false
  }
}

const REDDIT = 'https://fake.test/r/test'
const content = (over: Partial<ApprovedContent> = {}): ApprovedContent => ({ kind: 'post', title: 'A title', text: 'A body.', link: null, destination: REDDIT, attachments: [], flair: 'Question - Transits', ...over })

function setup(approved: ApprovedContent = content()) {
  const clock = new FakeClock()
  const tickets = new TicketAuthority(clock)
  const page = new ComposePage()
  page.currentUrl = 'https://fake.test/r/test/submit'
  const session = new ControlledSession('acc', async () => page, tickets)
  const authority = new TestAuthority(tickets, approved)
  const time = { now: 10_000 }
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
    report: () => undefined,
    askWaitMs: 20,
    post: { authority, minGapMs: 2000, now: () => time.now }
  })
  return { page, authority, toolbox, approved }
}
type Setup = ReturnType<typeof setup>
const look = (t: Setup) => t.toolbox.call('browser_snapshot', {})
const flair = (t: Setup, ref = 'e3') => t.toolbox.call('browser_flair', { ref })
const post = (t: Setup) => t.toolbox.call('browser_submit', { title_ref: 'e1', text_ref: 'e2', submit_ref: 'e40' })
const textOf = (r: { text: string }): string => r.text

afterEach(() => undefined)

describe('the tool that chooses the approved flair', () => {
  it('exists only for a post that has an approved flair, takes a label and nothing else, and says which flair', () => {
    const withFlair = setup()
    const tool = withFlair.toolbox.tools.find((t) => t.name === 'browser_flair')
    expect(tool).toBeDefined()
    expect(Object.keys(tool?.inputSchema.properties as object)).toEqual(['ref'])
    expect(tool?.description).toContain('Question - Transits')
    expect(withFlair.toolbox.instructions).toContain('browser_flair')
    for (const none of [setup(content({ flair: null })), setup(content({ flair: undefined }))]) {
      expect(none.toolbox.tools.map((t) => t.name)).not.toContain('browser_flair')
      expect(none.toolbox.instructions).not.toContain('browser_flair')
    }
  })

  it('opens the picker, shows more of a short list, chooses exactly the approved name, applies it and reads back that the form shows it', async () => {
    const t = setup(content({ flair: 'Discussion' }))
    await look(t)
    const result = await flair(t)
    expect(result.isError).toBeUndefined()
    expect(textOf(result)).toContain('the form shows it')
    expect(t.page.applied).toBe('Discussion')
    // The application pressed exactly: the opener, "View all flairs" (the flair was not among the first three), the option and Add. Nothing else.
    expect(t.page.clicked).toEqual(['e3 Add flair and tags *', 'e30 View all flairs', 'e24 Discussion', 'e32 Add'])
    expect(t.authority.leases).toBe(0)
    expect(t.page.published).toEqual([])
  })

  it('chooses a flair that is among the first ones without opening the longer list', async () => {
    const t = setup()
    await look(t)
    expect((await flair(t)).isError).toBeUndefined()
    expect(t.page.applied).toBe('Question - Transits')
    expect(t.page.clicked).toEqual(['e3 Add flair and tags *', 'e22 Question - Transits', 'e32 Add'])
  })

  it('takes a picker that applies the choice by itself, with no control to confirm it', async () => {
    const t = setup()
    t.page.plain = true
    await look(t)
    expect((await flair(t)).isError).toBeUndefined()
    expect(t.page.applied).toBe('Question - Transits')
    expect(t.page.clicked).not.toContain('e32 Add')
  })

  it('matches the name whatever its case and spacing, and never a flair that only contains it', async () => {
    const t = setup(content({ flair: '  question - transits ' }))
    await look(t)
    expect((await flair(t)).isError).toBeUndefined()
    expect(t.page.applied).toBe('Question - Transits')
    const other = setup(content({ flair: 'Question' }))
    await look(other)
    const refused = await flair(other)
    expect(refused.isError).toBe(true)
    expect(other.page.applied).toBeNull()
  })

  it('says what the picker offers when it has not the approved flair, and applies nothing', async () => {
    const t = setup(content({ flair: 'Books and Resources' }))
    await look(t)
    const result = await flair(t)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('does not offer it')
    expect(textOf(result)).toContain('Question - Career')
    expect(t.page.applied).toBeNull()
    expect(t.page.clicked).not.toContain('e32 Add')
  })

  it('does nothing when the form shows the flair already', async () => {
    const t = setup()
    t.page.applied = 'Question - Transits'
    await look(t)
    const result = await flair(t, 'e4')
    expect(result.isError).toBeUndefined()
    expect(t.page.clicked).toEqual([])
  })

  it('refuses a control that does not open a picker of flairs, and a label it was not shown', async () => {
    const t = setup()
    await look(t)
    const post = await flair(t, 'e40')
    expect(post.isError).toBe(true)
    expect(textOf(post)).toContain('not the control that opens the flair picker')
    const gone = await flair(t, 'e99')
    expect(gone.isError).toBe(true)
    expect(t.page.clicked).toEqual([])
  })

  it('refuses while a field holds text: the flair is chosen with an empty form', async () => {
    const t = setup()
    t.page.fields.set('e1', 'typed by someone')
    await look(t)
    const result = await flair(t)
    expect(result.isError).toBe(true)
    expect(t.page.clicked).toEqual([])
  })

  it('does not say it worked when the page ignored the clicks: the form is read back, and it does not show the flair', async () => {
    const t = setup()
    t.page.ignoresClicks = true
    await look(t)
    const result = await flair(t)
    expect(result.isError).toBe(true)
    expect(t.page.applied).toBeNull()
  })

  it('has no tool and no effect for a post with no approved flair: a call is refused', async () => {
    const t = setup(content({ flair: null }))
    await look(t)
    const result = await flair(t)
    expect(result.isError).toBe(true)
    expect(t.page.clicked).toEqual([])
  })
})

describe('what browser_submit holds to about the flair and about required controls', () => {
  it('does not press while the approved flair is not set in the form, and says how to set it', async () => {
    const t = setup()
    await look(t)
    const result = await post(t)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('the approved flair "Question - Transits" is not set')
    expect(textOf(result)).toContain('browser_flair')
    expect(t.page.published).toEqual([])
    expect(t.authority.leases).toBe(0)
  })

  it('presses once the flair is set, and the post goes out with it', async () => {
    const t = setup()
    await look(t)
    expect((await flair(t)).isError).toBeUndefined()
    await look(t)
    const result = await post(t)
    expect(result.isError).toBeUndefined()
    expect(t.page.published).toEqual([{ title: 'A title', body: 'A body.', flair: 'Question - Transits' }])
  })

  it('does not press while the form marks a control required that nothing approved answers, whatever the post, and remembers which', async () => {
    const t = setup(content({ flair: null }))
    await look(t)
    const result = await post(t)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('"Add flair and tags *" as required')
    expect(t.page.published).toEqual([])
    expect(t.authority.leases).toBe(0)
    expect(t.toolbox.observed.required).toBe('Add flair and tags *')
  })

  it('does not press for another required control either, even when the flair is set', async () => {
    const t = setup()
    t.page.extraRequired = true
    await look(t)
    expect((await flair(t)).isError).toBeUndefined()
    await look(t)
    const result = await post(t)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('"Add a poll option *" as required')
    expect(t.page.published).toEqual([])
  })

  it('has nothing to say about a form that asks for nothing more', async () => {
    const t = setup(content({ flair: null }))
    t.page.applied = 'Discussion'
    await look(t)
    const result = await post(t)
    expect(result.isError).toBeUndefined()
    expect(t.page.published).toHaveLength(1)
  })
})
