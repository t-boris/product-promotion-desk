// A short record of what the AI did in a publishing mission, kept for the log when a publication does not go through. The run record of a mission
// keeps one line, and "the browser blocked the Reply control" says nothing of what the AI did before it. A step is written in a few words from what
// the application knows without reading the page for it: the tool the AI called, the address it opened, the label of the control it pressed, and the
// sentence the application gave back when it refused. Never a text that was typed, what a field holds, the words of a page or anything the owner
// approved to publish: a text box is named by its kind, and a sentence that carries the words of a page is cut before them.

/** At most this many steps are kept; when there are more, the first ones are left out (the end of a mission is what a failure is about). */
export const TRACE_MAX_STEPS = 25
/** One step, with its number and the sentence of a refusal, in at most this many characters. */
export const TRACE_STEP_MAX = 160
/** A label or an address in a step. */
const TRACE_LABEL_MAX = 60
const TRACE_ADDRESS_MAX = 100
/** The log keeps 2000 characters of an event: the record fits in less, and leaves out first steps to do so. */
export const TRACE_TOTAL_MAX = 1900

/**
 * The leads of the sentences the toolbox builds around words a page showed (a human check, a warning of the site): the sentence is cut after its
 * lead, so the words of the page never reach the log. The toolbox writes these sentences with these constants.
 */
export const HUMAN_CHECK_LEAD = 'A human check is on the page'
export const SITE_WARNING_LEAD = 'The site shows a warning'
const PAGE_WORDS_LEADS = [HUMAN_CHECK_LEAD, SITE_WARNING_LEAD]

/** What a call was about, as far as it is safe to say: where it went, or what it pressed or chose. */
export interface StepSubject {
  /** An address opened (host and path only). */
  address?: string
  /** The label of the control that was pressed, or of the list that was chosen from. */
  label?: string
  /** The thing was a field that takes text: its name is what it holds, so it is not said. */
  textBox?: boolean
  /** The option chosen in a list. */
  option?: string
  /** What a report_result said (done, needs_owner or failed). */
  status?: string
}

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()
const clip = (text: string, max: number): string => {
  const one = flat(text)
  return one.length > max ? `${one.slice(0, Math.max(0, max - 1)).trimEnd()}…` : one
}

/** A call of a tool in a few words. */
export function describeCall(tool: string, subject: StepSubject = {}): string {
  const target = subject.textBox ? 'a text box' : subject.label ? `"${clip(subject.label, TRACE_LABEL_MAX)}"` : ''
  switch (tool) {
    case 'browser_snapshot':
      return 'looked at the page'
    case 'browser_navigate':
      return subject.address ? `opened ${clip(subject.address, TRACE_ADDRESS_MAX)}` : 'opened an address'
    case 'browser_click':
      return target ? `clicked ${target}` : 'clicked'
    case 'browser_select':
      return subject.option ? `chose "${clip(subject.option, TRACE_LABEL_MAX)}"${target ? ` in ${target}` : ''}` : `chose in ${target || 'a list'}`
    case 'browser_attach':
      return 'put the pictures in'
    case 'browser_flair':
      return target ? `chose the approved flair through ${target}` : 'chose the approved flair'
    case 'browser_submit':
      return target ? `called browser_submit with ${target}` : 'called browser_submit'
    case 'browser_scroll':
      return 'scrolled'
    case 'browser_wait_for':
      return 'waited'
    case 'ask_owner':
      return 'asked the owner'
    case 'report_result':
      return subject.status === 'done' || subject.status === 'needs_owner' || subject.status === 'failed' ? `reported ${subject.status}` : 'reported'
    default:
      return `called ${clip(tool, TRACE_LABEL_MAX)}`
  }
}

/** The first sentence of what the application answered, cut before any words of a page. */
function refusalWords(text: string): string {
  let words = flat(text)
  for (const lead of PAGE_WORDS_LEADS) {
    const at = words.indexOf(lead)
    if (at >= 0) words = words.slice(0, at + lead.length)
  }
  const end = words.search(/[.!?](?:\s|$)/)
  return end >= 0 ? words.slice(0, end + 1) : words
}

interface Entry {
  /** The number of the call in the mission (its first one, when the same step came several times in a row). */
  n: number
  text: string
  repeats: number
}

/** The steps of one mission. Calls after the mission is over are not recorded by the toolbox, and the same step several times in a row is one entry. */
export class StepTrace {
  private entries: Entry[] = []
  private calls = 0

  /** A call and, when the application refused it, its sentence. */
  record(did: string, refusal?: string): void {
    this.calls += 1
    const n = this.calls
    const prefix = `${n}. ${did}`
    let text = did
    if (refusal !== undefined && refusal.trim() !== '') {
      const room = TRACE_STEP_MAX - prefix.length - ' (refused: )'.length - ' (×99)'.length
      text = `${did} (refused: ${clip(refusalWords(refusal), Math.max(room, 20))})`
    }
    const last = this.entries[this.entries.length - 1]
    if (last && last.text === text) {
      last.repeats += 1
      return
    }
    this.entries.push({ n, text, repeats: 1 })
    if (this.entries.length > TRACE_MAX_STEPS) this.entries.shift()
  }

  /** How many calls were recorded. */
  get count(): number {
    return this.calls
  }

  /** The record as one sentence for the log, or null when the AI did nothing. */
  summary(): string | null {
    if (this.entries.length === 0) return null
    const line = (entry: Entry): string => clip(`${entry.n}. ${entry.text}${entry.repeats > 1 ? ` (×${entry.repeats})` : ''}`, TRACE_STEP_MAX)
    let kept = this.entries
    const render = (): string => {
      const covered = kept.reduce((sum, entry) => sum + entry.repeats, 0)
      const lead = covered < this.calls ? `The AI's steps (the first ${this.calls - covered} are left out): ` : "The AI's steps: "
      return `${lead}${kept.map(line).join(' | ')}`
    }
    let text = render()
    while (text.length > TRACE_TOTAL_MAX && kept.length > 1) {
      kept = kept.slice(1)
      text = render()
    }
    return text.length > TRACE_TOTAL_MAX ? `${text.slice(0, TRACE_TOTAL_MAX - 1)}…` : text
  }
}
