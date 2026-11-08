import type { Core } from '../core'
import { registerHandlers } from './api'
import { PassportModule } from './module'

const modules = new WeakMap<Core, PassportModule>()

/**
 * Products, sources, analysis and the versioned passport (REQ-001). Attaches the API handlers and the
 * KnowledgeProvider service that drafting and sending use.
 */
export function register(core: Core): void {
  const mod = new PassportModule(core)
  modules.set(core, mod)
  // An analysis cannot survive a restart; park it so the user can resume it with its finished stages intact.
  mod.store.recoverInterrupted()
  core.services.knowledge = mod.knowledge
  core.onShutdown(() => mod.analysis.stopAll())
  registerHandlers(core, mod)
}

/** The passports module of a core (used by tests and by other modules that need the passport view). */
export function passportsOf(core: Core): PassportModule {
  const mod = modules.get(core)
  if (!mod) throw new Error('The passports module is not registered for this core.')
  return mod
}
