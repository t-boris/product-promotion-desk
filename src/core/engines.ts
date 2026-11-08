import type { EngineId, EngineStatus } from '../shared/types'
import { AiError, type AiEngine, type AiRunOptions, type AiTask } from './ports'
import { titleOf, type AiActivity } from './ai-activity'
import type { SettingsStore } from './settings'

/**
 * An engine whose every run is shown to the person (AiActivity): what it does, for how long, the latest lines, and a Stop. It is the engine
 * itself in every other way; the properties tests and callers read are read from the engine at the moment they ask.
 */
class TrackedEngine implements AiEngine {
  constructor(
    private readonly inner: AiEngine,
    private readonly activity: AiActivity
  ) {}

  get id(): AiEngine['id'] {
    return this.inner.id
  }
  get label(): string {
    return this.inner.label
  }
  get toolFree(): boolean {
    return this.inner.toolFree
  }
  get supportsAgent(): boolean | undefined {
    return this.inner.supportsAgent
  }
  get makesImages(): boolean | undefined {
    return this.inner.makesImages
  }

  check(): ReturnType<AiEngine['check']> {
    return this.inner.check()
  }

  async run(task: AiTask, options: AiRunOptions = {}): Promise<string> {
    const handle = this.activity.start({ title: titleOf(task.label, task.title), engineLabel: this.inner.label, subject: task.subject ?? null }, options.signal)
    const startedAt = Date.now()
    handle.line(`Sent to ${this.inner.label}`)
    try {
      const answer = await this.inner.run(task, {
        ...options,
        signal: handle.signal,
        onProgress: (message) => {
          handle.line(message)
          options.onProgress?.(message)
        }
      })
      handle.line(`Finished in ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s`)
      handle.finish()
      return answer
    } catch (error) {
      if (error instanceof AiError && error.kind === 'cancelled') handle.fail('Stopped', true)
      else handle.fail(error instanceof Error ? error.message : String(error))
      throw error
    }
  }
}

/** Holds the installed AI engines and the user's selection. Product data never depends on which one is selected. */
export class EngineRegistry {
  private readonly engines = new Map<EngineId, AiEngine>()

  constructor(
    engines: AiEngine[],
    private readonly settings: SettingsStore,
    activity?: AiActivity
  ) {
    for (const engine of engines) this.engines.set(engine.id, activity ? new TrackedEngine(engine, activity) : engine)
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
