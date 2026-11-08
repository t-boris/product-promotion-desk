import type { Core } from '../core'

/** Placeholder: minimal automation handlers so the shell works; the pipeline module replaces them. */
export function register(core: Core): void {
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
