import { describe, expect, it } from 'vitest'
import { metricName, metricsFor, thresholdLine, trialProgress, type ChannelTrial } from './channel-trial'
import type { WeekSend } from './weekly-review'

const DAY = 86_400_000
const start = Date.parse('2026-11-02T10:00:00.000Z')
const trial = (over: Partial<ChannelTrial> = {}): ChannelTrial => ({ id: 't', channelId: 'c', hypothesis: 'People here ask what charts mean.', weeks: 3, hoursPerWeek: 2, metric: 'comments', ownLabel: null, threshold: 30, startedAt: new Date(start).toISOString(), endsAt: new Date(start + 21 * DAY).toISOString(), verdict: null, decidedAt: null, ownResult: null, finalMeasured: null, ...over })
const send = (day: number, kind: 'post' | 'reply', numbers: WeekSend['numbers'] = null, removed = false, channelId = 'c'): WeekSend => ({ channelId, kind, sentAtMs: start + day * DAY, removed, numbers })

describe('a channel trial', () => {
  it('counts only the channel\'s sends inside the trial and compares the chosen number with the threshold', () => {
    const sends = [send(1, 'post', { likes: 10, comments: 12, views: null }), send(3, 'post', null, true), send(4, 'reply'), send(-2, 'post', { likes: 99, comments: 99, views: 9 }), send(2, 'post', { likes: 5, comments: 50, views: 1 }, false, 'other')]
    const progress = trialProgress(trial(), sends, start + 5 * DAY)
    expect(progress).toMatchObject({ posts: 2, replies: 1, removed: 1, likes: 10, comments: 12, views: null, measured: 12, met: false, ended: false, day: 6, days: 21 })
    expect(thresholdLine(trial(), progress, 'reddit')).toBe('12 of 30 comments under your posts')
    expect(trialProgress(trial({ threshold: 12 }), sends, start + 30 * DAY)).toMatchObject({ met: true, ended: true, day: 21 })
  })

  it('never makes a zero of a number the site did not show, and judges posts by those that stayed up', () => {
    const sends = [send(1, 'post'), send(2, 'post', null, true)]
    expect(trialProgress(trial(), sends, start + 3 * DAY)).toMatchObject({ measured: null, met: null })
    expect(thresholdLine(trial(), trialProgress(trial(), sends, start + 3 * DAY), 'reddit')).toMatch(/the site has shown none yet/)
    expect(trialProgress(trial({ metric: 'posts', threshold: 1 }), sends, start + 3 * DAY)).toMatchObject({ measured: 1, met: true })
  })

  it('an own number is the owner\'s to type', () => {
    const own = trial({ metric: 'own', ownLabel: 'sales in the shop', threshold: 3 })
    expect(trialProgress(own, [], start + DAY)).toMatchObject({ measured: null, met: null })
    expect(thresholdLine(own, trialProgress(own, [], start + DAY), 'pinterest')).toBe('Keep at 3 sales in the shop; you type the number when you give the verdict')
    expect(trialProgress({ ...own, ownResult: 4 }, [], start + 22 * DAY)).toMatchObject({ measured: 4, met: true, ended: true })
  })

  it('names the number in the platform\'s words and offers only what the channel can be judged by', () => {
    expect(metricName('likes', 'reddit', null)).toBe('points on your posts')
    expect(metricName('own', 'x', '  ')).toBe('your own number')
    expect(metricsFor(false)).toEqual(['posts', 'own'])
    expect(metricsFor(true)).toContain('views')
  })
})
