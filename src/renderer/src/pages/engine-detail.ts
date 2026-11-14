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
