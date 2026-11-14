// SQL for products, sources and analysis stages. Passport versions and claims live in claims-repo.ts.

import { ApiError } from '../../shared/api'
import type {
  AnalysisStage,
  AnalysisStageName,
  AnalysisStageStatus,
  AnalysisStatus,
  Id,
  Product,
  ProductSource,
  PromotionGoal,
  PromotionGoalInput,
  SourceScope
} from '../../shared/types'
import { newId, parseJson, toJson, type Db } from '../db/database'
import type { Clock } from '../ports'
import { mapProduct } from '../repos'

type Row = Record<string, unknown>

export const STAGE_ORDER: AnalysisStageName[] = ['read_site', 'analyze_documents', 'scan_code', 'synthesize', 'find_contradictions']

export interface StageRow {
  name: AnalysisStageName
  status: AnalysisStageStatus
  detail: string
  /** JSON envelope written by the analysis runner: { inputHash, data }. */
  outputJson: string | null
  updatedAt: string
}

const mapSource = (r: Row): ProductSource => ({
  id: r.id as string,
  productId: r.product_id as string,
  kind: r.kind as ProductSource['kind'],
  ref: r.ref as string,
  label: r.label as string,
  scope: parseJson<SourceScope | null>(r.scope_json as string | null, null),
  addedAt: r.added_at as string
})

export class ProductStore {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock
  ) {}

  now(): string {
    return this.clock.now().toISOString()
  }

  // ───────────── products ─────────────

  product(id: Id): Product {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new ApiError('not_found', 'This product no longer exists.')
    return mapProduct(row)
  }

  list(): Product[] {
    return (this.db.prepare('SELECT * FROM products ORDER BY created_at, rowid').all() as Row[]).map(mapProduct)
  }

  insert(input: { name: string; websiteUrl: string | null; description: string | null }): Product {
    const id = newId()
    const now = this.now()
    this.db
      .prepare('INSERT INTO products (id, name, website_url, description, analysis_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.name, input.websiteUrl, input.description, 'idle', now, now)
    return this.product(id)
  }

  update(id: Id, patch: { name?: string; websiteUrl?: string | null; description?: string | null }): Product {
    const current = this.product(id)
    this.db
      .prepare('UPDATE products SET name = ?, website_url = ?, description = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name ?? current.name,
        patch.websiteUrl === undefined ? current.websiteUrl : patch.websiteUrl,
        patch.description === undefined ? current.description : patch.description,
        this.now(),
        id
      )
    return this.product(id)
  }

  /** Adds a goal (no id) or replaces the goal with that id, keeping its place in the list. */
  saveGoal(id: Id, input: PromotionGoalInput): Product {
    const goals = [...this.product(id).goals]
    if (input.id === undefined) {
      goals.push({ ...input, id: newId() })
    } else {
      const at = goals.findIndex((g) => g.id === input.id)
      if (at < 0) throw new ApiError('not_found', 'This goal no longer exists.')
      goals[at] = { ...input, id: input.id }
    }
    return this.writeGoals(id, goals)
  }

  removeGoal(id: Id, goalId: Id): Product {
    const goals = this.product(id).goals
    if (!goals.some((g) => g.id === goalId)) throw new ApiError('not_found', 'This goal no longer exists.')
    return this.writeGoals(id, goals.filter((g) => g.id !== goalId))
  }

  private writeGoals(id: Id, goals: PromotionGoal[]): Product {
    this.db.prepare('UPDATE products SET goals_json = ?, updated_at = ? WHERE id = ?').run(toJson(goals), this.now(), id)
    return this.product(id)
  }

  setAnalysisStatus(id: Id, status: AnalysisStatus): void {
    this.db.prepare('UPDATE products SET analysis_status = ?, updated_at = ? WHERE id = ?').run(status, this.now(), id)
  }

  setActiveVersion(id: Id, versionId: Id | null): void {
    this.db.prepare('UPDATE products SET active_passport_version_id = ?, updated_at = ? WHERE id = ?').run(versionId, this.now(), id)
  }

  remove(id: Id): void {
    this.db.prepare('DELETE FROM products WHERE id = ?').run(id)
  }

  /** Counts of records elsewhere that make deleting the product destructive. */
  dependents(id: Id): { channels: number; sendActions: number } {
    const channels = (this.db.prepare('SELECT COUNT(*) AS n FROM channels WHERE product_id = ?').get(id) as { n: number }).n
    const sendActions = (
      this.db.prepare('SELECT COUNT(*) AS n FROM send_actions WHERE opportunity_id IN (SELECT id FROM opportunities WHERE product_id = ?)').get(id) as { n: number }
    ).n
    return { channels, sendActions }
  }

  /** After a restart no analysis can still be running: park interrupted work so it can be resumed. */
  recoverInterrupted(): number {
    this.db.prepare("UPDATE analysis_stages SET status = 'pending', detail = 'Interrupted by application stop; will restart on resume' WHERE status = 'running'").run()
    return this.db.prepare("UPDATE products SET analysis_status = 'paused' WHERE analysis_status = 'running'").run().changes
  }

  // ───────────── sources ─────────────

  sources(productId: Id): ProductSource[] {
    return (this.db.prepare('SELECT * FROM product_sources WHERE product_id = ? ORDER BY added_at, rowid').all(productId) as Row[]).map(mapSource)
  }

  source(id: Id): ProductSource {
    const row = this.db.prepare('SELECT * FROM product_sources WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new ApiError('not_found', 'This source no longer exists.')
    return mapSource(row)
  }

  insertSource(input: { productId: Id; kind: ProductSource['kind']; ref: string; label: string; scope: SourceScope | null }): ProductSource {
    const id = newId()
    this.db
      .prepare('INSERT INTO product_sources (id, product_id, kind, ref, label, scope_json, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.productId, input.kind, input.ref, input.label, input.scope ? toJson(input.scope) : null, this.now())
    return this.source(id)
  }

  /** Changes what a source points at; the id and the date it was added stay. The scope changes only when one is given. */
  updateSource(id: Id, patch: { ref: string; label: string; scope?: SourceScope | null }): void {
    if (patch.scope === undefined) {
      this.db.prepare('UPDATE product_sources SET ref = ?, label = ? WHERE id = ?').run(patch.ref, patch.label, id)
    } else {
      this.db.prepare('UPDATE product_sources SET ref = ?, label = ?, scope_json = ? WHERE id = ?').run(patch.ref, patch.label, patch.scope ? toJson(patch.scope) : null, id)
    }
  }

  removeSource(id: Id): void {
    this.db.prepare('DELETE FROM product_sources WHERE id = ?').run(id)
  }

  // ───────────── analysis stages ─────────────

  stageRows(productId: Id): StageRow[] {
    const rows = this.db.prepare('SELECT * FROM analysis_stages WHERE product_id = ?').all(productId) as Row[]
    return rows
      .map((r) => ({
        name: r.name as AnalysisStageName,
        status: r.status as AnalysisStageStatus,
        detail: r.detail as string,
        outputJson: (r.output_json as string | null) ?? null,
        updatedAt: r.updated_at as string
      }))
      .sort((a, b) => STAGE_ORDER.indexOf(a.name) - STAGE_ORDER.indexOf(b.name))
  }

  saveStage(productId: Id, name: AnalysisStageName, status: AnalysisStageStatus, detail: string, outputJson?: string | null): AnalysisStage {
    const now = this.now()
    // A stage keeps its previous output unless a new one (or an explicit null) is given.
    this.db
      .prepare(
        `INSERT INTO analysis_stages (product_id, name, status, detail, output_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_id, name) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = excluded.updated_at,
           output_json = CASE WHEN ? THEN excluded.output_json ELSE analysis_stages.output_json END`
      )
      .run(productId, name, status, detail, outputJson ?? null, now, outputJson === undefined ? 0 : 1)
    return { productId, name, status, detail, updatedAt: now }
  }

  clearStages(productId: Id): void {
    this.db.prepare('DELETE FROM analysis_stages WHERE product_id = ?').run(productId)
  }

  /** The five stages in order, with 'pending' placeholders for stages that have not started. */
  stages(productId: Id): AnalysisStage[] {
    const rows = new Map(this.stageRows(productId).map((r) => [r.name, r]))
    const now = this.now()
    return STAGE_ORDER.map((name) => {
      const row = rows.get(name)
      return row
        ? { productId, name, status: row.status, detail: row.detail, updatedAt: row.updatedAt }
        : { productId, name, status: 'pending' as const, detail: '', updatedAt: now }
    })
  }
}
