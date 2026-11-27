import { describe, expect, it } from 'vitest'
import type { WeeklyReviewView } from '../shared/types'
import type { UsualSums, WeekSums } from '../shared/weekly-review'
import { channelCell, channelColumns, followedText, knownNote, likesHeading, totals } from '../renderer/src/pages/weekly/weekly-view'

const sums = (over: Partial<WeekSums> = {}): WeekSums => ({ posts: 0, replies: 0, removed: 0, likes: null, comments: null, views: null, read: 0, ...over })
const usual = (over: Partial<UsualSums> = {}): UsualSums => ({ posts: null, replies: null, likes: null, comments: null, views: null, removed: null, ...over })
const view = (week: WeekSums, u: UsualSums, platforms: string[] = ['reddit']): WeeklyReviewView => ({
  productId: 'p',
  week: '2026-11-23',
  label: 'Nov 23 – Nov 29',
  ended: true,
  numbers: { week, before: sums(), usual: u, channels: platforms.map((_, i) => ({ channelId: `c${i}`, week, usual: u })) },
  channels: Object.fromEntries(platforms.map((platform, i) => [`c${i}`, { target: `t${i}`, platform }])),
  posts: [],
  tooFew: false,
  words: null,
  change: null,
  earlier: [],
  previousWeek: '2026-11-16',
  nextWeek: null
})

describe('the weekly review page', () => {
  it('shows a total only where a site showed the number, with its usual and whether it stands above or below', () => {
    const figures = totals(view(sums({ posts: 5, replies: 12, likes: 84, comments: 23, removed: 2, read: 4 }), usual({ posts: 3, replies: 9.3, likes: 51, comments: 22, removed: 0 })))
    expect(figures.map((f) => [f.label, f.value, f.beside, f.tone])).toEqual([
      ['Posts sent', '5', 'usual 3', null],
      ['Replies sent', '12', 'usual 9.3', null],
      ['Points', '84', 'usual 51', 'good'],
      ['Comments received', '23', 'usual 22', null],
      ['Taken down', '2', 'usual 0', 'bad']
    ])
    expect(totals(view(sums({ posts: 1 }), usual())).map((f) => f.label)).toEqual(['Posts sent', 'Replies sent'])
  })

  it('names likes in the platform\'s word, or plainly across platforms', () => {
    expect(likesHeading(['reddit', 'reddit'])).toBe('Points')
    expect(likesHeading(['instagram'])).toBe('Likes')
    expect(likesHeading(['reddit', 'telegram'])).toBe('Points and likes')
    expect(likesHeading([])).toBe('Likes')
  })

  it('says for how many posts the numbers are known', () => {
    expect(knownNote(sums({ posts: 5, read: 5 }))).toBeNull()
    expect(knownNote(sums({ posts: 5, read: 4 }))).toMatch(/known for 4 of 5 posts/)
    expect(knownNote(sums({ posts: 2, read: 0 }))).toMatch(/showed no numbers/)
    expect(knownNote(sums())).toBeNull()
  })

  it('draws a channel column only when some channel has the number', () => {
    expect(channelColumns(view(sums({ likes: 3 }), usual({ comments: 2 })))).toEqual(['likes', 'comments'])
    expect(channelCell(10, 22)).toEqual({ value: '10', beside: 'usual 22', tone: 'bad' })
    expect(channelCell(null, null)).toEqual({ value: '—', beside: '', tone: null })
  })

  it('says what followed an accepted change in the numbers both weeks have', () => {
    expect(followedText({ from: sums({ posts: 2, likes: 14, comments: 3 }), to: sums({ posts: 3, likes: 23 }) }, 'accepted')).toBe('Posts 2 → 3 · likes 14 → 23')
    expect(followedText(null, 'accepted')).toBe('The week after is not over yet')
    expect(followedText(null, 'declined')).toBe('')
  })
})
