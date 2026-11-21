import { ApiError } from '../../shared/api'
import { APP_NAME } from '../../shared/app-name'
import type { AppSettings } from '../../shared/types'
import { isThemeChoice } from '../../shared/themes'
import { parseWebPort } from '../../shared/web-port'
import type { Core } from '../core'

/** A web port the server cannot listen on is refused, so no screen, link or script can store one (BUG-044). Nothing of the request is stored then. */
function checkedPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  // Who publishes is a choice of two: anything else is refused, never stored, so an unknown value can never read as "the AI browser".
  if (patch.publishWith !== undefined && patch.publishWith !== 'connector' && patch.publishWith !== 'ai_browser') {
    throw new ApiError('invalid_input', 'Publishing is done either by the connector or by the AI browser.')
  }
  // The look is one of the themes the application has, and the animated background a plain on/off: anything else is refused and never stored (visual-system.md §33).
  if (patch.theme !== undefined && !isThemeChoice(patch.theme)) {
    throw new ApiError('invalid_input', 'Choose "Follow macOS" or one of the themes the application has.')
  }
  if (patch.animatedBackground !== undefined && typeof patch.animatedBackground !== 'boolean') {
    throw new ApiError('invalid_input', 'The animated background is either on or off.')
  }
  if (patch.webMode?.port === undefined) return patch
  const port = parseWebPort(String(patch.webMode.port))
  if (!port.ok) throw new ApiError('invalid_input', port.message)
  return { ...patch, webMode: { ...patch.webMode, port: port.port } }
}

/** Application-level handlers: info, settings, AI engines, logs (I-2). */
export function register(core: Core): void {
  core.router.register({
    'app.info': () => ({
      name: APP_NAME,
      version: core.appVersion,
      platform: process.platform,
      dataDir: core.dataDir,
      webMode: core.webMode
    }),
    'app.settings.get': () => core.settings.app(),
    'app.settings.update': (patch) => {
      const next = core.settings.updateApp(checkedPatch(patch))
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
