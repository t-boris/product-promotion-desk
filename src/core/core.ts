import { ApiError } from '../shared/api'
import { Connectors } from './connector-registry'
import { openDatabase, type Db } from './db/database'
import { EngineRegistry } from './engines'
import { EventBus } from './events'
import { Logger } from './logger'
import {
  systemClock,
  type AiEngine,
  type BrowserService,
  type Clock,
  type Connector,
  type ConnectorContext,
  type TicketVerifier
} from './ports'
import { Repos } from './repos'
import { RunRecorder } from './runs'
import { ApiRouter } from './api/router'
import type { CoreServices } from './services'
import { SettingsStore } from './settings'
import { TicketAuthority } from './tickets'
import { registerModules } from './modules'

export interface CoreDeps {
  /** SQLite file path, or ':memory:'. */
  dbPath: string
  dataDir: string
  appVersion: string
  clock?: Clock
  engines: AiEngine[]
  /** The browser service, or a factory receiving the core's ticket verifier (write actions need tickets). */
  browser: BrowserService | ((tickets: TicketVerifier) => BrowserService)
  connectors: Connector[]
  secret?: Buffer
  echoLogs?: boolean
}

/** The application core: no Electron imports, fully testable with fakes (DEC-005). */
export class Core {
  readonly db: Db
  readonly clock: Clock
  readonly events = new EventBus()
  readonly log: Logger
  readonly settings: SettingsStore
  readonly repos: Repos
  readonly runs: RunRecorder
  readonly engines: EngineRegistry
  readonly connectors: Connectors
  readonly browser: BrowserService
  readonly tickets: TicketAuthority
  readonly router = new ApiRouter()
  readonly services: CoreServices = {}
  readonly dataDir: string
  readonly appVersion: string
  /** Set by the main process: the state of the optional loopback web mode (DEC-006). */
  webMode: { enabled: boolean; url: string | null } = { enabled: false, url: null }
  /** Set by the main process: true while no application window is open. */
  background = false

  private readonly shutdownHooks: (() => void | Promise<void>)[] = []

  constructor(deps: CoreDeps) {
    this.clock = deps.clock ?? systemClock
    this.db = openDatabase(deps.dbPath)
    this.dataDir = deps.dataDir
    this.appVersion = deps.appVersion
    this.log = new Logger(this.db, this.events, this.clock, deps.echoLogs ?? false)
    this.settings = new SettingsStore(this.db)
    this.repos = new Repos(this.db)
    this.runs = new RunRecorder(this.db, this.events, this.clock)
    this.engines = new EngineRegistry(deps.engines, this.settings)
    this.connectors = new Connectors(deps.connectors)
    this.tickets = new TicketAuthority(this.clock, deps.secret)
    this.browser = typeof deps.browser === 'function' ? deps.browser(this.tickets) : deps.browser
    registerModules(this)
  }

  /** Builds what a connector needs for one channel. Throws ApiError if the connector is missing. */
  connectorContext(channelId: string): { connector: Connector; ctx: ConnectorContext } {
    const channel = this.repos.channel(channelId)
    const account = this.repos.account(channel.accountId)
    const connector = this.connectors.get(channel.connectorId)
    if (!connector) throw new ApiError('connector_missing', `Connector not available: ${channel.connectorId}`)
    return {
      connector,
      ctx: { channel, account, session: this.browser.session(account), tickets: this.tickets, clock: this.clock }
    }
  }

  onShutdown(hook: () => void | Promise<void>): void {
    this.shutdownHooks.push(hook)
  }

  /** Runs shutdown hooks (persist progress, stop scheduler) and closes the database. */
  async shutdown(): Promise<void> {
    for (const hook of this.shutdownHooks.reverse()) {
      try {
        await hook()
      } catch (error) {
        this.log.error('core', `Shutdown hook failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.shutdownHooks.length = 0
    this.db.close()
  }
}

export function createCore(deps: CoreDeps): Core {
  return new Core(deps)
}
