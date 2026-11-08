// The analysis runner (REQ-001): runs the stages in order for one product, records each stage as it finishes so an
// interrupted analysis resumes where it stopped, can be stopped at any moment, and never throws out of its run.
// Every analysis is recorded as a run (REQ-005), and the user sees the stage progress through events.

import { ApiError } from '../../shared/api'
import type { AnalysisStage, AnalysisStageName, AnalysisStatus, Id } from '../../shared/types'
import { tx } from '../db/database'
import type { Core } from '../core'
import { AiError, type AiEngine } from '../ports'
import type { RunResult } from '../runs'
import { UnusableAnswerError } from './ai-json'
import type { ClaimService } from './claim-service'
import { toSourceRef, type Finding } from './evidence'
import { STAGE_ORDER, type ProductStore } from './store'
import { analyzeDocumentsStage } from './stages/analyze-documents'
import { findContradictionsStage } from './stages/find-contradictions'
import { readSiteStage } from './stages/read-site'
import { scanCodeStage } from './stages/scan-code'
import { synthesizeStage } from './stages/synthesize'
import { StageFailure, type PassportPort, type StageContext, type StageDef } from './stages/types'
import { hashJson } from './text'
import type { PassportVersions } from './versions'

const STAGES: StageDef[] = [readSiteStage, analyzeDocumentsStage, scanCodeStage, synthesizeStage, findContradictionsStage]
const PROGRESS_THROTTLE_MS = 400

interface Envelope {
  inputHash: string
  data: unknown
}

interface Outcome {
  status: AnalysisStatus
  run: RunResult
}

/** A message the user can act on, for any error a stage can end with. */
export function describeStageError(error: unknown): string {
  if (error instanceof StageFailure || error instanceof UnusableAnswerError) return error.message
  if (error instanceof AiError) {
    switch (error.kind) {
      case 'unavailable':
        return `The AI engine is not available. ${error.message} Check Settings, or enter the passport by hand.`
      case 'timeout':
        return `The AI engine took too long. ${error.message} Try again.`
      case 'invalid_output':
        return `The AI engine returned an unusable answer. ${error.message}`
      case 'cancelled':
        return 'The AI task was cancelled.'
      case 'failed':
        return `The AI engine failed. ${error.message}`
    }
  }
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
}

export class AnalysisRunner {
  private readonly running = new Map<Id, { controller: AbortController; done: Promise<void> }>()

  constructor(
    private readonly core: Core,
    private readonly store: ProductStore,
    private readonly claims: ClaimService,
    private readonly versions: PassportVersions
  ) {}

  isRunning(productId: Id): boolean {
    return this.running.has(productId)
  }

  /** Waits until the analysis of this product (if any) has settled. */
  async settled(productId: Id): Promise<void> {
    await this.running.get(productId)?.done
  }

  /**
   * Starts (or resumes) the analysis in the background. Fails with 'engine_unavailable' before anything is touched
   * when no working AI engine is selected: the user continues by hand and no data changes.
   */
  async start(productId: Id): Promise<void> {
    const product = this.store.product(productId)
    if (this.running.has(productId)) return
    await this.preflight()
    if (this.running.has(productId)) return
    // A finished analysis starts over (sources may have changed); an interrupted or failed one resumes.
    if (product.analysisStatus === 'complete') this.store.clearStages(productId)
    this.store.setAnalysisStatus(productId, 'running')
    this.core.events.changed('products', 'passport')
    const controller = new AbortController()
    const done = this.run(productId, controller.signal).finally(() => this.running.delete(productId))
    this.running.set(productId, { controller, done })
  }

  /** Stops the analysis; finished stages are kept. Resolves once the run has settled. */
  async stop(productId: Id): Promise<void> {
    const entry = this.running.get(productId)
    if (!entry) return
    entry.controller.abort()
    await entry.done
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)))
  }

  private async preflight(): Promise<AiEngine> {
    const selected = this.core.engines.selected()
    if (!selected) {
      throw new ApiError('engine_unavailable', 'No AI engine is selected. Choose Codex or Claude Code in Settings, or enter the passport by hand.')
    }
    const status = await selected.check()
    if (!status.installed || !status.ready) throw new ApiError('engine_unavailable', status.detail || `${selected.label} is not available.`)
    return selected
  }

  // ───────────── the run ─────────────

  private async run(productId: Id, signal: AbortSignal): Promise<void> {
    let final: AnalysisStatus = 'failed'
    try {
      await this.core.runs.track('analysis', { productId }, async () => {
        const outcome = await this.executeStages(productId, signal)
        final = outcome.status
        return outcome.run
      })
    } catch (error) {
      // Recording the run itself failed; the analysis must still end in a consistent state.
      this.core.log.error('passports', `Analysis run failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      this.store.setAnalysisStatus(productId, final)
    } catch {
      // The product was deleted while the analysis ran.
    }
    this.core.events.changed('products', 'passport')
  }

  private context(productId: Id, signal: AbortSignal): { ctx: StageContext; setStage: (name: AnalysisStageName) => void } {
    const store = this.store
    let lastProgress = 0
    let currentStage: AnalysisStageName = 'read_site'
    const passport: PassportPort = {
      workingClaims: () => this.versions.working(productId).claims,
      addGenerated: (findings: Finding[]) => {
        const result = this.claims.addGenerated(
          productId,
          findings.map((f) => ({
            section: f.section,
            text: f.text,
            kind: f.kind,
            sources: f.evidence.map(toSourceRef),
            unconfirmedAvailability: f.unconfirmedAvailability
          }))
        )
        return { added: result.added.length, skipped: result.skipped }
      },
      addContradictions: (findings) => this.claims.addContradictions(productId, findings).length
    }
    const ctx: StageContext = {
      productId,
      product: store.product(productId),
      sources: store.sources(productId),
      signal,
      engine: () => this.core.engines.require(),
      progress: (message) => {
        const now = Date.now()
        if (now - lastProgress < PROGRESS_THROTTLE_MS) return
        lastProgress = now
        this.save(productId, currentStage, 'running', message)
      },
      now: () => this.core.clock.now().toISOString(),
      output: <T>(name: AnalysisStageName): T | null => {
        const row = store.stageRows(productId).find((r) => r.name === name)
        if (!row || row.status !== 'done' || !row.outputJson) return null
        return (JSON.parse(row.outputJson) as Envelope).data as T | null
      },
      passport,
      userAgent: `ProductPromotionDesk/${this.core.appVersion} (+local desktop app)`
    }
    return {
      ctx,
      setStage: (name) => {
        currentStage = name
      }
    }
  }

  private save(productId: Id, name: AnalysisStageName, status: AnalysisStage['status'], detail: string, outputJson?: string | null): void {
    try {
      const stage = this.store.saveStage(productId, name, status, detail, outputJson)
      this.core.events.emit({ type: 'analysis', productId, stage })
    } catch {
      // The product was deleted while the analysis ran.
    }
  }

  private async executeStages(productId: Id, signal: AbortSignal): Promise<Outcome> {
    const { ctx, setStage } = this.context(productId, signal)
    const stored = new Map(this.store.stageRows(productId).map((r) => [r.name, r]))
    let skipReason: string | null = null // set when later AI stages cannot work
    for (const stage of STAGES) {
      if (signal.aborted) return this.paused()
      if (skipReason && stage.needsEngine) {
        this.save(productId, stage.name, 'skipped', `Skipped: ${skipReason}`)
        continue
      }
      setStage(stage.name)
      const inputHash = hashJson(stage.inputs(ctx))
      const previous = stored.get(stage.name)
      if (previous?.status === 'done' && previous.outputJson && (JSON.parse(previous.outputJson) as Envelope).inputHash === inputHash) {
        this.save(productId, stage.name, 'done', previous.detail)
        continue
      }
      this.save(productId, stage.name, 'running', stage.startMessage)
      try {
        const result = await stage.run(ctx)
        if (signal.aborted) throw new AiError('cancelled', 'stopped')
        let detail = result.detail
        tx(this.core.db, () => {
          const extra = result.commit?.()
          if (extra && extra.detail) detail = extra.detail
          const envelope: Envelope = { inputHash, data: result.data }
          this.save(productId, stage.name, result.status, detail, JSON.stringify(envelope))
        })
      } catch (error) {
        if (signal.aborted) {
          this.save(productId, stage.name, 'pending', 'Stopped before it finished; it runs again on resume.')
          return this.paused()
        }
        const message = describeStageError(error)
        this.save(productId, stage.name, 'failed', message, null)
        this.core.log.warn('passports', `Analysis stage "${stage.name}" failed: ${message}`)
        if (error instanceof AiError && error.kind === 'unavailable') skipReason = 'the AI engine is not available.'
        if (stage.name === 'synthesize') skipReason ??= 'there is no passport draft to check yet.'
      }
    }
    return this.finished(productId)
  }

  private paused(): Outcome {
    return { status: 'paused', run: { status: 'suspended', summary: 'Analysis stopped by the user. Finished stages are kept; resume to continue.' } }
  }

  private finished(productId: Id): Outcome {
    const rows = new Map(this.store.stageRows(productId).map((r) => [r.name, r]))
    const status = (name: AnalysisStageName): string => rows.get(name)?.status ?? 'pending'
    if (status('synthesize') === 'done' && ['done', 'skipped'].includes(status('find_contradictions'))) {
      const count = this.versions.working(productId).claims.length
      const note = ['read_site', 'analyze_documents', 'scan_code'].some((n) => status(n as AnalysisStageName) === 'failed') ? ' Some sources could not be read; see the stages.' : ''
      return { status: 'complete', run: { status: 'ok', summary: `Analysis complete: ${count} claim${count === 1 ? '' : 's'} in the passport for review.${note}` } }
    }
    const failed = STAGE_ORDER.find((n) => status(n) === 'failed')
    const detail = failed ? (rows.get(failed)?.detail ?? '') : 'The analysis did not finish.'
    return { status: 'failed', run: { status: 'failed', summary: `Analysis stopped at "${failed ?? 'unknown'}": ${detail}` } }
  }
}
