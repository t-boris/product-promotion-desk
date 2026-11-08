// The browser agent (DEC-017): an AI engine drives a website the way a person would, one round at a time.
//
//   observe (snapshot of the page) -> ask the engine for the next steps -> check them -> carry them out -> observe again ...
//
// The engine only returns text; every step it names is checked against the snapshot it was shown, and carried out by the page's own
// `pageStep` (real mouse and keystrokes, limited to the hosts of the task). Secrets (a password) are named, never shown: the engine
// writes {{PASSWORD}} and the real value is typed here. The loop stops for what only a person can do (a CAPTCHA, a code), for a page that
// does not react, and after a fixed number of rounds. Sign-up is the first task; reading channels and filling in profiles are the next.

import { AiError, TakeoverError, type AiEngine, type BrowserPage, type PageStep } from '../ports'
import { UnusableAnswerError } from '../passports/ai-json'
import { planRound, type Placeholder, type PlannedStep } from './plan'
import { parseSnapshot, snapshotScript, snapshotSignature, type PageSnapshot } from './snapshot'

const DEFAULT_MAX_ROUNDS = 14
const OBSERVE_TRIES = 3
const SETTLE_FIRST_MS = 2000
const SETTLE_MS = 1200
const RETRY_MS = 2000
/** The same page after two answers in a row: the site is not reacting to what is being done. */
const MAX_STALLS = 2

export interface TaskValue {
  value: string
  /** What it is, for the engine. */
  describe: string
  /** A password: never shown to the engine, never logged. */
  secret: boolean
}

export interface BrowserTask {
  goal: string
  facts: string[]
  /** Open this address first; null continues on the page that is open. */
  startUrl: string | null
  /** The task works only on pages of these hosts (and their sub-domains). */
  hosts: string[]
  /** Values the engine may type by name, `{{EMAIL}}`. */
  values: Record<string, TaskValue>
  maxRounds?: number
}

export interface AgentDeps {
  page: BrowserPage
  engine: AiEngine
  sleep: (ms: number) => Promise<void>
  /** "2026-11-08": the engine needs the date to choose a believable age. */
  today: string
  signal?: AbortSignal
  /** One short line of progress for the owner. Never a secret. */
  say: (line: string) => void
}

export interface AgentResult {
  outcome: 'done' | 'needs_owner' | 'failed'
  /** In plain words, for the owner. */
  reason: string
  /** Host and path of the page the agent ended on. */
  address: string | null
  /** Plain values the engine typed itself (never a placeholder, never a secret): the owner may need them later. */
  typed: { label: string; value: string }[]
}

function hostAllowed(url: string, hosts: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return hosts.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

function addressOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname}`
  } catch {
    return null
  }
}

/** The page as it is now; a page that is loading or blocking reads empty, so it is looked at a few times. */
async function observe(page: BrowserPage, sleep: AgentDeps['sleep']): Promise<PageSnapshot | null> {
  for (let attempt = 0; attempt < OBSERVE_TRIES; attempt++) {
    try {
      const snapshot = parseSnapshot(await page.read<unknown>(snapshotScript()))
      if (snapshot && snapshot.elements.length > 0) return snapshot
    } catch (error) {
      if (error instanceof TakeoverError) throw error
      // The page was navigating while it was read: look again.
    }
    await sleep(RETRY_MS)
  }
  return null
}

export async function runBrowserAgent(deps: AgentDeps, task: BrowserTask): Promise<AgentResult> {
  const { page, engine, sleep, say } = deps
  const maxRounds = task.maxRounds ?? DEFAULT_MAX_ROUNDS
  const placeholders: Placeholder[] = Object.entries(task.values).map(([name, v]) => ({ name, describe: v.describe, secret: v.secret }))
  const history: string[] = []
  const typed = new Map<string, string>()
  const result = (outcome: AgentResult['outcome'], reason: string, snapshot: PageSnapshot | null): AgentResult => ({
    outcome,
    reason,
    address: snapshot ? addressOf(snapshot.url) : null,
    typed: [...typed].map(([label, value]) => ({ label, value }))
  })

  const stopIfAsked = (): void => {
    if (deps.signal?.aborted) throw new AiError('cancelled', 'The task was stopped.')
  }

  if (task.startUrl) await page.goto(task.startUrl)

  let previous = ''
  let opened = ''
  let stalls = 0
  let last: PageSnapshot | null = null
  for (let round = 1; round <= maxRounds; round++) {
    stopIfAsked()
    await sleep(round === 1 ? SETTLE_FIRST_MS : SETTLE_MS)

    const snapshot = await observe(page, sleep)
    if (!snapshot) return result('needs_owner', 'The page shows nothing the AI can use (it may still be loading, or the site is blocking it). Open the browser and look.', last)
    last = snapshot
    if (!hostAllowed(snapshot.url, task.hosts)) return result('needs_owner', `The page left the platform (${addressOf(snapshot.url) ?? 'unknown address'}). Open the browser and look.`, snapshot)
    if (snapshot.humanCheck) return result('needs_owner', `The site asks for a human check (${snapshot.humanCheck}). Only you can do that: open the browser.`, snapshot)

    const signature = snapshotSignature(snapshot)
    if (round > 1 && signature === previous) {
      stalls += 1
      history.push('The page did not change after my last answer.')
      if (stalls >= MAX_STALLS) return result('needs_owner', 'The page did not react to my last two tries. Open the browser and look at what the site shows.', snapshot)
    } else {
      stalls = 0
    }
    previous = signature

    let plan
    try {
      plan = await planRound(engine, { goal: task.goal, facts: task.facts, placeholders, snapshot, history, round, maxRounds, today: deps.today }, placeholders, { signal: deps.signal })
    } catch (error) {
      if (error instanceof AiError && error.kind === 'cancelled') throw error
      if (error instanceof UnusableAnswerError) return result('failed', 'The AI\'s answer could not be used, twice in a row. Try again, or open the browser and do it yourself.', snapshot)
      return result('failed', `The AI engine failed: ${error instanceof Error ? error.message : String(error)}`, snapshot)
    }
    stopIfAsked()
    if (plan.reason) say(plan.reason)
    if (plan.status === 'done') return result('done', plan.reason || 'The AI considers the task done.', snapshot)
    if (plan.status === 'needs_owner') return result('needs_owner', plan.reason || 'The AI needs you to continue.', snapshot)

    const labelOf = (ref: string): string => snapshot.elements.find((e) => e.ref === ref)?.name || ref
    const roleOf = (ref: string): string => snapshot.elements.find((e) => e.ref === ref)?.role ?? ''
    for (const planned of plan.steps) {
      stopIfAsked() // the owner may have pressed Stop while the engine was thinking or a step was under way
      const step = toStep(planned, task.values)
      const verb = describe(planned, labelOf, task.values)
      const outcome = await page.pageStep(step, task.hosts)
      if (outcome.status === 'wrong_host') return result('needs_owner', 'The page left the platform. Open the browser and look.', snapshot)
      history.push(`${verb}: ${outcome.detail}`)
      say(`${verb}${outcome.status === 'done' ? '' : ` (${outcome.detail})`}`)
      if (outcome.status !== 'done') break
      if ((planned.do === 'type' || planned.do === 'select') && !isPlaceholder(planned.value)) typed.set(labelOf(planned.ref), planned.value)
      if (planned.do === 'click') {
        // A drop-down opened by a click and an option clicked next: what was chosen belongs to the drop-down that was opened.
        if (roleOf(planned.ref) === 'combobox') opened = labelOf(planned.ref)
        else if (roleOf(planned.ref) === 'option' && opened) typed.set(opened, labelOf(planned.ref))
        break // the page may change: look at it again before the next step
      }
    }
  }
  return result('needs_owner', `I used all ${maxRounds} rounds without finishing. Open the browser and look.`, last)
}

const PLACEHOLDER_WHOLE = /^\{\{\s*([A-Z_]{1,20})\s*\}\}$/
const isPlaceholder = (value: string): boolean => PLACEHOLDER_WHOLE.test(value)

/** The step the page carries out: a placeholder becomes its real value here, and nowhere earlier or later. */
function toStep(planned: PlannedStep, values: BrowserTask['values']): PageStep {
  if (planned.do === 'type') {
    const name = PLACEHOLDER_WHOLE.exec(planned.value)?.[1]
    return { do: 'type', ref: planned.ref, text: name !== undefined ? (values[name]?.value ?? '') : planned.value }
  }
  if (planned.do === 'select') return { do: 'select', ref: planned.ref, text: planned.value }
  if (planned.do === 'click') return { do: 'click', ref: planned.ref }
  return { do: 'key', key: planned.key }
}

/** A line for the owner: what is being done. A secret is named, a plain value is shown. */
function describe(planned: PlannedStep, labelOf: (ref: string) => string, values: BrowserTask['values']): string {
  if (planned.do === 'key') return `Pressed ${planned.key}`
  const label = labelOf(planned.ref)
  if (planned.do === 'click') return `Clicked "${label}"`
  const name = PLACEHOLDER_WHOLE.exec(planned.value)?.[1]
  if (name !== undefined) return `Typed ${values[name]?.secret ? 'the password' : name === 'EMAIL' ? 'the e-mail address' : `{{${name}}}`} into "${label}"`
  return `${planned.do === 'select' ? 'Chose' : 'Typed'} "${planned.value}" ${planned.do === 'select' ? 'in' : 'into'} "${label}"`
}
