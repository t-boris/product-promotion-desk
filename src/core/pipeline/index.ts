import type { Core } from '../core'
import { registerFlow } from './register-flow'

/** Placeholder: minimal automation handlers so the shell works; the lifecycle work replaces them. */
export function register(core: Core): void {
  registerFlow(core)
  core.router.register({
    'automation.get': () => ({
      paused: core.settings.getRaw('automation.paused', false),
      running: false,
      activeRuns: 0,
      lastTickAt: null,
      nextDueAt: null,
      background: core.background
    }),
    'automation.setPaused': ({ paused }) => {
      core.settings.setRaw('automation.paused', paused)
      const state = {
        paused,
        running: false,
        activeRuns: 0,
        lastTickAt: null,
        nextDueAt: null,
        background: core.background
      }
      core.events.emit({ type: 'automation', state })
      return state
    },
    'attention.list': () => []
  })
}
