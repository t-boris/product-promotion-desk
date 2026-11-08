import type { Core } from './core'
import { register as registerApp } from './api/app'
import { register as registerPassports } from './passports'
import { register as registerChannels } from './channels'
import { register as registerPipeline } from './pipeline'

/** Every module attaches its API handlers and services to the core here. Order matters only for services lookups at call time. */
export function registerModules(core: Core): void {
  registerApp(core)
  registerPassports(core) // I-1: products, sources, analysis, claims, versions
  registerChannels(core) // I-3: accounts, channels, capability assessment
  registerPipeline(core) // I-4..I-8: monitoring, drafting, sending, scheduler, lifecycle, results
}
