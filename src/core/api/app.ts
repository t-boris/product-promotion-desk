import { ApiError } from '../../shared/api'
import { AiError } from '../ports'
import { APP_NAME } from '../../shared/app-name'
import type { AppSettings } from '../../shared/types'
import { parseModelName } from '../../shared/engine-model'
import { MAX_SCHEDULE_GRACE_HOURS, MIN_SCHEDULE_GRACE_HOURS, isScheduleGraceHours } from '../../shared/schedule'
import { isThemeChoice } from '../../shared/themes'
import { parseWebPort } from '../../shared/web-port'
import type { Core } from '../core'

/** A web port the server cannot listen on is refused, so no screen, link or script can store one (BUG-044). Nothing of the request is stored then. */
function checkedPatch(patch: Partial<AppSettings>): Partial<AppSettings> {
  // Who publishes is a choice of two: anything else is refused, never stored, so an unknown value can never read as "the AI browser".
  if (patch.publishWith !== undefined && patch.publishWith !== 'connector' && patch.publishWith !== 'ai_browser') {
    throw new ApiError('invalid_input', 'Publishing is done either by the connector or by the AI browser.')
  }
  if (patch.scheduleGraceHours !== undefined && !isScheduleGraceHours(patch.scheduleGraceHours)) {
    throw new ApiError('invalid_input', `A scheduled item may be late by ${MIN_SCHEDULE_GRACE_HOURS} to ${MAX_SCHEDULE_GRACE_HOURS} whole hours.`)
  }
  for (const key of ['startAtLogin', 'keepAwake'] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean') throw new ApiError('invalid_input', 'This setting is either on or off.')
  }
  // The look is one of the themes the application has, and the animated background a plain on/off: anything else is refused and never stored (visual-system.md §33).
  if (patch.theme !== undefined && !isThemeChoice(patch.theme)) {
    throw new ApiError('invalid_input', 'Choose "Follow macOS" or one of the themes the application has.')
  }
  if (patch.animatedBackground !== undefined && typeof patch.animatedBackground !== 'boolean') {
    throw new ApiError('invalid_input', 'The animated background is either on or off.')
  }
  // A model is kept only when it is one the engine offers: it goes through `engines.setModel`, never through the settings as a whole.
  if (patch.models !== undefined) throw new ApiError('invalid_input', 'Choose the model in the engine\'s own card, from the list the engine offers.')
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
    'engines.models': async ({ id }) => {
      if (!core.engines.get(id)) throw new ApiError('not_found', `Unknown AI engine: ${id}`)
      try {
        return await core.engines.models(id)
      } catch (error) {
        throw new ApiError(error instanceof AiError && error.kind === 'unavailable' ? 'engine_unavailable' : 'failed', error instanceof Error ? error.message : String(error))
      }
    },
    'engines.setModel': async ({ id, model }) => {
      const engine = core.engines.get(id)
      if (!engine) throw new ApiError('not_found', `Unknown AI engine: ${id}`)
      const name = parseModelName(model)
      if (name === null) throw new ApiError('invalid_input', 'That is not the name of a model.')
      if (name !== '') {
        // Only a model the engine itself offers: the owner picks it from that list, and nothing else is ever handed to the engine's command line.
        const offered = await core.router.call('engines.models', { id })
        if (!offered.some((m) => m.id === name)) throw new ApiError('invalid_model', `${engine.label} does not offer the model "${name}". Choose one from its list.`)
      }
      const next = core.settings.updateApp({ models: { ...core.settings.app().models, [id]: name } })
      core.log.info('engines', name ? `${engine.label} will use the model ${name}` : `${engine.label} will use its own default model`)
      core.events.changed('settings')
      return next
    },
    'logs.list': ({ limit, level }) => core.log.list(limit ?? 200, level)
  })
}
