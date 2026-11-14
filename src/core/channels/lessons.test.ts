// The rules the AI keeps (lessons): a rule is saved once per platform, however it is written and wherever it comes from (BUG-053).

import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api'
import { FakeConnector } from '../testing/fake-connector'
import { makeTestCore } from '../testing/fakes'
import { LessonService } from './lessons'

function makeLessons() {
  const { core } = makeTestCore({ connectors: [new FakeConnector(), new FakeConnector({ id: 'other', platform: 'other' })] })
  return { core, lessons: new LessonService(core) }
}

const RULE = 'Reply briefly and without advertising'

/** What a refused call throws: the code and the sentence the owner reads beside the field. */
function refusal(fn: () => unknown): { code: string; message: string } {
  try {
    fn()
  } catch (error) {
    if (error instanceof ApiError) return { code: error.code, message: error.message }
    throw error
  }
  throw new Error('expected the call to be refused')
}

describe('adding a rule of your own', () => {
  it('refuses a rule that is already saved for the same platform, and keeps one row', () => {
    const { lessons } = makeLessons()
    lessons.add({ rule: RULE, platform: 'fake' })
    expect(refusal(() => lessons.add({ rule: RULE, platform: 'fake' }))).toEqual({ code: 'duplicate', message: 'This rule is already saved.' })
    expect(lessons.list()).toHaveLength(1)
  })

  it('refuses the same rule for all platforms twice', () => {
    const { lessons } = makeLessons()
    lessons.add({ rule: RULE })
    expect(refusal(() => lessons.add({ rule: RULE, platform: null })).code).toBe('duplicate')
    expect(refusal(() => lessons.add({ rule: RULE, platform: '' })).code).toBe('duplicate')
    expect(lessons.list()).toHaveLength(1)
  })

  it('tells a duplicate in any letter case or spacing', () => {
    const { lessons } = makeLessons()
    lessons.add({ rule: RULE, platform: 'fake' })
    expect(refusal(() => lessons.add({ rule: RULE.toUpperCase(), platform: 'fake' })).code).toBe('duplicate')
    expect(refusal(() => lessons.add({ rule: `  ${RULE.replace(/ /g, '   ')}  `, platform: 'fake' })).code).toBe('duplicate')
    expect(lessons.list()).toHaveLength(1)
  })

  it('accepts the same words for another platform, and for all platforms', () => {
    const { lessons } = makeLessons()
    lessons.add({ rule: RULE, platform: 'fake' })
    lessons.add({ rule: RULE, platform: 'other' })
    lessons.add({ rule: RULE })
    expect(lessons.list().map((l) => l.platform ?? 'all').sort()).toEqual(['all', 'fake', 'other'])
  })

  it('refuses a rule that is saved but switched off, because it is saved', () => {
    const { lessons } = makeLessons()
    const saved = lessons.add({ rule: RULE, platform: 'fake' })
    lessons.save({ id: saved.id, enabled: false })
    expect(refusal(() => lessons.add({ rule: RULE, platform: 'fake' })).code).toBe('duplicate')
  })
})

describe('editing a saved rule', () => {
  it('refuses to turn a rule into one that is already saved', () => {
    const { lessons } = makeLessons()
    lessons.add({ rule: RULE, platform: 'fake' })
    const second = lessons.add({ rule: 'Compress the picture first', platform: 'fake' })
    expect(refusal(() => lessons.save({ id: second.id, rule: RULE.toUpperCase() }))).toEqual({ code: 'duplicate', message: 'This rule is already saved.' })
    expect(lessons.get(second.id).rule).toBe('Compress the picture first')
  })

  it('refuses to move a rule to a platform where its words are already saved', () => {
    const { lessons } = makeLessons()
    lessons.add({ rule: RULE, platform: 'other' })
    const mine = lessons.add({ rule: RULE, platform: 'fake' })
    expect(refusal(() => lessons.save({ id: mine.id, platform: 'other' })).code).toBe('duplicate')
    expect(lessons.get(mine.id).platform).toBe('fake')
  })

  it('still saves a rule under its own words, and switches it on and off', () => {
    const { lessons } = makeLessons()
    const mine = lessons.add({ rule: RULE, platform: 'fake' })
    expect(lessons.save({ id: mine.id, rule: RULE.toUpperCase() }).rule).toBe(RULE.toUpperCase())
    expect(lessons.save({ id: mine.id, rule: RULE.toUpperCase(), platform: 'fake' }).platform).toBe('fake')
    expect(lessons.save({ id: mine.id, enabled: false }).enabled).toBe(false)
    expect(lessons.save({ id: mine.id, enabled: true }).enabled).toBe(true)
  })

  it('lets a rule that is already stored twice be switched off and removed', () => {
    const { core, lessons } = makeLessons()
    // A duplicate saved before the check existed stays on the list: it must not trap its owner, who can still switch it off or remove it.
    const first = lessons.add({ rule: RULE, platform: 'fake' })
    core.db
      .prepare("INSERT INTO agent_lessons (id, platform, rule, question, answer, enabled, uses, created_at) SELECT 'twin', platform, rule, question, answer, enabled, uses, created_at FROM agent_lessons WHERE id = ?")
      .run(first.id)
    expect(lessons.list()).toHaveLength(2)
    expect(lessons.save({ id: 'twin', enabled: false }).enabled).toBe(false)
    lessons.remove({ id: 'twin' })
    expect(lessons.list().map((l) => l.id)).toEqual([first.id])
  })
})

describe('a rule the AI kept from an answer', () => {
  it('is still stored once, and an earlier copy that was switched off is switched on again', () => {
    const { lessons } = makeLessons()
    const saved = lessons.add({ rule: RULE, platform: 'fake' })
    lessons.save({ id: saved.id, enabled: false })
    const again = lessons.remember({ platform: 'fake', rule: RULE.toUpperCase(), question: 'Which tone?', answer: 'Brief' })
    expect(again.known).toBe(true)
    expect(again.lesson.id).toBe(saved.id)
    expect(again.lesson.enabled).toBe(true)
    expect(lessons.list()).toHaveLength(1)
  })
})
