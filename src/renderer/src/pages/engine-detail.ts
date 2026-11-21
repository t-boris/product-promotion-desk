// The status text of an AI engine comes from the engine as one string: what was found, then "Writing: …", then "Account missions: …".
// Run together they read as one grey line with a path glued to a sentence (QA finding 11). Split here, so each part gets its own line.

export interface EngineDetail {
  /** What was found: "Claude Code 2.1.325 is installed and answers." */
  summary: string
  /** How the engine writes drafts: tool-free or not. */
  writing: string | null
  /** What it does on an account's browser. */
  missions: string | null
  /** True when the engine is not used for automatic replies: a limit the owner should see as a note, not as small grey text. */
  limits: boolean
}

export function splitEngineDetail(detail: string): EngineDetail {
  const writingAt = detail.indexOf('Writing:')
  const missionsAt = detail.indexOf('Account missions:')
  const summaryEnd = [writingAt, missionsAt].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? detail.length
  const writing = writingAt >= 0 ? detail.slice(writingAt, missionsAt > writingAt ? missionsAt : undefined).trim() : null
  const missions = missionsAt >= 0 ? detail.slice(missionsAt).trim() : null
  return { summary: detail.slice(0, summaryEnd).trim(), writing, missions, limits: writing !== null && /not used for automatic replies/.test(writing) }
}

/** The fields of an engine this module reads (EngineStatus has more). */
export interface EngineChoice {
  id: string
  installed: boolean
  detail: string
}

/** The engine the app recommends: the first one that is installed and writes tool-free, so its drafts can be used for
 *  automatic replies. Today that is Claude Code. Null when none qualifies. */
export function recommendedEngineId(engines: EngineChoice[]): string | null {
  return engines.find((engine) => engine.installed && !splitEngineDetail(engine.detail).limits)?.id ?? null
}

/** One main action per screen: "Use this engine" is filled only on the recommended engine while no engine is in use.
 *  Once one is in use, the recommended one is an accent outline and every other engine a plain button. */
export function engineChoiceVariant(engineId: string, recommendedId: string | null, anySelected: boolean): 'primary' | 'secondary' | 'ghost' {
  if (engineId !== recommendedId) return 'ghost'
  return anySelected ? 'secondary' : 'primary'
}

/** What the model field of an engine shows and does: what is saved, what is typed, and whether pressing the button would change anything. */
export interface ModelFieldView {
  /** What the input holds. */
  value: string
  /** The name to try and keep when the button is pressed (trimmed; empty means the engine's own default). */
  name: string
  /** The button has something to do: the typed name is not the one in use. */
  changed: boolean
  /** One line under the field: what is in use now. */
  inUse: string
}

export function modelFieldView(saved: string, draft: string | null): ModelFieldView {
  const value = draft ?? saved
  const name = value.trim()
  return {
    value,
    name,
    changed: name !== saved,
    inUse: saved ? `Asked for the model ${saved}.` : "The engine's own default model is used."
  }
}
