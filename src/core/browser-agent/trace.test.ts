// The steps a publishing mission keeps for the log (DEC-051): short, bounded, and made of labels, addresses and the application's own sentences only.

import { describe, expect, it } from 'vitest'
import { HUMAN_CHECK_LEAD, SITE_WARNING_LEAD, StepTrace, TRACE_MAX_STEPS, TRACE_STEP_MAX, TRACE_TOTAL_MAX, describeCall } from './trace'

describe('a call in a few words', () => {
  it.each([
    ['browser_snapshot', {}, 'looked at the page'],
    ['browser_navigate', { address: 'www.reddit.com/r/x/comments/abc/slug/' }, 'opened www.reddit.com/r/x/comments/abc/slug/'],
    ['browser_navigate', {}, 'opened an address'],
    ['browser_click', { label: 'Reply' }, 'clicked "Reply"'],
    ['browser_click', { textBox: true }, 'clicked a text box'],
    ['browser_click', {}, 'clicked'],
    ['browser_select', { label: 'Sort by', option: 'Best' }, 'chose "Best" in "Sort by"'],
    ['browser_select', { textBox: true, option: 'Best' }, 'chose "Best" in a text box'],
    ['browser_attach', {}, 'put the pictures in'],
    ['browser_submit', { label: 'Comment' }, 'called browser_submit with "Comment"'],
    ['browser_submit', {}, 'called browser_submit'],
    ['browser_scroll', {}, 'scrolled'],
    ['browser_wait_for', {}, 'waited'],
    ['ask_owner', {}, 'asked the owner'],
    ['report_result', { status: 'needs_owner' }, 'reported needs_owner'],
    ['report_result', { status: 'it went great, here is the text I typed' }, 'reported'],
    ['something_else', {}, 'called something_else']
  ])('%s %j: %s', (tool, subject, expected) => {
    expect(describeCall(tool, subject)).toBe(expected)
  })

  it('never says the name of a text box, whatever it holds, and bounds a label and an address', () => {
    expect(describeCall('browser_click', { textBox: true, label: 'The text the owner approved' })).toBe('clicked a text box')
    expect(describeCall('browser_click', { label: 'x'.repeat(200) }).length).toBeLessThanOrEqual('clicked ""'.length + 60)
    expect(describeCall('browser_navigate', { address: `reddit.com/${'a'.repeat(300)}` }).length).toBeLessThanOrEqual('opened '.length + 100)
  })
})

describe('the steps of one mission', () => {
  it('has nothing to say when the AI did nothing', () => {
    const trace = new StepTrace()
    expect(trace.summary()).toBeNull()
    expect(trace.count).toBe(0)
  })

  it('numbers the steps and says what the application answered when it refused one, as one sentence', () => {
    const trace = new StepTrace()
    trace.record('opened www.reddit.com/r/x/comments/abc/slug/')
    trace.record('looked at the page')
    trace.record('clicked "Reply"', 'A field on this page holds text, and nothing is clicked or chosen while a form holds text. Open the page again.')
    expect(trace.count).toBe(3)
    expect(trace.summary()).toBe(
      "The AI's steps: 1. opened www.reddit.com/r/x/comments/abc/slug/ | 2. looked at the page | " +
        '3. clicked "Reply" (refused: A field on this page holds text, and nothing is clicked or chosen while a form holds text.)'
    )
  })

  it('keeps the first sentence of a refusal only, and never more than a step may hold', () => {
    const trace = new StepTrace()
    trace.record('called browser_submit with "Reply"', `Nothing was submitted: ${'a very long sentence '.repeat(40)}`)
    const line = trace.summary() ?? ''
    expect(line.replace("The AI's steps: ", '').length).toBeLessThanOrEqual(TRACE_STEP_MAX)
    expect(line).toContain('(refused: Nothing was submitted:')
    expect(line).toContain('…')
  })

  it('cuts a sentence that carries the words of a page before them: a human check, a warning of the site', () => {
    const trace = new StepTrace()
    trace.record('clicked "Reply"', `${HUMAN_CHECK_LEAD} (Cloudflare says: prove you are Jane Doe). Only a person can do it.`)
    trace.record('clicked "Reply"', `Nothing was submitted: ${SITE_WARNING_LEAD}: "You are doing that too much, try again in 9 minutes". Publishing now is unwise.`)
    const line = trace.summary() ?? ''
    expect(line).toContain(`(refused: ${HUMAN_CHECK_LEAD})`)
    expect(line).toContain(`(refused: Nothing was submitted: ${SITE_WARNING_LEAD})`)
    expect(line).not.toMatch(/Cloudflare|Jane Doe|too much|9 minutes/)
  })

  it('writes the same step several times in a row once, with how many times', () => {
    const trace = new StepTrace()
    trace.record('looked at the page')
    for (let i = 0; i < 3; i++) trace.record('clicked "Reply"', 'The control is disabled.')
    trace.record('looked at the page')
    expect(trace.summary()).toBe(`The AI's steps: 1. looked at the page | 2. clicked "Reply" (refused: The control is disabled.) (×3) | 5. looked at the page`)
    expect(trace.count).toBe(5)
  })

  it(`keeps the last ${TRACE_MAX_STEPS} steps and says how many were left out`, () => {
    const trace = new StepTrace()
    for (let i = 1; i <= 40; i++) trace.record(`opened page ${i}`)
    const line = trace.summary() ?? ''
    expect(line.startsWith("The AI's steps (the first 15 are left out): 16. opened page 16 | ")).toBe(true)
    expect(line.endsWith('40. opened page 40')).toBe(true)
    expect(line.split(' | ')).toHaveLength(TRACE_MAX_STEPS)
    expect(trace.count).toBe(40)
  })

  it('fits the 2000 characters the log keeps, leaving out first steps when it must', () => {
    const trace = new StepTrace()
    for (let i = 1; i <= 25; i++) trace.record(`opened www.reddit.com/r/${'community'.repeat(10)}/${i}`, `Nothing was submitted: ${'x'.repeat(200)}`)
    const line = trace.summary() ?? ''
    expect(line.length).toBeLessThanOrEqual(TRACE_TOTAL_MAX)
    expect(line).toMatch(/^The AI's steps \(the first \d+ are left out\): /)
    expect(line).toContain('25. opened')
  })
})
