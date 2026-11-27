// Channel trials (DEC-058): what is expected of a channel, for how long, for how many hours a week and which number means "keep", written
// before the weeks are spent. The application counts that number from the channel's sends and from what the site showed under them; the owner
// gives the verdict: keep, stop (the channel is parked: paused, nothing is deleted) or extend. The AI may propose the trial's terms; it never
// starts one and never gives a verdict.
import { ApiError } from '../../shared/api'
import { DEFAULT_TRIAL_HOURS, DEFAULT_TRIAL_WEEKS, EXTEND_WEEKS, TRIAL_WEEKS, metricName, metricsFor, thresholdLine, trialProgress, type ChannelTrial, type TrialMetric } from '../../shared/channel-trial'
import { shortCount } from '../../shared/post-numbers'
import type { AttentionItem, Channel, Id, TrialProposal, TrialView } from '../../shared/types'
import type { WeekSend } from '../../shared/weekly-review'
import { readyEngine } from '../assist/gate'
import { appLanguageRule, askWithRepair, isRecord, oneLine, plainText, unsafe, type Parsed } from '../assist/kit'
import { found, requireText } from '../channels/errors'
import type { Core } from '../core'
import { newId } from '../db/database'
import { AiError, type AiTask } from '../ports'
import type { FlowStore } from './store'

const MAX_HYPOTHESIS = 400
const MAX_LABEL = 60
const DAY_MS = 86_400_000
export const PARKED_DETAIL = 'Parked after its trial'

type Row = Record<string, unknown>

const mapTrial = (r: Row): ChannelTrial => ({
  id: r.id as Id,
  channelId: r.channel_id as Id,
  hypothesis: r.hypothesis as string,
  weeks: r.weeks as number,
  hoursPerWeek: r.hours_per_week as number,
  metric: r.metric as TrialMetric,
  ownLabel: (r.own_label as string | null) ?? null,
  threshold: r.threshold as number,
  startedAt: r.started_at as string,
  endsAt: r.ends_at as string,
  verdict: (r.verdict as ChannelTrial['verdict']) ?? null,
  decidedAt: (r.decided_at as string | null) ?? null,
  ownResult: (r.own_result as number | null) ?? null,
  finalMeasured: (r.final_measured as number | null) ?? null
})

/** The confirmed sends of a channel from a moment on, as the trial counts them. */
export function sendsOfChannel(core: Core, channelId: Id, sinceIso: string): WeekSend[] {
  const rows = core.db
    .prepare(
      `SELECT a.completed_at, a.standing, a.likes, a.comments, a.views, a.numbers_read_at, o.kind FROM send_actions a JOIN opportunities o ON o.id = a.opportunity_id
       WHERE o.channel_id = ? AND a.state = 'confirmed' AND a.completed_at >= ? ORDER BY a.completed_at`
    )
    .all(channelId, sinceIso) as Row[]
  return rows.map((r) => ({
    channelId,
    kind: r.kind === 'standalone' ? 'post' : 'reply',
    sentAtMs: Date.parse(r.completed_at as string),
    removed: r.standing === 'removed',
    numbers: r.numbers_read_at ? { likes: (r.likes as number | null) ?? null, comments: (r.comments as number | null) ?? null, views: (r.views as number | null) ?? null } : null
  }))
}

function running(core: Core, channelId: Id): ChannelTrial | null {
  const row = core.db.prepare('SELECT * FROM channel_trials WHERE channel_id = ? AND verdict IS NULL ORDER BY started_at DESC LIMIT 1').get(channelId) as Row | undefined
  return row ? mapTrial(row) : null
}

/** The Inbox items of trials: one for each trial whose time is up and that has no verdict yet. Derived on demand; gone with the verdict. */
export function trialItems(core: Core): AttentionItem[] {
  const now = core.clock.now()
  const rows = core.db.prepare('SELECT * FROM channel_trials WHERE verdict IS NULL AND ends_at <= ? ORDER BY ends_at').all(now.toISOString()) as Row[]
  return rows.flatMap((row) => {
    const trial = mapTrial(row)
    let channel: Channel
    try {
      channel = core.repos.channel(trial.channelId)
    } catch {
      return []
    }
    const progress = trialProgress(trial, sendsOfChannel(core, trial.channelId, trial.startedAt), now.getTime())
    return [
      {
        id: `trial:${trial.channelId}`,
        kind: 'question' as const,
        title: `The trial of ${channel.target} is over: keep, stop or extend?`,
        detail: `${thresholdLine(trial, progress, channel.platform)}. ${progress.posts} post${progress.posts === 1 ? '' : 's'} and ${progress.replies} repl${progress.replies === 1 ? 'y' : 'ies'} went out in ${trial.weeks} weeks.`,
        refType: 'channel' as const,
        refId: trial.channelId,
        createdAt: trial.endsAt
      }
    ]
  })
}

export interface TrialTerms {
  hypothesis: string
  weeks: number
  hoursPerWeek: number
  metric: TrialMetric
  ownLabel?: string | null
  threshold: number
}

export function proposalPrompt(input: { channelId: Id; product: { name: string; description: string }; channel: { platform: string; target: string }; metrics: TrialMetric[]; usual: { posts: number; likes: number | null; comments: number | null; views: number | null } | null }): AiTask {
  const usual = input.usual
    ? `In the last four weeks this channel had ${input.usual.posts} posts of the owner's; the site showed under them: likes or points ${input.usual.likes ?? 'not shown'}, comments ${input.usual.comments ?? 'not shown'}, views ${input.usual.views ?? 'not shown'}.`
    : 'The owner has not posted in this channel yet: there are no numbers of its own to go by.'
  const prompt = [
    'The owner of a small product wants to try one channel for a few weeks before giving it more time. You propose the terms of that trial; the owner edits them and decides.',
    '',
    `The product (data): ${oneLine(input.product.name, 80)}${input.product.description !== '' ? ` - ${oneLine(input.product.description, 300)}` : ''}`,
    `The channel (data): ${oneLine(input.channel.target, 80)} on ${input.channel.platform}.`,
    usual,
    '',
    'Propose:',
    '- "hypothesis": one or two sentences: who is here, what they would get from the owner\'s posts, and what the owner hopes that leads to. No promise of a result.',
    `- "weeks": one of ${TRIAL_WEEKS.join(', ')}.`,
    '- "hoursPerWeek": a whole number from 1 to 10 that one person can keep up.',
    `- "metric": one of ${input.metrics.map((m) => `"${m}"`).join(', ')} ("posts" counts the owner's posts that stayed up; "own" is a number only the owner sees, like sales, and then give "ownLabel" in a few words).`,
    '- "threshold": the number for the WHOLE trial at which the channel is worth keeping. Modest and reachable; with numbers of the channel\'s own given above, near what they suggest for the trial\'s length, not far above.',
    '- "why": one sentence on why this number.',
    'Propose nothing about automation, votes, follows, several accounts or hiding who the author is.',
    appLanguageRule('the hypothesis, the label and the reason'),
    '',
    'Answer with ONLY this JSON object, no code fences and no other text:',
    '{"hypothesis": "...", "weeks": 3, "hoursPerWeek": 2, "metric": "comments", "ownLabel": "", "threshold": 20, "why": "..."}'
  ].join('\n')
  return { label: 'trial.propose', title: 'Proposing a trial for the channel', subject: input.channelId, prompt }
}

export function readProposal(raw: unknown, metrics: readonly TrialMetric[]): Parsed<TrialProposal> {
  if (!isRecord(raw)) return { ok: false, error: 'The answer must be a JSON object with hypothesis, weeks, hoursPerWeek, metric, threshold and why.' }
  const hypothesis = typeof raw.hypothesis === 'string' ? plainText(raw.hypothesis, MAX_HYPOTHESIS) : ''
  if (hypothesis === '' || unsafe(hypothesis)) return { ok: false, error: 'hypothesis must be one or two plain sentences, with no promise and nothing about automation.' }
  const metric = metrics.find((m) => m === raw.metric)
  if (!metric) return { ok: false, error: `metric must be one of ${metrics.join(', ')}.` }
  const threshold = typeof raw.threshold === 'number' && Number.isFinite(raw.threshold) ? Math.round(raw.threshold) : 0
  if (threshold < 1) return { ok: false, error: 'threshold must be a whole number of at least 1.' }
  const weeks = TRIAL_WEEKS.find((w) => w === raw.weeks) ?? DEFAULT_TRIAL_WEEKS
  const hours = typeof raw.hoursPerWeek === 'number' && raw.hoursPerWeek >= 1 && raw.hoursPerWeek <= 10 ? Math.round(raw.hoursPerWeek) : DEFAULT_TRIAL_HOURS
  const label = typeof raw.ownLabel === 'string' ? plainText(raw.ownLabel, MAX_LABEL) : ''
  const why = typeof raw.why === 'string' ? plainText(raw.why, 240) : ''
  return { ok: true, value: { hypothesis, weeks, hoursPerWeek: hours, metric, ownLabel: metric === 'own' && label !== '' && !unsafe(label) ? label : null, threshold, why: unsafe(why) ? '' : why } }
}

export class ChannelTrials {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  private channel(channelId: unknown): Channel {
    const id = requireText(channelId, 'The channel')
    return found(() => this.core.repos.channel(id), 'The channel')
  }

  /** The numbers the application can read under posts on this channel; none where its connector has no reader. */
  private numberKinds(channel: Channel): readonly ('likes' | 'comments' | 'views')[] {
    const connector = this.core.connectors.get(channel.connectorId)
    if (typeof connector?.readPostNumbers !== 'function') return []
    return connector.postNumberKinds ?? ['likes', 'comments', 'views']
  }

  view(channelId: Id): TrialView {
    const channel = this.channel(channelId)
    const now = this.core.clock.now().getTime()
    const rows = (this.core.db.prepare('SELECT * FROM channel_trials WHERE channel_id = ? ORDER BY started_at DESC').all(channel.id) as Row[]).map(mapTrial)
    const current = rows.find((t) => t.verdict === null) ?? null
    const sends = rows.length > 0 ? sendsOfChannel(this.core, channel.id, rows[rows.length - 1]!.startedAt) : []
    const siblings = this.core.repos.listChannels().filter((c) => c.productId === channel.productId)
    return {
      channelId: channel.id,
      platform: channel.platform,
      metrics: metricsFor(this.numberKinds(channel)),
      current: current ? { trial: current, progress: trialProgress(current, sends, now) } : null,
      past: rows.filter((t) => t.verdict !== null).map((trial) => ({ trial, progress: trialProgress(trial, sends, Date.parse(trial.decidedAt ?? trial.endsAt)) })),
      parked: channel.status === 'paused' && channel.statusDetail === PARKED_DETAIL,
      inWork: siblings.filter((c) => c.status === 'active').length,
      onTrial: siblings.filter((c) => running(this.core, c.id) !== null).length
    }
  }

  start(args: { channelId: Id } & TrialTerms): TrialView {
    const channel = this.channel(args.channelId)
    if (running(this.core, channel.id)) throw new ApiError('invalid_state', 'This channel already has a trial running. Give it a verdict first.')
    const hypothesis = plainText(requireText(args.hypothesis, 'What you expect of the channel'), MAX_HYPOTHESIS)
    if (hypothesis === '') throw new ApiError('invalid_input', 'Say in a sentence what you expect of this channel.')
    if (!TRIAL_WEEKS.includes(args.weeks)) throw new ApiError('invalid_input', `A trial lasts ${TRIAL_WEEKS.join(', ')} weeks.`)
    if (!Number.isInteger(args.hoursPerWeek) || args.hoursPerWeek < 1 || args.hoursPerWeek > 40) throw new ApiError('invalid_input', 'Hours a week must be a whole number from 1 to 40.')
    if (!metricsFor(this.numberKinds(channel)).includes(args.metric)) throw new ApiError('invalid_input', 'The application cannot read that number on this channel. Judge the trial by posts that stayed up, or by a number of your own.')
    if (!Number.isInteger(args.threshold) || args.threshold < 1) throw new ApiError('invalid_input', 'The number that means "keep" must be a whole number of at least 1.')
    const ownLabel = args.metric === 'own' ? plainText(args.ownLabel ?? '', MAX_LABEL) : ''
    if (args.metric === 'own' && ownLabel === '') throw new ApiError('invalid_input', 'Name your own number in a few words, for example "sales in the shop".')
    const now = this.core.clock.now()
    this.core.db
      .prepare('INSERT INTO channel_trials (id, channel_id, hypothesis, weeks, hours_per_week, metric, own_label, threshold, started_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), channel.id, hypothesis, args.weeks, args.hoursPerWeek, args.metric, ownLabel === '' ? null : ownLabel, args.threshold, now.toISOString(), new Date(now.getTime() + args.weeks * 7 * DAY_MS).toISOString())
    this.core.log.info('results', `A trial of ${args.weeks} weeks was started.`, channel.id)
    this.changed()
    return this.view(channel.id)
  }

  /** The verdict. `stop` parks the channel (paused; nothing is deleted, "Resume" brings it back); `extend` adds two weeks and keeps the trial running. */
  decide(args: { channelId: Id; verdict: 'keep' | 'stop' | 'extend'; ownResult?: number | null }): TrialView {
    const channel = this.channel(args.channelId)
    const trial = running(this.core, channel.id)
    if (!trial) throw new ApiError('invalid_state', 'This channel has no trial running.')
    const now = this.core.clock.now()
    if (args.verdict === 'extend') {
      const from = Math.max(Date.parse(trial.endsAt), now.getTime())
      this.core.db.prepare('UPDATE channel_trials SET ends_at = ?, weeks = weeks + ? WHERE id = ?').run(new Date(from + EXTEND_WEEKS * 7 * DAY_MS).toISOString(), EXTEND_WEEKS, trial.id)
    } else {
      let ownResult: number | null = null
      if (trial.metric === 'own') {
        if (typeof args.ownResult !== 'number' || !Number.isFinite(args.ownResult) || args.ownResult < 0) throw new ApiError('invalid_input', `Type ${metricName('own', channel.platform, trial.ownLabel)} for the trial: the application cannot see it.`)
        ownResult = Math.round(args.ownResult)
      }
      const progress = trialProgress({ ...trial, ownResult }, sendsOfChannel(this.core, channel.id, trial.startedAt), now.getTime())
      this.core.db.prepare('UPDATE channel_trials SET verdict = ?, decided_at = ?, own_result = ?, final_measured = ? WHERE id = ?').run(args.verdict, now.toISOString(), ownResult, progress.measured, trial.id)
      if (args.verdict === 'stop' && channel.status !== 'setup' && channel.status !== 'paused') this.store.updateChannel(channel.id, { status: 'paused', statusDetail: PARKED_DETAIL })
      this.core.log.info('results', `A trial ended with the verdict "${args.verdict}"${progress.measured !== null ? ` at ${shortCount(progress.measured)} of ${shortCount(trial.threshold)}` : ''}.`, channel.id)
    }
    this.changed()
    return this.view(channel.id)
  }

  /** The AI proposes the terms of a trial for the form; nothing is stored. */
  async propose(channelId: Id): Promise<TrialProposal> {
    const channel = this.channel(channelId)
    const engine = await readyEngine(this.core)
    const product = this.core.repos.product(channel.productId)
    const metrics = metricsFor(this.numberKinds(channel))
    const now = this.core.clock.now().getTime()
    const posts = sendsOfChannel(this.core, channel.id, new Date(now - 28 * DAY_MS).toISOString()).filter((s) => s.kind === 'post')
    const total = (key: 'likes' | 'comments' | 'views'): number | null => {
      const values = posts.map((p) => p.numbers?.[key]).filter((v): v is number => typeof v === 'number')
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
    }
    const task = proposalPrompt({
      channelId: channel.id,
      product: { name: product.name, description: product.description ?? '' },
      channel: { platform: channel.platform, target: channel.target },
      metrics,
      usual: posts.length > 0 ? { posts: posts.length, likes: total('likes'), comments: total('comments'), views: total('views') } : null
    })
    try {
      return await askWithRepair(engine, task, (raw) => readProposal(raw, metrics), {})
    } catch (error) {
      if (error instanceof AiError) throw new ApiError('proposal_failed', error.message)
      throw error
    }
  }

  private changed(): void {
    this.core.events.changed('results', 'attention', 'channels')
  }
}
