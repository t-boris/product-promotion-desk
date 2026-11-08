// Test doubles shared by all module tests. Not imported by production code.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account, EngineId, EngineStatus, PageReport } from '../../shared/types'
import { ControlledSession, type RawPage } from '../browser-session'
import { Core, type CoreDeps } from '../core'
import type { AgentBridge, McpLaunch, McpToolHost } from '../mcp/protocol'
import {
  AiError,
  type AiEngine,
  type AiRunOptions,
  type AiTask,
  type BrowserService,
  type BrowserSession,
  type Clock,
  type Connector,
  type SecretClipboard,
  type SecretStore,
  type PageStep,
  type PageStepResult,
  type SignInForm,
  type SignInStatus
} from '../ports'

/** A vault in memory, for tests. `encryptable = false` plays a system whose keychain cannot encrypt. */
export class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>()
  encryptable = true
  available(): boolean {
    return this.encryptable
  }
  has(key: string): boolean {
    return this.encryptable && this.values.has(key)
  }
  get(key: string): string | null {
    return this.encryptable ? (this.values.get(key) ?? null) : null
  }
  set(key: string, value: string): void {
    if (!this.encryptable) throw new Error('The password vault is not available on this system.')
    this.values.set(key, value)
  }
  delete(key: string): void {
    this.values.delete(key)
  }
}

export class FakeClipboard implements SecretClipboard {
  readonly copies: { text: string; clearAfterMs: number }[] = []
  copy(text: string, clearAfterMs: number): void {
    this.copies.push({ text, clearAfterMs })
  }
}

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-11-08T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current)
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
  set(iso: string): void {
    this.current = new Date(iso)
  }
}

type Script = string | ((task: AiTask) => string | Promise<string>)

/** AI engine whose answers are scripted by task label. Unscripted labels fail like a crashed engine process. */
export class FakeEngine implements AiEngine {
  readonly calls: AiTask[] = []
  readonly scripts = new Map<string, Script>()
  installed = true
  /** Tests flip this to prove that automatic replies are refused for engines that are not tool-free. */
  toolFree = true
  /** Tests flip this to prove that an agent mission is refused for an engine that cannot run one. */
  supportsAgent = true
  /** Tests flip this to prove that a picture is refused for an engine that cannot make one. */
  makesImages = true

  constructor(
    readonly id: EngineId = 'claude',
    readonly label = 'Fake engine'
  ) {}

  on(label: string, script: Script): this {
    this.scripts.set(label, script)
    return this
  }

  async check(): Promise<EngineStatus> {
    return {
      id: this.id,
      label: this.label,
      installed: this.installed,
      version: '0.0-test',
      path: '/fake/bin',
      ready: this.installed,
      detail: this.installed ? 'ok' : 'not installed',
      checkedAt: new Date().toISOString()
    }
  }

  async run(task: AiTask, options?: AiRunOptions): Promise<string> {
    this.calls.push(task)
    if (options?.signal?.aborted) throw new AiError('cancelled', 'cancelled')
    if (!this.installed) throw new AiError('unavailable', 'not installed')
    const script = this.scripts.get(task.label)
    if (script === undefined) throw new AiError('failed', `No scripted answer for ${task.label}`)
    options?.onProgress?.(`running ${task.label}`)
    return typeof script === 'function' ? script(task) : script
  }
}

/** Stands in for the main process's socket: remembers the tool host of each run and says it was closed; tests call the tools through `host`. */
export class FakeAgentBridge implements AgentBridge {
  readonly opened: McpToolHost[] = []
  closed = 0
  get host(): McpToolHost {
    const host = this.opened.at(-1)
    if (!host) throw new Error('no run has opened its tools yet')
    return host
  }
  async open(host: McpToolHost): Promise<{ launch: McpLaunch; close: () => void }> {
    this.opened.push(host)
    return { launch: { command: '/fake/ppd', args: ['/fake/shim.js'], env: { PPD_MCP_TOKEN: 'fake-token' } }, close: () => void (this.closed += 1) }
  }
}

/** A raw page that records every operation; `responses` maps a read() script substring to its result. */
export class FakePage implements RawPage {
  readonly log: string[] = []
  responses: { match: string; value: unknown }[] = []
  selectors = new Set<string>()
  currentUrl = 'about:blank'

  async goto(url: string): Promise<void> {
    this.log.push(`goto ${url}`)
    this.currentUrl = url
  }
  async url(): Promise<string> {
    return this.currentUrl
  }
  async read<T>(script: string): Promise<T> {
    this.log.push(`read ${script.slice(0, 40)}`)
    const hit = this.responses.find((r) => script.includes(r.match))
    return hit?.value as T
  }
  async waitForSelector(selector: string): Promise<boolean> {
    this.log.push(`wait ${selector}`)
    return this.selectors.has(selector)
  }
  async fill(selector: string, text: string): Promise<void> {
    this.log.push(`fill ${selector} ${text}`)
  }
  async click(selector: string): Promise<void> {
    this.log.push(`click ${selector}`)
  }
  async uploadFile(selector: string, path: string): Promise<void> {
    this.log.push(`upload ${selector} ${path}`)
  }
  /** Page steps carried out on this page (tests read them) and what each one answers; the last answer repeats. */
  readonly steps: { step: PageStep; hosts: string[] }[] = []
  stepAnswers: PageStepResult[] = [{ status: 'done', detail: 'ok' }]
  async pageStep(step: PageStep, hosts: string[]): Promise<PageStepResult> {
    this.log.push(`pageStep ${step.do} ${'ref' in step ? step.ref : step.key}`)
    this.steps.push({ step, hosts })
    return this.stepAnswers.length > 1 ? (this.stepAnswers.shift() as PageStepResult) : (this.stepAnswers[0] ?? { status: 'done', detail: 'ok' })
  }
  /** What the sign-in step received (the password is deliberately kept out of `log`), and the statuses it answers with, in order. */
  readonly signIns: SignInForm[] = []
  signInAnswers: SignInStatus[] = ['submitted']
  async signIn(form: SignInForm): Promise<{ status: SignInStatus }> {
    this.log.push(`signIn ${form.username} on ${form.hosts.join(',')}`)
    this.signIns.push(form)
    return { status: this.signInAnswers.length > 1 ? (this.signInAnswers.shift() as SignInStatus) : (this.signInAnswers[0] ?? 'submitted') }
  }
}

export class FakeBrowserService implements BrowserService {
  readonly pages = new Map<string, FakePage>()
  readonly sessions = new Map<string, ControlledSession>()
  readonly opened: { accountId: string; url?: string }[] = []
  /** Accounts whose browser was shown to the owner while the AI worked in it. */
  readonly agentShown: string[] = []
  private core: Core | null = null

  attach(core: Core): void {
    this.core = core
  }

  page(accountId: string): FakePage {
    let page = this.pages.get(accountId)
    if (!page) {
      page = new FakePage()
      this.pages.set(accountId, page)
    }
    return page
  }

  session(account: Account): BrowserSession {
    let session = this.sessions.get(account.id)
    if (!session) {
      if (!this.core) throw new Error('FakeBrowserService.attach(core) must be called first')
      session = new ControlledSession(account.id, async () => this.page(account.id), this.core.tickets)
      this.sessions.set(account.id, session)
    }
    return session
  }

  /** Accounts whose window for the person is open, and how many times each was brought to the front. */
  readonly windows = new Set<string>()
  readonly shown: string[] = []
  onUserWindowChange?: (accountId: string, change: 'opened' | 'closed') => void
  onPageNote?: (accountId: string, note: string) => void
  /** What the page of an account shows right now (tests set it); an account without an entry has no page open. */
  readonly pageReports = new Map<string, PageReport>()

  async pageReport(account: Account): Promise<PageReport | null> {
    return this.pageReports.get(account.id) ?? null
  }

  /** Accounts whose browser was brought to the front for the owner to act in it. */
  readonly agentFocused: string[] = []
  showAgentBrowser(account: Account, focus = false): void {
    this.agentShown.push(account.id)
    if (focus) this.agentFocused.push(account.id)
  }

  async openForUser(account: Account, url?: string): Promise<{ tabId: string }> {
    this.opened.push({ accountId: account.id, url })
    this.session(account).takeControl()
    this.windows.add(account.id)
    this.onUserWindowChange?.(account.id, 'opened')
    return { tabId: `tab-${account.id}` }
  }

  hasUserWindow(account: Account): boolean {
    return this.windows.has(account.id)
  }

  showUserWindow(account: Account): boolean {
    if (!this.windows.has(account.id)) return false
    this.shown.push(account.id)
    return true
  }

  /** What closing the real window does: the browser goes back to the app, and the core is told. */
  closeUserWindow(account: Account): void {
    if (!this.windows.delete(account.id)) return
    this.session(account).releaseControl()
    this.onUserWindowChange?.(account.id, 'closed')
  }
}

export interface TestCore {
  core: Core
  clock: FakeClock
  engine: FakeEngine
  browser: FakeBrowserService
  secrets: MemorySecretStore
  clipboard: FakeClipboard
  bridge: FakeAgentBridge
}

/** In-memory core with a fake clock, a scripted AI engine and a fake browser. */
export function makeTestCore(overrides: Partial<CoreDeps> & { connectors?: Connector[] } = {}): TestCore {
  const clock = new FakeClock()
  const engine = new FakeEngine()
  const browser = new FakeBrowserService()
  const secrets = new MemorySecretStore()
  const clipboard = new FakeClipboard()
  const bridge = new FakeAgentBridge()
  const core = new Core({
    dbPath: ':memory:',
    dataDir: mkdtempSync(join(tmpdir(), 'ppd-test-')),
    appVersion: '0.0.0-test',
    clock,
    engines: [engine],
    browser,
    connectors: [],
    secrets,
    clipboard,
    agentBridge: bridge,
    sleep: async () => undefined,
    ...overrides
  })
  browser.attach(core)
  core.settings.updateApp({ engineId: engine.id })
  return { core, clock, engine, browser, secrets, clipboard, bridge }
}
