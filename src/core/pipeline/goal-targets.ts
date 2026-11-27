// A goal's number and date (DEC-067). The owner picks a count the application makes itself, a number and a day; the application shows how far
// it is. Nothing here asks the AI, and nothing here knows visits or sales: the application has no access to the owner's site.
import { ApiError } from '../../shared/api'
import { GOAL_MEASURES, MAX_GOAL_NUMBER, daysLeft, endOfDay, goalState, isDay, type GoalMeasure, type GoalProgress, type GoalTarget } from '../../shared/goal-target'
import type { Id } from '../../shared/types'
import { found, requireText } from '../channels/errors'
import { localDay } from '../../shared/seasonal'
import type { Core } from '../core'
import { SiteVisits } from './site-visits'

type Row = Record<string, unknown>
const mapTarget = (r: Row): GoalTarget => ({ goalId: r.goal_id as string, measure: r.measure as GoalMeasure, number: r.number as number, by: r.by_day as string, since: r.since_at as string })

export class GoalTargets {
  constructor(private readonly core: Core) {}

  /** Visitors asked from the analytics service not more often than once an hour per goal and range. */
  private readonly visitsCache = new Map<string, { at: number; count: number }>()

  private async visits(productId: Id, goalId: Id, since: string, until: string): Promise<{ count: number; problem?: string }> {
    const service = this.core.services.visits
    const from = localDay(Date.parse(since))
    const to = localDay(Date.parse(until) - 1)
    const key = `${goalId}|${from}|${to}`
    const now = this.core.clock.now().getTime()
    const kept = this.visitsCache.get(key)
    if (kept && now - kept.at < 3_600_000) return { count: kept.count }
    if (!service) return { count: kept?.count ?? 0, problem: 'Site visits are not connected for this product.' }
    try {
      const count = await service.visitorsBetween(productId, from, to)
      this.visitsCache.set(key, { at: now, count })
      return { count }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      return { count: kept?.count ?? 0, problem: error.message }
    }
  }

  private count(productId: Id, measure: Exclude<GoalMeasure, 'visits'>, since: string, until: string): number {
    const db = this.core.db
    if (measure === 'people') return (db.prepare('SELECT COUNT(*) AS n FROM people WHERE product_id = ? AND created_at >= ? AND created_at < ?').get(productId, since, until) as { n: number }).n
    const what =
      measure === 'posts' ? "SUM(o.kind = 'standalone')" : measure === 'replies' ? "SUM(o.kind <> 'standalone')" : measure === 'likes' ? 'SUM(COALESCE(a.likes, 0))' : 'SUM(COALESCE(a.comments, 0))'
    const row = db
      .prepare(
        `SELECT COALESCE(${what}, 0) AS n FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id
         WHERE o.product_id = ? AND a.state = 'confirmed' AND a.completed_at >= ? AND a.completed_at < ?`
      )
      .get(productId, since, until) as { n: number }
    return row.n
  }

  /** The targets of a product's goals with how far each is; a target whose goal is gone is dropped. */
  async progress(args: { productId: Id }): Promise<GoalProgress[]> {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const known = new Set(product.goals.map((g) => g.id))
    const rows = (this.core.db.prepare('SELECT * FROM goal_targets WHERE product_id = ?').all(product.id) as Row[]).map(mapTarget)
    const now = this.core.clock.now().getTime()
    const out: GoalProgress[] = []
    for (const target of rows) {
      if (!known.has(target.goalId)) {
        this.core.db.prepare('DELETE FROM goal_targets WHERE goal_id = ?').run(target.goalId)
        continue
      }
      const until = new Date(Math.min(now + 1, endOfDay(target.by))).toISOString()
      const { count, problem } = target.measure === 'visits' ? await this.visits(product.id, target.goalId, target.since, until) : { count: this.count(product.id, target.measure, target.since, until), problem: undefined }
      out.push({ ...target, count, state: goalState(count, target.number, now, target.by), daysLeft: daysLeft(now, target.by), ...(problem ? { problem } : {}) })
    }
    return out
  }

  /** Sets, changes or (with `target: null`) removes a goal's number and date. A changed measure starts the count over; a changed number or day does not. */
  async set(args: { productId: Id; goalId: Id; target: { measure: GoalMeasure; number: number; by: string } | null }): Promise<GoalProgress[]> {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const goalId = requireText(args.goalId, 'The goal')
    if (!product.goals.some((g) => g.id === goalId)) throw new ApiError('not_found', 'That goal is not kept any more.')
    if (args.target === null) {
      this.core.db.prepare('DELETE FROM goal_targets WHERE goal_id = ?').run(goalId)
    } else {
      const { measure, number, by } = args.target
      if (!GOAL_MEASURES.includes(measure)) throw new ApiError('invalid_input', 'Choose what to count.')
      if (measure === 'visits' && !new SiteVisits(this.core).view({ productId: product.id }).canRead) throw new ApiError('invalid_state', 'Visitors of the site can be a goal only when the product has analytics the application reads. Connect it first.')
      if (!Number.isInteger(number) || number < 1 || number > MAX_GOAL_NUMBER) throw new ApiError('invalid_input', 'The number must be a whole number, 1 or more.')
      if (typeof by !== 'string' || !isDay(by)) throw new ApiError('invalid_input', 'Choose the day it is due by.')
      const now = this.core.clock.now()
      if (endOfDay(by) <= now.getTime()) throw new ApiError('invalid_input', 'The day must be today or later.')
      const kept = this.core.db.prepare('SELECT measure, since_at FROM goal_targets WHERE goal_id = ?').get(goalId) as { measure: string; since_at: string } | undefined
      const since = kept && kept.measure === measure ? kept.since_at : now.toISOString()
      this.core.db
        .prepare(
          `INSERT INTO goal_targets (goal_id, product_id, measure, number, by_day, since_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(goal_id) DO UPDATE SET measure = excluded.measure, number = excluded.number, by_day = excluded.by_day, since_at = excluded.since_at`
        )
        .run(goalId, product.id, measure, number, by, since)
    }
    this.core.events.changed('products')
    return this.progress({ productId: product.id })
  }
}
