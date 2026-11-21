// What the card of the analysis of the Feed says. The card itself is the screen; its words and its filter are plain functions.

import { describe, expect, it } from 'vitest'
import type { FeedAnalysisView, FeedTheme } from '../shared/types'
import { barPercent, basisLine, focusLine, introWords, periodWords, rowsOfFocus, themeBadges, themeNumbers } from '../renderer/src/pages/feed/analysis-card'
import type { FindingRow } from '../renderer/src/pages/feed/finding-rows'

const theme = (over: Partial<FeedTheme> = {}): FeedTheme => ({
  id: 't1',
  name: 'What the houses mean',
  summary: 'People ask.',
  idea: 'An explainer.',
  postIds: ['a', 'b', 'c'],
  posts: 3,
  before: 1,
  replies: 42,
  score: 1300,
  known: 3,
  mostAnswered: false,
  mostPopular: false,
  growing: false,
  fading: false,
  ...over
})

describe('themeNumbers', () => {
  it('says the posts against the period before, the comments and the score', () => {
    expect(themeNumbers(theme())).toBe('3 posts (+2 against before) · 42 comments · score 1,300')
    expect(themeNumbers(theme({ posts: 2, before: 5 }))).toBe('2 posts (−3 against before) · 42 comments · score 1,300')
    expect(themeNumbers(theme({ posts: 1, before: 1, replies: 1 }))).toBe('1 post (as before) · 1 comment · score 1,300')
  })

  it('calls a theme with nothing before new, and writes no number a site did not show', () => {
    expect(themeNumbers(theme({ before: 0, replies: null, score: null }))).toBe('3 posts (new)')
    expect(themeNumbers(theme({ replies: 0, score: null }))).toBe('3 posts (+2 against before) · 0 comments')
  })

  it('only counts the posts when there is no period before to compare with', () => {
    expect(themeNumbers(theme({ before: 0 }), false)).toBe('3 posts · 42 comments · score 1,300')
    expect(themeNumbers(theme({ before: 0, replies: null, score: null }), false)).toBe('3 posts')
  })

  it('says when a theme has no posts this period but had some before', () => {
    expect(themeNumbers(theme({ posts: 0, before: 4, replies: null, score: null }))).toBe('0 posts (−4 against before)')
  })
})

describe('numbers that cover only some of a theme\'s posts', () => {
  it('say how many posts they cover, only when it is some of them', () => {
    expect(themeNumbers(theme({ known: 2 }))).toBe('3 posts (+2 against before) · 42 comments · score 1,300 · known for 2 of 3 posts')
    expect(themeNumbers(theme({ known: 3 }))).not.toContain('known for')
    expect(themeNumbers(theme({ known: 0, replies: null, score: null }))).not.toContain('known for')
  })
})

describe('themeBadges', () => {
  it('lists what stands out, in a fixed order', () => {
    expect(themeBadges(theme())).toEqual([])
    expect(themeBadges(theme({ mostAnswered: true, mostPopular: true, growing: true }))).toEqual([
      { label: 'Most answered', tone: 'info' },
      { label: 'Most popular', tone: 'info' },
      { label: 'Growing', tone: 'good' }
    ])
    expect(themeBadges(theme({ fading: true }))).toEqual([{ label: 'Fading', tone: 'warn' }])
  })
})

describe('barPercent', () => {
  it('is relative to the widest theme, with a sliver for a small one and nothing for none', () => {
    expect(barPercent(10, 10)).toBe(100)
    expect(barPercent(5, 10)).toBe(50)
    expect(barPercent(1, 100)).toBe(4)
    expect(barPercent(0, 10)).toBe(0)
    expect(barPercent(3, 0)).toBe(0)
  })
})

describe('basisLine and the words of the card', () => {
  const view = (over: Partial<FeedAnalysisView> = {}): Pick<FeedAnalysisView, 'posts' | 'readInFull' | 'total' | 'other'> => ({ posts: 62, readInFull: 5, total: 62, other: 0, ...over })

  it('says what the analysis was made from', () => {
    expect(basisLine(view())).toBe('62 posts analyzed · 5 read in full')
    expect(basisLine(view({ readInFull: 0, other: 7 }))).toBe('62 posts analyzed · none read in full · 7 fit no theme')
    expect(basisLine(view({ posts: 80, total: 120 }))).toBe('the newest 80 of 120 posts analyzed · 5 read in full')
  })

  it('names the period in words', () => {
    expect(periodWords(1)).toBe('the last 24 hours')
    expect(periodWords(7)).toBe('the last 7 days')
    expect(introWords(30)).toMatch(/last 30 days.*uses no browser and posts nothing/)
  })
})

describe('rowsOfFocus', () => {
  const rows = ['a', 'b', 'c'].map((id) => ({ id }) as FindingRow)

  it('keeps the posts of the opened theme, in the order given, and every row when none is opened', () => {
    expect(rowsOfFocus(rows, { ids: new Set(['c', 'a']) }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(rowsOfFocus(rows, null).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(rowsOfFocus(rows, { ids: new Set() })).toEqual([])
  })

  it('says how many of the theme\'s posts the list holds', () => {
    expect(focusLine('Houses', 3, 3)).toBe('Showing 3 posts of “Houses”.')
    expect(focusLine('Houses', 1, 1)).toBe('Showing 1 post of “Houses”.')
    expect(focusLine('Houses', 2, 5)).toBe('Showing 2 of the 5 posts of “Houses” (the rest are not in this list).')
  })
})
