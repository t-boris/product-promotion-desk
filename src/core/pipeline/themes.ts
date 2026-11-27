// Themes (DEC-070): the owner's named stretches of days. While one runs, the AI's proposed posts are given its name and what it says; the
// recap is added up by the application from what went out in its days. Nothing here asks the AI, schedules or posts.
import { ApiError } from '../../shared/api'
import { endOfDay } from '../../shared/goal-target'
import { MAX_THEMES, MAX_THEME_MESSAGE, MAX_THEME_NAME, daysProblem, orderedThemes, startOfDay, themeState, type Theme, type ThemeRecap, type ThemeView } from '../../shared/post-themes'
import type { Id } from '../../shared/types'
import { oneLine, plainText } from '../assist/kit'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'
import { newId } from '../db/database'

type Row = Record<string, unknown>
const mapTheme = (r: Row): Theme => ({ id: r.id as string, productId: r.product_id as string, name: r.name as string, message: r.message as string, from: r.from_day as string, to: r.to_day as string })

function themesOf(core: Core, productId: Id): Theme[] {
  return (core.db.prepare('SELECT * FROM themes WHERE product_id = ?').all(productId) as Row[]).map(mapTheme)
}

/** The theme that runs now, as the AI's proposed posts are given it; the one that started first when two overlap. Null when none runs. */
export function themeInForce(core: Core, productId: Id): { name: string; message: string } | null {
  const now = core.clock.now().getTime()
  const running = themesOf(core, productId)
    .filter((t) => themeState(now, t.from, t.to) === 'running')
    .sort((a, b) => a.from.localeCompare(b.from))[0]
  return running ? { name: running.name, message: running.message } : null
}

export class Themes {
  constructor(private readonly core: Core) {}

  private recap(theme: Theme): ThemeRecap {
    const row = this.core.db
      .prepare(
        `SELECT COALESCE(SUM(o.kind = 'standalone'), 0) AS posts, COALESCE(SUM(o.kind <> 'standalone'), 0) AS replies, COALESCE(SUM(COALESCE(a.likes, 0)), 0) AS likes, COALESCE(SUM(COALESCE(a.comments, 0)), 0) AS comments
         FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id
         WHERE o.product_id = ? AND a.state = 'confirmed' AND a.completed_at >= ? AND a.completed_at < ?`
      )
      .get(theme.productId, new Date(startOfDay(theme.from)).toISOString(), new Date(endOfDay(theme.to)).toISOString()) as ThemeRecap
    return { posts: row.posts, replies: row.replies, likes: row.likes, comments: row.comments }
  }

  list(args: { productId: Id }): ThemeView[] {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const now = this.core.clock.now().getTime()
    return orderedThemes(themesOf(this.core, product.id).map((theme) => ({ ...theme, state: themeState(now, theme.from, theme.to), recap: this.recap(theme) })))
  }

  /** Adds a theme (no id) or changes one. */
  save(args: { productId: Id; id?: Id | null; name: string; message?: string; from: string; to: string }): ThemeView[] {
    const product = found(() => this.core.repos.product(requireText(args.productId, 'The product')), 'The product')
    const name = oneLine(typeof args.name === 'string' ? args.name : '', MAX_THEME_NAME)
    if (name === '') throw new ApiError('invalid_input', 'Give the theme a name.')
    const message = typeof args.message === 'string' ? plainText(args.message, MAX_THEME_MESSAGE) : ''
    const problem = daysProblem(String(args.from ?? ''), String(args.to ?? ''))
    if (problem) throw new ApiError('invalid_input', problem)
    if (args.id) {
      const done = this.core.db.prepare('UPDATE themes SET name = ?, message = ?, from_day = ?, to_day = ? WHERE id = ? AND product_id = ?').run(name, message, args.from, args.to, args.id, product.id)
      if (done.changes === 0) throw new ApiError('not_found', 'That theme is not kept any more.')
    } else {
      const count = (this.core.db.prepare('SELECT COUNT(*) AS n FROM themes WHERE product_id = ?').get(product.id) as { n: number }).n
      if (count >= MAX_THEMES) throw new ApiError('invalid_state', `A product keeps at most ${MAX_THEMES} themes. Delete one first.`)
      this.core.db.prepare('INSERT INTO themes (id, product_id, name, message, from_day, to_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), product.id, name, message, args.from, args.to, this.core.clock.now().toISOString())
    }
    this.core.events.changed('products')
    return this.list({ productId: product.id })
  }

  remove(args: { id: Id }): { removed: true } {
    const done = this.core.db.prepare('DELETE FROM themes WHERE id = ?').run(requireText(args.id, 'The theme'))
    if (done.changes === 0) throw new ApiError('not_found', 'That theme is not kept any more.')
    this.core.events.changed('products')
    return { removed: true }
  }
}
