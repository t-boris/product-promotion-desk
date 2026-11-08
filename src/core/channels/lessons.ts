// What the AI learned from the owner (lessons): a short rule kept from an answer ("compress a picture to under 500 KB before uploading it",
// "edit only the editable fields"). Every later mission on that platform gets the rules in its brief, so the owner is not asked the same
// thing twice. The AI proposes a rule after the owner's answer; the owner sees it, can undo it, and edits or deletes it in one list.

import { ApiError } from '../../shared/api'
import type { AgentLesson } from '../../shared/types'
import { newId } from '../db/database'
import type { Core } from '../core'
import { found, requireText } from './errors'
import { listPlatforms } from './platforms'

const MIN_RULE = 8
const MAX_RULE = 200
const MAX_SOURCE = 300
/** A mission is given at most this many rules: the most used first, then the newest. */
const MAX_PER_MISSION = 20

type Row = Record<string, unknown>

const mapLesson = (r: Row): AgentLesson => ({
  id: String(r.id),
  platform: (r.platform as string | null) ?? null,
  rule: String(r.rule),
  question: String(r.question),
  answer: String(r.answer),
  enabled: r.enabled === 1,
  uses: Number(r.uses),
  createdAt: String(r.created_at),
  lastUsedAt: (r.last_used_at as string | null) ?? null
})

export class LessonService {
  constructor(private readonly core: Core) {}

  list(): AgentLesson[] {
    return (this.core.db.prepare('SELECT * FROM agent_lessons ORDER BY created_at DESC, rowid DESC').all() as Row[]).map(mapLesson)
  }

  get(id: unknown): AgentLesson {
    return found(() => {
      const row = this.core.db.prepare('SELECT * FROM agent_lessons WHERE id = ?').get(requireText(id, 'The rule')) as Row | undefined
      if (!row) throw new Error('not found')
      return mapLesson(row)
    }, 'The rule')
  }

  /** A rule the owner writes himself. */
  add(args: { rule: string; platform?: string | null }): AgentLesson {
    return this.insert({ platform: this.knownPlatform(args.platform), rule: this.cleanRule(args.rule), question: '', answer: '' })
  }

  /** A rule the AI kept from an answer. A rule that is already known (same words, same platform) is not stored twice. */
  remember(args: { platform: string | null; rule: string; question: string; answer: string }): { lesson: AgentLesson; known: boolean } {
    const rule = this.cleanRule(args.rule)
    const same = this.list().find((l) => l.platform === args.platform && l.rule.toLowerCase() === rule.toLowerCase())
    if (same) {
      // The owner said it again: a rule that had been switched off is on again.
      if (!same.enabled) this.core.db.prepare('UPDATE agent_lessons SET enabled = 1 WHERE id = ?').run(same.id)
      return { lesson: this.get(same.id), known: true }
    }
    const lesson = this.insert({ platform: args.platform, rule, question: args.question.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE), answer: args.answer.replace(/\s+/g, ' ').trim().slice(0, MAX_SOURCE) })
    return { lesson, known: false }
  }

  save(args: { id: string; rule?: string; platform?: string | null; enabled?: boolean }): AgentLesson {
    const current = this.get(args.id)
    const rule = args.rule === undefined ? current.rule : this.cleanRule(args.rule)
    const platform = args.platform === undefined ? current.platform : this.knownPlatform(args.platform)
    const enabled = args.enabled === undefined ? current.enabled : args.enabled === true
    this.core.db.prepare('UPDATE agent_lessons SET rule = ?, platform = ?, enabled = ? WHERE id = ?').run(rule, platform, enabled ? 1 : 0, current.id)
    this.core.events.changed('settings')
    return this.get(current.id)
  }

  remove(args: { id: string }): void {
    const lesson = this.get(args.id)
    this.core.db.prepare('DELETE FROM agent_lessons WHERE id = ?').run(lesson.id)
    this.core.log.info('accounts', `A rule of the AI was removed: ${lesson.rule}`)
    this.core.events.changed('settings')
  }

  /** The rules a mission on this platform is given: those of the platform and the general ones. */
  forPlatform(platform: string): AgentLesson[] {
    return (
      this.core.db
        .prepare('SELECT * FROM agent_lessons WHERE enabled = 1 AND (platform IS NULL OR platform = ?) ORDER BY uses DESC, created_at DESC, rowid DESC LIMIT ?')
        .all(platform, MAX_PER_MISSION) as Row[]
    ).map(mapLesson)
  }

  /** Counts a mission that was given these rules. */
  markUsed(lessons: AgentLesson[]): void {
    if (lessons.length === 0) return
    const at = this.core.clock.now().toISOString()
    const update = this.core.db.prepare('UPDATE agent_lessons SET uses = uses + 1, last_used_at = ? WHERE id = ?')
    for (const lesson of lessons) update.run(at, lesson.id)
  }

  private insert(data: { platform: string | null; rule: string; question: string; answer: string }): AgentLesson {
    const id = newId()
    this.core.db
      .prepare('INSERT INTO agent_lessons (id, platform, rule, question, answer, enabled, uses, created_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?)')
      .run(id, data.platform, data.rule, data.question, data.answer, this.core.clock.now().toISOString())
    this.core.log.info('accounts', `The AI will remember${data.platform ? ` (${data.platform})` : ''}: ${data.rule}`)
    this.core.events.changed('settings')
    return this.get(id)
  }

  private cleanRule(rule: unknown): string {
    const text = typeof rule === 'string' ? rule.replace(/\s+/g, ' ').trim() : ''
    if (text.length < MIN_RULE) throw new ApiError('invalid_input', `A rule is a short sentence of at least ${MIN_RULE} characters.`)
    if (text.length > MAX_RULE) throw new ApiError('invalid_input', `A rule is at most ${MAX_RULE} characters; make it shorter.`)
    return text
  }

  private knownPlatform(platform: unknown): string | null {
    if (platform === undefined || platform === null || platform === '') return null
    const key = String(platform).trim().toLowerCase()
    const known = listPlatforms(this.core.connectors).map((p) => p.platform)
    if (!known.includes(key)) throw new ApiError('invalid_input', `Unknown platform "${key}". Available: ${known.join(', ') || 'none'}.`)
    return key
  }
}
