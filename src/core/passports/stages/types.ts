// What an analysis stage is, and what it can use while it runs.

import type { AnalysisStageName, AnalysisStageStatus, Claim, Id, IsoTime, Product, ProductSource } from '../../../shared/types'
import type { AiEngine } from '../../ports'
import type { SitePage } from '../url-reader'
import type { Finding } from '../evidence'

/** Thrown by a stage for an expected, explainable failure; the message is shown to the user as is. */
export class StageFailure extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StageFailure'
  }
}

export interface StageContext {
  productId: Id
  product: Product
  sources: ProductSource[]
  signal: AbortSignal
  /** The selected AI engine; throws AiError('unavailable') when none is selected. */
  engine(): AiEngine
  progress(message: string): void
  now(): IsoTime
  /** Output data of a stage that finished earlier in this analysis, or null. */
  output<T>(stage: AnalysisStageName): T | null
  /** Passes work to the passport (adding claims). Kept apart from `run` so it can be committed atomically with the stage. */
  passport: PassportPort
  userAgent: string
}

export interface PassportPort {
  workingClaims(): Pick<Claim, 'id' | 'section' | 'kind' | 'status' | 'text'>[]
  addGenerated(findings: Finding[]): { added: number; skipped: number }
  addContradictions(findings: { claimIds: Id[]; description: string }[]): number
}

export interface StageResult {
  status: Extract<AnalysisStageStatus, 'done' | 'skipped'>
  detail: string
  data: unknown
  /** Runs inside the same transaction that records the stage as finished; may amend the detail. */
  commit?: () => { detail?: string } | void
}

export interface StageDef {
  name: AnalysisStageName
  /** Shown while the stage runs. */
  startMessage: string
  needsEngine: boolean
  /** Everything the stage's result depends on; a finished stage is reused on resume only if this is unchanged. */
  inputs(ctx: StageContext): unknown
  run(ctx: StageContext): Promise<StageResult>
}

export interface SiteData {
  pages: (SitePage & { sourceId: Id })[]
  failures: { sourceId: Id; url: string; error: string }[]
}

export interface FindingsData {
  findings: Finding[]
  /** Attached files that were not analyzed (images, other file types). */
  materials: string[]
  notes: string[]
}
