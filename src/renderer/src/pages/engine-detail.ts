import type { EngineModel } from '../../../shared/types'

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

/** The first option of the model list: no model named, so the engine uses its own default (what it did before the owner could choose). */
export const DEFAULT_MODEL_OPTION = "The engine's own default"

export interface ModelOption {
  value: string
  label: string
}

/**
 * What the model dropdown of an engine offers: the engine's own default, then every model the engine lists. A model that was chosen earlier and that
 * the engine no longer lists stays in the list, marked, so the card never shows a choice it does not have.
 */
export function modelOptions(offered: readonly EngineModel[], saved: string): ModelOption[] {
  const options: ModelOption[] = [{ value: '', label: DEFAULT_MODEL_OPTION }, ...offered.map((m) => ({ value: m.id, label: m.label === m.id ? m.label : `${m.label} (${m.id})` }))]
  if (saved && !offered.some((m) => m.id === saved)) options.push({ value: saved, label: `${saved} (the engine no longer lists it)` })
  return options
}

/** The line under the dropdown: what the engine says about the chosen model, or what the default means. */
export function modelNote(offered: readonly EngineModel[], saved: string): string {
  if (!saved) return "No model is named, so the engine uses the one it chooses itself."
  return offered.find((m) => m.id === saved)?.description || ''
}
