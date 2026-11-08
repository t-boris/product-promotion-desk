// Test doubles shared by all module tests. Not imported by production code.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account, EngineId, EngineStatus } from '../../shared/types'
import { ControlledSession, type RawPage } from '../browser-session'
import { Core, type CoreDeps } from '../core'
import {
  AiError,
  type AiEngine,
  type AiRunOptions,
  type AiTask,
  type BrowserService,
  type BrowserSession,
  type Clock,
  type Connector
} from '../ports'

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
}

export class FakeBrowserService implements BrowserService {
  readonly pages = new Map<string, FakePage>()
  readonly sessions = new Map<string, ControlledSession>()
  readonly opened: { accountId: string; url?: string }[] = []
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

  async openForUser(account: Account, url?: string): Promise<{ tabId: string }> {
    this.opened.push({ accountId: account.id, url })
    this.session(account).takeControl()
    return { tabId: `tab-${account.id}` }
  }
}

export interface TestCore {
  core: Core
  clock: FakeClock
  engine: FakeEngine
  browser: FakeBrowserService
}

/** In-memory core with a fake clock, a scripted AI engine and a fake browser. */
export function makeTestCore(overrides: Partial<CoreDeps> & { connectors?: Connector[] } = {}): TestCore {
  const clock = new FakeClock()
  const engine = new FakeEngine()
  const browser = new FakeBrowserService()
  const core = new Core({
    dbPath: ':memory:',
    dataDir: mkdtempSync(join(tmpdir(), 'ppd-test-')),
    appVersion: '0.0.0-test',
    clock,
    engines: [engine],
    browser,
    connectors: [],
    ...overrides
  })
  browser.attach(core)
  core.settings.updateApp({ engineId: engine.id })
  return { core, clock, engine, browser }
}
