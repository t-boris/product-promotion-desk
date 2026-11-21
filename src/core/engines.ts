import type { EngineId, EngineModel, EngineStatus } from '../shared/types'
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
  get confinesAgent(): boolean | undefined {
    return this.inner.confinesAgent
  }
  get makesImages(): boolean | undefined {
    return this.inner.makesImages
  }

  check(): ReturnType<AiEngine['check']> {
    return this.inner.check()
  }

  models(): ReturnType<AiEngine['models']> {
    return this.inner.models()
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

/**
 * An engine that is asked for the model the owner chose for it in Settings, unless the task names one (a model is tried that way before it is kept). With no
 * model chosen the task goes through as it is, and the engine uses its own default.
 */
class ModelledEngine implements AiEngine {
  constructor(
    private readonly inner: AiEngine,
    private readonly settings: SettingsStore
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
  get confinesAgent(): boolean | undefined {
    return this.inner.confinesAgent
  }
  get makesImages(): boolean | undefined {
    return this.inner.makesImages
  }

  check(): ReturnType<AiEngine['check']> {
    return this.inner.check()
  }

  models(): ReturnType<AiEngine['models']> {
    return this.inner.models()
  }

  run(task: AiTask, options?: AiRunOptions): Promise<string> {
    const chosen = this.settings.app().models[this.inner.id]
    return this.inner.run(task.model === undefined && chosen ? { ...task, model: chosen } : task, options)
  }
}

/** Holds the installed AI engines and the user's selection. Product data never depends on which one is selected. */
export class EngineRegistry {
  private readonly engines = new Map<EngineId, AiEngine>()
  private readonly modelLists = new Map<EngineId, EngineModel[]>()

  constructor(
    engines: AiEngine[],
    private readonly settings: SettingsStore,
    activity?: AiActivity
  ) {
    for (const engine of engines) {
      const modelled = new ModelledEngine(engine, settings)
      this.engines.set(engine.id, activity ? new TrackedEngine(modelled, activity) : modelled)
    }
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
    // A re-check is also how the owner asks for the models again (a new one may have come out): the lists are read afresh next time.
    this.modelLists.clear()
    return Promise.all(this.all().map((e) => e.check()))
  }

  /** The models an engine offers, as the engine lists them. Kept until the next re-check; a list that could not be read is not kept. */
  async models(id: EngineId): Promise<EngineModel[]> {
    const engine = this.engines.get(id)
    if (!engine) throw new AiError('unavailable', `Unknown AI engine: ${id}`)
    const kept = this.modelLists.get(id)
    if (kept) return kept
    const list = await engine.models()
    this.modelLists.set(id, list)
    return list
  }

  /**
   * First launch: when no engine is in use, the first one that is installed and ready is selected, so every AI help works without
   * a visit to Settings. A tool-free engine goes first (its drafts can be used for automatic replies). A choice the owner made is
   * never replaced, even while that engine is not ready. Returns the engine that was selected, or null when nothing changed.
   */
  async autoSelect(): Promise<AiEngine | null> {
    if (this.selected()) return null
    const statuses = await this.checkAll()
    const ready = this.all().filter((engine) => statuses.some((status) => status.id === engine.id && status.installed && status.ready))
    const pick = ready.find((engine) => engine.toolFree) ?? ready[0]
    // The checks take a moment: a choice the owner made in the meantime stands.
    if (!pick || this.selected()) return null
    this.settings.updateApp({ engineId: pick.id })
    return pick
  }
}
