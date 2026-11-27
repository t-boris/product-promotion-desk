import { describe, expect, it } from 'vitest'
import { daysProblem, orderedThemes, recapLine, startOfDay, themeState } from './post-themes'

describe('themes: the plain rules', () => {
  it('know when a theme is ahead, running and over, by the local days', () => {
    const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime()
    expect(startOfDay('2026-12-01')).toBe(new Date(2026, 11, 1).getTime())
    expect(themeState(at(2026, 11, 30), '2026-12-01', '2026-12-07')).toBe('ahead')
    expect(themeState(at(2026, 12, 1, 0), '2026-12-01', '2026-12-07')).toBe('running')
    expect(themeState(at(2026, 12, 7, 23), '2026-12-01', '2026-12-07')).toBe('running')
    expect(themeState(at(2026, 12, 8, 0), '2026-12-01', '2026-12-07')).toBe('over')
  })

  it('refuse days that are not a stretch, and order the themes by what matters now', () => {
    expect(daysProblem('2026-12-01', '2026-12-07')).toBeNull()
    expect(daysProblem('2026-12-07', '2026-12-01')).toContain('before the first')
    expect(daysProblem('2026-12-01', '')).toContain('Choose')
    expect(daysProblem('2026-01-01', '2026-06-01')).toContain('at most')
    const t = (id: string, state: 'ahead' | 'running' | 'over', from: string, to: string) => ({ id, state, from, to })
    expect(orderedThemes([t('old', 'over', '2026-10-01', '2026-10-07'), t('far', 'ahead', '2027-01-01', '2027-01-07'), t('now', 'running', '2026-11-20', '2026-11-30'), t('near', 'ahead', '2026-12-01', '2026-12-07'), t('recent', 'over', '2026-11-01', '2026-11-07')]).map((x) => x.id)).toEqual(['now', 'near', 'far', 'recent', 'old'])
    expect(recapLine({ posts: 0, replies: 0, likes: 0, comments: 0 })).toBe('nothing sent in its days')
    expect(recapLine({ posts: 1, replies: 5, likes: 40, comments: 1 })).toBe('1 post and 5 replies sent · 40 points and likes · 1 comment')
  })
})
