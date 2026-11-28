// The topic of a post (Threads): the owner approves it with the post, the AI only names the field, and the application types exactly the approved
// topic into it, first, reads it back with the rest, and presses nothing when the form has no such field or does not hold the topic as approved.

import { describe, expect, it } from 'vitest'
import { ControlledSession } from '../browser-session'
import type { PageStep, PageStepResult } from '../ports'
import { FakeClock, FakePage } from '../testing/fakes'
import { TicketAuthority } from '../tickets'
import { postMissionPrompt } from './post-mission'
import type { ApprovedContent, PostAuthority, PostMissionRequest } from './post-submit'
import { TestAuthority } from './post-test-helpers'
import { BrowserToolbox } from './toolbox'

interface Item {
  ref: string
  role: string
  name: string
  disabled?: boolean
}

/** A composer like Threads': a topic field beside the account's name, the text box, a button named after the topic of a poll, and Post. */
class Composer extends FakePage {
  fields = new Map<string, string>()
  readonly typed: string[] = []
  readonly published: { topic: string; body: string }[] = []
  /** A site that changes what is typed into its topic field (it drops a part of it). */
  mangles = false
  /** A composer that has no topic field. */
  noTopic = false

  items(): Item[] {
    const list: Item[] = []
    if (!this.noTopic) list.push({ ref: 'e1', role: 'input:text', name: 'Add a topic' })
    list.push({ ref: 'e2', role: 'textbox', name: 'What’s new?' }, { ref: 'e3', role: 'input:text', name: 'Search' }, { ref: 'e9', role: 'button', name: 'Post' })
    return list
  }

  override async read<T>(script: string): Promise<T> {
    if (script.includes('ppd-document')) return '1' as T
    if (script.includes('ppd-form-text')) return [...this.fields].filter(([, text]) => text.trim() !== '').map(([ref, text]) => ({ ref, text })) as T
    if (script.includes('agent-snapshot')) return { url: this.currentUrl, title: 'Threads', text: 'New thread', alerts: [], humanCheck: '', elements: this.items() } as T
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
      this.typed.push(step.ref)
      this.fields.set(step.ref, this.mangles && step.ref === 'e1' ? step.text.slice(0, 4) : step.text)
      return { status: 'done', detail: 'typed' }
    }
    if (step.do === 'click' && item.name === 'Post') this.published.push({ topic: this.fields.get('e1') ?? '', body: this.fields.get('e2') ?? '' })
    return { status: 'done', detail: 'ok' }
  }
}

const PLACE = 'https://fake.test/@brand'
const content = (over: Partial<ApprovedContent> = {}): ApprovedContent => ({ kind: 'post', title: null, text: 'Mercury turns direct on Friday.', link: null, destination: PLACE, attachments: [], topicTag: 'Astrology', ...over })

function setup(approved: ApprovedContent = content()) {
  const clock = new FakeClock()
  const tickets = new TicketAuthority(clock)
  const page = new Composer()
  page.currentUrl = PLACE
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
  return { page, authority, toolbox }
}
type Setup = ReturnType<typeof setup>
const look = (t: Setup) => t.toolbox.call('browser_snapshot', {})
const submit = (t: Setup, refs: Record<string, string> = { topic_ref: 'e1', text_ref: 'e2', submit_ref: 'e9' }) => t.toolbox.call('browser_submit', refs)
const submitTool = (t: Setup) => t.toolbox.tools.find((tool) => tool.name === 'browser_submit')!

describe('the approved topic of a post, in the form', () => {
  it('is asked for by browser_submit only when the approved post has one', () => {
    const withTopic = setup()
    expect(JSON.stringify(submitTool(withTopic).inputSchema)).toContain('topic_ref')
    expect(withTopic.toolbox.instructions).toContain('The owner approved a topic for this post')
    const without = setup(content({ topicTag: null }))
    expect(JSON.stringify(submitTool(without).inputSchema)).not.toContain('topic_ref')
    expect(without.toolbox.instructions).not.toContain('approved a topic')
  })

  it('is typed by the application into the field the AI names, before the text, read back and published with the post', async () => {
    const t = setup()
    await look(t)
    const result = await submit(t)
    expect(result.isError).toBeUndefined()
    expect(t.page.typed).toEqual(['e1', 'e2'])
    expect(t.page.published).toEqual([{ topic: 'Astrology', body: 'Mercury turns direct on Friday.' }])
    expect(t.authority.committed).toBe(true)
    expect(t.toolbox.observed.topic).toBeNull()
  })

  it('is never left out: without the label of the topic field nothing is typed, and the AI is told to report when the form has none', async () => {
    const t = setup()
    t.page.noTopic = true
    await look(t)
    const result = await submit(t, { text_ref: 'e2', submit_ref: 'e9' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('The approved content has a topic: pass topic_ref')
    expect(result.text).toContain('needs_owner')
    expect(t.page.typed).toEqual([])
    expect(t.page.published).toEqual([])
    expect(t.authority.leases).toBe(0)
    // The application says it in its own words to the send flow, whatever the AI reports.
    expect(t.toolbox.observed.topic).toBe('the AI found no topic field in the form.')
  })

  it('goes only into the field the page calls a topic: another field named for it, or the topic field named for the text, is refused before anything is typed', async () => {
    const t = setup()
    await look(t)
    const wrong = await submit(t, { topic_ref: 'e3', text_ref: 'e2', submit_ref: 'e9' })
    expect(wrong.isError).toBe(true)
    expect(wrong.text).toContain('"Search" is not the topic field of the form')
    expect(t.toolbox.observed.topic).toBe('the field the AI named for it is not one the page calls a topic.')
    // The two labels swapped: the topic would be published as the text.
    const swapped = await submit(t, { topic_ref: 'e2', text_ref: 'e1', submit_ref: 'e9' })
    expect(swapped.isError).toBe(true)
    expect(swapped.text).toContain('is not the topic field of the form')
    expect(t.page.typed).toEqual([])
    expect(t.authority.leases).toBe(0)
  })

  it('names no topic field for a post that has no topic, and such a post is typed as before', async () => {
    const t = setup(content({ topicTag: null }))
    await look(t)
    const refused = await submit(t)
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('The approved content has no topic: leave topic_ref out.')
    const result = await submit(t, { text_ref: 'e2', submit_ref: 'e9' })
    expect(result.isError).toBeUndefined()
    expect(t.page.published).toEqual([{ topic: '', body: 'Mercury turns direct on Friday.' }])
  })

  it('presses nothing when the site changes what was typed into the topic field', async () => {
    const t = setup()
    t.page.mangles = true
    await look(t)
    const result = await submit(t)
    expect(result.isError).toBe(true)
    expect(result.text).toContain('the topic field does not hold exactly the approved text')
    expect(t.toolbox.observed.topic).toBe('the site changed what was typed into its topic field.')
    expect(t.page.published).toEqual([])
    expect(t.authority.committed).toBe(false)
  })
})

describe('the brief of a mission that publishes a post with a topic', () => {
  const brief = (over: Partial<ApprovedContent>): string => {
    const authority = { content: content(over) } as unknown as PostAuthority
    const request: PostMissionRequest = { accountId: 'a1', accountLabel: 'Brand', authority, hosts: ['threads.com'], platform: 'threads', facts: ['The owner\'s own approved post.'] }
    return postMissionPrompt(request, '2026-11-28')
  }

  it('says that the application types the topic into the field the AI names, and never shows a reason to type or choose one', () => {
    const text = brief({})
    expect(text).toContain('a text of 31 characters, a topic')
    expect(text).toContain('Pass the label of that field as topic_ref in browser_submit')
    expect(text).toContain('never choose one of the topics the site suggests')
    expect(text).not.toContain('Astrology')
  })

  it('says nothing about a topic for a post that has none', () => {
    expect(brief({ topicTag: null })).not.toContain('topic')
  })
})
