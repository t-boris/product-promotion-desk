import { askJson } from '../ai-json'
import { contradictionPrompt } from '../prompts'
import { normalizeForCompare } from '../text'
import { validateConflicts } from '../validate'
import type { StageDef } from './types'

/** Statements worth comparing: not rejected, and making an assertion (unknowns and earlier contradictions do not). */
const comparable = (c: { kind: string; status: string }): boolean => c.kind !== 'contradiction' && c.kind !== 'unknown' && c.status !== 'rejected'

/** Asks the engine which claims cannot all be true. Conflicts are recorded as contradictions; no version is chosen. */
export const findContradictionsStage: StageDef = {
  name: 'find_contradictions',
  startMessage: 'Looking for contradictions…',
  needsEngine: true,
  inputs: (ctx) =>
    ctx.passport
      .workingClaims()
      .filter(comparable)
      .map((c) => [c.id, c.status, normalizeForCompare(c.text)]),
  async run(ctx) {
    const claims = ctx.passport.workingClaims().filter(comparable)
    if (claims.length < 2) return { status: 'skipped', detail: 'Fewer than two statements, so there is nothing to compare.', data: null }
    const keyed = claims.map((c, i) => ({ key: `C${i + 1}`, claim: c }))
    const task = contradictionPrompt({ claims: keyed.map(({ key, claim }) => `${key} [${claim.section}/${claim.kind}] ${claim.text}`).join('\n') })
    const conflicts = await askJson(ctx.engine(), task, validateConflicts, { signal: ctx.signal, onProgress: ctx.progress })
    const byKey = new Map(keyed.map(({ key, claim }) => [key, claim.id]))
    const findings = conflicts
      .map((conflict) => ({
        claimIds: conflict.claims.map((key) => byKey.get(key.trim().toUpperCase())).filter((id): id is string => id !== undefined),
        description: conflict.description || 'These statements cannot all be true.'
      }))
      .filter((finding) => finding.claimIds.length >= 2)
    return {
      status: 'done',
      detail: '',
      data: { reported: findings.length },
      commit: () => {
        const created = ctx.passport.addContradictions(findings)
        return { detail: created > 0 ? `${created} contradiction${created === 1 ? '' : 's'} found: they need your decision.` : 'No new contradictions found.' }
      }
    }
  }
}
