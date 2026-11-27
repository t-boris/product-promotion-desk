import { describe, expect, it } from 'vitest'
import type { AudienceWord } from '../shared/types'
import { answersComplete, emptyAnswers } from '../shared/positioning'
import { differs, formStart, saidIn, wordsOfKind } from '../renderer/src/pages/products/positioning-view'
import { positioningSummaryLine, setupSteps, wordsSummary, type SetupFacts } from '../renderer/src/pages/setup/setup-steps'

const answers = { alternatives: 'a', unique: 'b', value: 'c', audience: 'd', category: 'e' }
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ sources: 1, passportApproved: true, passport: { total: 1, approved: 1, proposed: 0 } as SetupFacts['passport'], analysis: 'complete', goals: 1, ...over })

describe('the positioning step', () => {
  it('starts the form from the waiting proposal, else from what is approved', () => {
    expect(formStart({ approved: answers, proposed: { ...answers, category: 'x' } }).category).toBe('x')
    expect(formStart({ approved: answers, proposed: null })).toEqual(answers)
    expect(formStart({ approved: null, proposed: null })).toEqual(emptyAnswers())
    expect(answersComplete({ ...answers, value: '  ' })).toBe(false)
    expect(differs(answers, answers)).toBe(false)
    expect(differs({ ...answers, unique: 'new' }, answers)).toBe(true)
    expect(differs(answers, null)).toBe(true)
  })

  it('says where it stands in one line and is never the path\'s next step', () => {
    expect(positioningSummaryLine('proposed')).toEqual({ text: 'A proposal to review', tone: 'warn' })
    expect(positioningSummaryLine('approved').text).toBe('Approved')
    const steps = setupSteps([], facts({ positioning: 'approved', words: 3 }))
    expect(steps.find((s) => s.id === 'positioning')).toMatchObject({ state: 'done', summary: 'Approved' })
    expect(steps.find((s) => s.id === 'words')).toMatchObject({ state: 'done', summary: '3 entries' })
    expect(setupSteps([], facts()).filter((s) => s.id === 'positioning' || s.id === 'words').map((s) => s.state)).toEqual(['todo', 'todo'])
    expect(wordsSummary(1)).toBe('1 entry')
  })
})

describe('the audience\'s words', () => {
  const word = (id: string, kind: AudienceWord['kind']): AudienceWord => ({ id, kind, text: id, posts: [], repeated: false, createdAt: '2026-11-27T00:00:00.000Z' })
  it('filters by kind and counts the posts in words', () => {
    const entries = [word('a', 'question'), word('b', 'phrase'), word('c', 'question')]
    expect(wordsOfKind(entries, 'question').map((e) => e.id)).toEqual(['a', 'c'])
    expect(wordsOfKind(entries, null)).toHaveLength(3)
    expect(saidIn(1)).toBe('Said in 1 post')
    expect(saidIn(3)).toBe('Said in 3 posts')
  })
})

describe('campaign days on the calendar', () => {
  it('name the first and the last day beside the dates already there', async () => {
    const { withCampaignDays } = await import('../renderer/src/pages/posts/dates-ahead')
    const days = withCampaignDays(new Map([['2026-12-01', ['New Moon']]]), [{ name: 'First steps', from: '2026-12-01', to: '2026-12-07' }, { name: 'One day', from: '2026-12-03', to: '2026-12-03' }])
    expect(days.get('2026-12-01')).toEqual(['New Moon', 'First steps starts'])
    expect(days.get('2026-12-07')).toEqual(['First steps ends'])
    expect(days.get('2026-12-03')).toEqual(['One day'])
  })
})
