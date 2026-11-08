import { ApiError } from '../../../shared/api'
import type { SourceScope } from '../../../shared/types'
import { readScannedFile, scanCodeFolder, type ScanResult } from '../code-scan'
import { extractFindings, type Material } from './extract'
import { StageFailure, type FindingsData, type StageContext, type StageDef } from './types'

// Scans are cheap but not free, and both the input hash and the run need them.
const scanCache = new WeakMap<StageContext, Map<string, ScanResult | ApiError>>()

function scanOf(ctx: StageContext, source: { id: string; ref: string; scope: SourceScope | null }): ScanResult | ApiError {
  let cache = scanCache.get(ctx)
  if (!cache) scanCache.set(ctx, (cache = new Map()))
  const cached = cache.get(source.id)
  if (cached) return cached
  let result: ScanResult | ApiError
  try {
    result = scanCodeFolder(source.ref, source.scope)
  } catch (error) {
    result = error instanceof ApiError ? error : new ApiError('invalid_input', error instanceof Error ? error.message : String(error))
  }
  cache.set(source.id, result)
  return result
}

/**
 * Reads the chosen project folders: files only, never executed. The scan decides what is visible (secrets, environment
 * files, dependencies and build output are excluded) and every included file is redacted before it reaches the engine.
 */
export const scanCodeStage: StageDef = {
  name: 'scan_code',
  startMessage: 'Reading the source code (read-only)…',
  needsEngine: true,
  inputs: (ctx) =>
    ctx.sources
      .filter((s) => s.kind === 'code_folder')
      .map((s) => {
        const scan = scanOf(ctx, s)
        return { id: s.id, ref: s.ref, scope: s.scope, files: scan instanceof ApiError ? scan.message : scan.included.map((f) => [f.path, f.size]) }
      }),
  async run(ctx) {
    const folders = ctx.sources.filter((s) => s.kind === 'code_folder')
    if (folders.length === 0) return { status: 'skipped', detail: 'No source code folder was provided.', data: null }
    const verifiedAt = ctx.now()
    const materials: Material[] = []
    const problems: string[] = []
    let included = 0
    let excluded = 0
    let redactions = 0
    let n = 0
    for (const source of folders) {
      const scan = scanOf(ctx, source)
      if (scan instanceof ApiError) {
        problems.push(`${source.label}: ${scan.message}`)
        continue
      }
      included += scan.included.length
      excluded += scan.excludedCount
      for (const file of scan.included) {
        const text = readScannedFile(scan.root, file)
        if (!text) continue
        redactions += text.redactions
        materials.push({
          block: { key: `F${++n}`, type: 'code', ref: `${source.label}/${file.path}`, text: text.text },
          evidence: [{ sourceId: source.id, ref: `${source.ref}/${file.path}`, sourceKind: 'code_folder', verifiedAt }]
        })
      }
    }
    if (materials.length === 0) {
      if (problems.length > 0) throw new StageFailure(`The source code folder could not be read. ${problems.join(' ')}`)
      return { status: 'skipped', detail: 'The chosen folders contain no files the AI is allowed to read.', data: null }
    }
    ctx.progress(`Analyzing ${materials.length} files`)
    const result = await extractFindings(ctx, { label: 'passport.code', materials, codeOnly: true, perBlock: 8_000, total: 70_000 })
    const data: FindingsData = { findings: result.findings, materials: [], notes: result.notes }
    const masked = redactions > 0 ? `; ${redactions} secret-looking string${redactions === 1 ? '' : 's'} masked` : ''
    return {
      status: 'done',
      detail: `${result.findings.length} statement${result.findings.length === 1 ? '' : 's'} from ${included} files (${excluded} items left out${masked}).`,
      data
    }
  }
}
