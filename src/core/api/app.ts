import { ApiError } from '../../shared/api'
import type { Core } from '../core'

/** Application-level handlers: info, settings, AI engines, logs (I-2). */
export function register(core: Core): void {
  core.router.register({
    'app.info': () => ({
      name: 'Product Promotion Desk',
      version: core.appVersion,
      platform: process.platform,
      dataDir: core.dataDir,
      webMode: core.webMode
    }),
    'app.settings.get': () => core.settings.app(),
    'app.settings.update': (patch) => {
      const next = core.settings.updateApp(patch)
      core.events.changed('settings')
      return next
    },
    'engines.list': () => core.engines.checkAll(),
    'engines.check': async ({ id }) => {
      const engine = core.engines.get(id)
      if (!engine) throw new ApiError('not_found', `Unknown AI engine: ${id}`)
      return engine.check()
    },
    'engines.select': async ({ id }) => {
      const engine = core.engines.get(id)
      if (!engine) throw new ApiError('not_found', `Unknown AI engine: ${id}`)
      const status = await engine.check()
      if (!status.installed) throw new ApiError('engine_unavailable', status.detail)
      const next = core.settings.updateApp({ engineId: id })
      core.log.info('engines', `AI engine selected: ${engine.label}`)
      core.events.changed('settings')
      return next
    },
    'logs.list': ({ limit, level }) => core.log.list(limit ?? 200, level)
  })
}
