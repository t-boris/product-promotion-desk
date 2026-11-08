import { randomBytes } from 'node:crypto'
import type { Core } from '../core/core'
import { startWebServer, type RunningWebServer } from './web-server'

/**
 * Keeps the optional loopback web server (DEC-006) in line with the settings toggle.
 * Verification can force it on with PPD_WEB_MODE=1 (optionally PPD_WEB_PORT / PPD_WEB_TOKEN).
 */
export class WebModeController {
  private running: { server: RunningWebServer; port: number } | null = null
  private readonly token = process.env.PPD_WEB_TOKEN || randomBytes(18).toString('base64url')
  private busy: Promise<void> = Promise.resolve()

  constructor(
    private readonly core: Core,
    private readonly staticDir: string
  ) {
    core.events.subscribe((event) => {
      if (event.type === 'changed' && event.scope === 'settings') void this.reconcile()
    })
    core.onShutdown(() => this.stop())
  }

  private desired(): { enabled: boolean; port: number } {
    const stored = this.core.settings.app().webMode
    const forced = process.env.PPD_WEB_MODE === '1'
    const port = Number(process.env.PPD_WEB_PORT) || stored.port
    return { enabled: forced || stored.enabled, port }
  }

  /** Serialized so rapid toggles never race. */
  reconcile(): Promise<void> {
    this.busy = this.busy.then(() => this.apply()).catch((error: unknown) => {
      this.core.log.error('web-mode', `Could not apply web mode: ${error instanceof Error ? error.message : String(error)}`)
    })
    return this.busy
  }

  private async apply(): Promise<void> {
    const want = this.desired()
    if (this.running && (!want.enabled || this.running.port !== want.port)) await this.stop()
    if (want.enabled && !this.running) {
      const server = await startWebServer({ core: this.core, port: want.port, token: this.token, staticDir: this.staticDir })
      this.running = { server, port: want.port }
      this.core.webMode = { enabled: true, url: server.url }
      this.core.log.info('web-mode', `Loopback web mode listening on 127.0.0.1:${server.port}`)
      this.core.events.changed('settings')
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return
    const { server } = this.running
    this.running = null
    await server.close()
    this.core.webMode = { enabled: false, url: null }
    this.core.log.info('web-mode', 'Loopback web mode stopped')
    this.core.events.changed('settings')
  }
}
