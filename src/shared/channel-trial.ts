// A channel trial (DEC-058): before a channel takes the owner's weeks, it is written down what is expected of it, for how long, for how many
// hours, and which number means "keep". At the end the application shows that number against what was written; the owner gives the verdict.
import { likesWord, shortCount } from './post-numbers'
import type { WeekSend } from './weekly-review'

/** What a trial is judged by. `posts`: the owner's posts that stayed up. `own`: a number only the owner can see (sales in a shop, sign-ups), typed at the end. */
export type TrialMetric = 'likes' | 'comments' | 'views' | 'posts' | 'own'
export const TRIAL_METRICS: readonly TrialMetric[] = ['comments', 'likes', 'views', 'posts', 'own']
export const TRIAL_WEEKS: readonly number[] = [2, 3, 4, 6]
export const DEFAULT_TRIAL_WEEKS = 3
export const DEFAULT_TRIAL_HOURS = 2
/** "Extend" adds this many weeks. */
export const EXTEND_WEEKS = 2
const DAY_MS = 86_400_000

export interface ChannelTrial {
  id: string
  channelId: string
  hypothesis: string
  weeks: number
  hoursPerWeek: number
  metric: TrialMetric
  /** The owner's name for their own number ("sales in the shop"); only with `own`. */
  ownLabel: string | null
  threshold: number
  startedAt: string
  endsAt: string
  /** Null while the owner has not answered. */
  verdict: 'keep' | 'stop' | null
  decidedAt: string | null
  /** The owner's own number, typed with the verdict; only with `own`. */
  ownResult: number | null
  /** What the application measured when the verdict was given; null for a running trial and where nothing was shown. */
  finalMeasured: number | null
}

export interface TrialProgress {
  posts: number
  replies: number
  removed: number
  likes: number | null
  comments: number | null
  views: number | null
  /** The trial's own number so far; null when no site showed it (or the owner has not typed theirs). */
  measured: number | null
  /** Whether the threshold is reached; null while there is no number to compare. */
  met: boolean | null
  ended: boolean
  /** Whole days from the start, counted from 1, and the trial's length in days. */
  day: number
  days: number
}

/** The numbers of a trial from the channel's confirmed sends, as of `nowMs` (or of the verdict for a decided trial). */
export function trialProgress(trial: ChannelTrial, sends: readonly WeekSend[], nowMs: number): TrialProgress {
  const from = Date.parse(trial.startedAt)
  const to = Math.min(Date.parse(trial.decidedAt ?? trial.endsAt), Math.max(nowMs, from))
  const mine = sends.filter((s) => s.channelId === trial.channelId && s.sentAtMs >= from && s.sentAtMs <= Math.max(to, Date.parse(trial.endsAt)))
  const posts = mine.filter((s) => s.kind === 'post')
  const total = (key: 'likes' | 'comments' | 'views'): number | null => {
    const values = posts.map((p) => p.numbers?.[key]).filter((v): v is number => typeof v === 'number')
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
  }
  const sums = { likes: total('likes'), comments: total('comments'), views: total('views') }
  const standing = posts.filter((p) => !p.removed).length
  const measured = trial.metric === 'own' ? trial.ownResult : trial.metric === 'posts' ? standing : sums[trial.metric]
  const days = Math.max(1, Math.round((Date.parse(trial.endsAt) - from) / DAY_MS))
  return {
    posts: posts.length,
    replies: mine.length - posts.length,
    removed: mine.filter((s) => s.removed).length,
    ...sums,
    measured,
    met: measured === null ? null : measured >= trial.threshold,
    ended: nowMs >= Date.parse(trial.endsAt),
    day: Math.min(days, Math.max(1, Math.floor((nowMs - from) / DAY_MS) + 1)),
    days
  }
}

/** The name of what a trial is judged by, in the platform's words: "comments under your posts", "points on your posts". */
export function metricName(metric: TrialMetric, platform: string, ownLabel: string | null): string {
  switch (metric) {
    case 'likes':
      return `${likesWord(platform, 2)} on your posts`
    case 'comments':
      return 'comments under your posts'
    case 'views':
      return 'views of your posts'
    case 'posts':
      return 'posts of yours that stayed up'
    case 'own':
      return ownLabel?.trim() || 'your own number'
  }
}

/** "12 of 30 comments under your posts": the trial's number against what was written at its start. */
export function thresholdLine(trial: ChannelTrial, progress: TrialProgress, platform: string): string {
  const name = metricName(trial.metric, platform, trial.ownLabel)
  if (progress.measured === null) return trial.metric === 'own' ? `Keep at ${shortCount(trial.threshold)} ${name}; you type the number when you give the verdict` : `Keep at ${shortCount(trial.threshold)} ${name}; the site has shown none yet`
  return `${shortCount(progress.measured)} of ${shortCount(trial.threshold)} ${name}`
}

/** The metrics a channel can be judged by: what the application reads there, plus the two it never needs to read. */
export function metricsFor(readsNumbers: boolean): TrialMetric[] {
  return readsNumbers ? [...TRIAL_METRICS] : ['posts', 'own']
}
