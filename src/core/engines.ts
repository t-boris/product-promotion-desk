import type { EngineId, EngineStatus } from '../shared/types'
import { AiError, type AiEngine } from './ports'
import type { SettingsStore } from './settings'

/** Holds the installed AI engines and the user's selection. Product data never depends on which one is selected. */
export class EngineRegistry {
  private readonly engines = new Map<EngineId, AiEngine>()

  constructor(
    engines: AiEngine[],
    private readonly settings: SettingsStore
  ) {
    for (const engine of engines) this.engines.set(engine.id, engine)
  }

  all(): AiEngine[] {
    return [...this.engines.values()]
  }

  get(id: EngineId): AiEngine | undefined {
    return this.engines.get(id)
  }

  selected(): AiEngine | null {
    const id = this.settings.app().engineId
    return id ? (this.engines.get(id) ?? null) : null
  }

  /** The selected engine, or an 'unavailable' AiError so callers fall back to manual entry. */
  require(): AiEngine {
    const engine = this.selected()
    if (!engine) throw new AiError('unavailable', 'No AI engine is selected. Choose Codex or Claude Code in Settings, or enter data manually.')
    return engine
  }

  async checkAll(): Promise<EngineStatus[]> {
    return Promise.all(this.all().map((e) => e.check()))
  }
}
