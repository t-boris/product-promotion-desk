import { useState } from 'react'
import { DEFAULT_TRIAL_HOURS, DEFAULT_TRIAL_WEEKS, EXTEND_WEEKS, TRIAL_WEEKS, metricName, thresholdLine, type ChannelTrial, type TrialMetric, type TrialProgress } from '../../../../shared/channel-trial'
import { shortCount } from '../../../../shared/post-numbers'
import type { Channel, TrialView } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Field, Hint } from '../../ui'
import { shortTime } from '../posts/short-time'

const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * The trial of a channel (DEC-058), above its results: what is expected of the channel, for how long, and which number means "keep", written
 * before the weeks are spent. The application counts the number; the verdict (keep, stop and park, extend) is the owner's.
 */
export function TrialCard({ channel }: { channel: Channel }) {
  const trials = useQuery('trials.get', { channelId: channel.id }, ['results', 'opportunities', 'channels'])
  const [open, setOpen] = useState(false)
  const view = trials.data
  if (!view) return trials.error ? <ErrorNote error={trials.error} /> : null
  return (
    <Card
      title="Trial"
      className="trial-card"
      actions={
        !view.current && !open ? (
          <Button onClick={() => setOpen(true)} data-testid="trial-open">
            Start a trial
          </Button>
        ) : undefined
      }
    >
      {view.current ? (
        <Running view={view} trial={view.current.trial} progress={view.current.progress} />
      ) : open ? (
        <TrialForm view={view} onDone={() => setOpen(false)} />
      ) : (
        <p className="muted" data-testid="trial-none">
          {view.parked
            ? 'This channel is parked: its last trial ended with “stop”. Nothing was deleted; “Resume” on the Status tab brings it back.'
            : 'No trial is running. A trial writes down, before you spend the weeks, what you expect of this channel, for how long, and which number means “keep”. At the end you see that number and decide.'}
        </p>
      )}
      {view.past.length > 0 && (
        <table className="table trial-past" data-testid="trial-past">
          <thead>
            <tr>
              <th>Earlier trial</th>
              <th>Expected</th>
              <th>Came out</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {view.past.map(({ trial, progress }) => (
              <tr key={trial.id}>
                <td className="muted">
                  {shortTime(trial.startedAt)}, {trial.weeks} weeks
                </td>
                <td>
                  {shortCount(trial.threshold)} {metricName(trial.metric, view.platform, trial.ownLabel)}
                </td>
                <td>{progress.measured === null ? <span className="muted">not shown</span> : shortCount(progress.measured)}</td>
                <td>{trial.verdict === 'keep' ? <Badge tone="good">Kept</Badge> : <Badge>Stopped</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Hint data-testid="trial-in-work">
        {view.inWork} channel{view.inWork === 1 ? '' : 's'} of this product {view.inWork === 1 ? 'is' : 'are'} in work now{view.onTrial > 0 ? `, ${view.onTrial} on trial` : ''}. One person keeps up one or two well.
      </Hint>
    </Card>
  )
}

function Running({ view, trial, progress }: { view: TrialView; trial: ChannelTrial; progress: TrialProgress }) {
  const [own, setOwn] = useState('')
  const [decide, deciding] = useAction((verdict: 'keep' | 'stop' | 'extend') => call('trials.decide', { channelId: view.channelId, verdict, ...(trial.metric === 'own' && verdict !== 'extend' ? { ownResult: own.trim() === '' ? null : Number(own) } : {}) }))
  const needsOwn = trial.metric === 'own'
  const ownMissing = needsOwn && (own.trim() === '' || !Number.isFinite(Number(own)) || Number(own) < 0)
  return (
    <div className="trial-running" data-testid="trial-running">
      <p className="trial-hypothesis">{trial.hypothesis}</p>
      <dl className="post-results-totals">
        <div>
          <dt>{progress.ended ? 'Over since' : 'Day'}</dt>
          <dd>{progress.ended ? shortTime(trial.endsAt) : `${progress.day} of ${progress.days}`}</dd>
        </div>
        <div>
          <dt>{sentence(metricName(trial.metric, view.platform, trial.ownLabel))}</dt>
          <dd data-testid="trial-measured">
            {progress.measured === null ? '—' : shortCount(progress.measured)} <span className="trial-of">of {shortCount(trial.threshold)}</span>
          </dd>
          {progress.met !== null && <span className={progress.met ? 'trial-met' : 'muted small'}>{progress.met ? 'reached' : 'not reached yet'}</span>}
        </div>
        <div>
          <dt>Posts</dt>
          <dd>{progress.posts}</dd>
        </div>
        <div>
          <dt>Replies</dt>
          <dd>{progress.replies}</dd>
        </div>
        {progress.removed > 0 && (
          <div>
            <dt>Taken down</dt>
            <dd>{progress.removed}</dd>
          </div>
        )}
        <div>
          <dt>Planned</dt>
          <dd>{trial.hoursPerWeek} h a week</dd>
        </div>
      </dl>
      <Hint>{thresholdLine(trial, progress, view.platform)}. {progress.ended ? 'The trial is over: the verdict is yours.' : 'You may give the verdict before the end.'}</Hint>
      {needsOwn && (
        <Field label={`${sentence(metricName('own', view.platform, trial.ownLabel))} in the trial`} hint="The application cannot see this number: type it to give the verdict.">
          <input className="input trial-number" type="number" min={0} value={own} onChange={(e) => setOwn(e.target.value)} data-testid="trial-own-result" />
        </Field>
      )}
      <div className="trial-actions">
        <Button variant={progress.ended && progress.met !== false ? 'primary' : 'ghost'} onClick={() => void decide('keep')} disabled={deciding.busy || ownMissing} data-testid="trial-keep">
          Keep the channel
        </Button>
        <Button onClick={() => void decide('stop')} disabled={deciding.busy || ownMissing} data-testid="trial-stop">
          Stop and park it
        </Button>
        <Button onClick={() => void decide('extend')} disabled={deciding.busy} data-testid="trial-extend">
          Extend by {EXTEND_WEEKS} weeks
        </Button>
      </div>
      <Hint>“Stop and park it” pauses the channel: nothing is deleted and nothing more is prepared for it until you resume it.</Hint>
      <ErrorNote error={deciding.error} />
    </div>
  )
}

function TrialForm({ view, onDone }: { view: TrialView; onDone: () => void }) {
  const [hypothesis, setHypothesis] = useState('')
  const [weeks, setWeeks] = useState(DEFAULT_TRIAL_WEEKS)
  const [hours, setHours] = useState(String(DEFAULT_TRIAL_HOURS))
  const [metric, setMetric] = useState<TrialMetric>(view.metrics[0] ?? 'posts')
  const [ownLabel, setOwnLabel] = useState('')
  const [threshold, setThreshold] = useState('')
  const [why, setWhy] = useState('')
  const [propose, proposing] = useAction(async () => {
    const p = await call('trials.propose', { channelId: view.channelId })
    setHypothesis(p.hypothesis)
    setWeeks(p.weeks)
    setHours(String(p.hoursPerWeek))
    setMetric(p.metric)
    setOwnLabel(p.ownLabel ?? '')
    setThreshold(String(p.threshold))
    setWhy(p.why)
  })
  const [start, starting] = useAction(async () => {
    await call('trials.start', { channelId: view.channelId, hypothesis, weeks, hoursPerWeek: Number(hours), metric, ownLabel: metric === 'own' ? ownLabel : null, threshold: Number(threshold) })
    onDone()
  })
  const busy = proposing.busy || starting.busy
  const ready = hypothesis.trim() !== '' && Number.isInteger(Number(threshold)) && Number(threshold) >= 1 && Number.isInteger(Number(hours)) && Number(hours) >= 1 && (metric !== 'own' || ownLabel.trim() !== '')
  return (
    <div className="trial-form" data-testid="trial-form">
      <div className="trial-actions">
        <Button onClick={() => void propose()} disabled={busy} data-testid="trial-propose">
          {proposing.busy ? 'Proposing…' : 'Let the AI propose'}
        </Button>
        <Hint>The AI fills the form from the product and from this channel’s own numbers; you edit and decide. Nothing starts until you press “Start the trial”.</Hint>
      </div>
      <Field label="What you expect of this channel">
        <textarea className="input short" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="Who is here, what they get from your posts, what you hope it leads to." disabled={busy} data-testid="trial-hypothesis" />
      </Field>
      <div className="trial-row">
        <Field label="Length">
          <select className="input" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} disabled={busy} data-testid="trial-weeks">
            {TRIAL_WEEKS.map((w) => (
              <option key={w} value={w}>
                {w} weeks
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hours a week">
          <input className="input trial-number" type="number" min={1} max={40} value={hours} onChange={(e) => setHours(e.target.value)} disabled={busy} data-testid="trial-hours" />
        </Field>
        <Field label="Judged by">
          <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as TrialMetric)} disabled={busy} data-testid="trial-metric">
            {view.metrics.map((m) => (
              <option key={m} value={m}>
                {m === 'own' ? 'A number of my own (sales, sign-ups)' : sentence(metricName(m, view.platform, null))}
              </option>
            ))}
          </select>
        </Field>
        {metric === 'own' && (
          <Field label="What that number is">
            <input className="input" value={ownLabel} onChange={(e) => setOwnLabel(e.target.value)} placeholder="sales in the shop" disabled={busy} data-testid="trial-own-label" />
          </Field>
        )}
        <Field label="Keep the channel at">
          <input className="input trial-number" type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={busy} data-testid="trial-threshold" />
        </Field>
      </div>
      {why && <Hint>Why this number, by the AI: {why}</Hint>}
      {view.metrics.length === 2 && <Hint>The application cannot read likes, comments or views on this channel, so a trial here is judged by posts that stayed up or by a number of your own.</Hint>}
      <div className="trial-actions">
        <Button variant="primary" onClick={() => void start()} disabled={busy || !ready} data-testid="trial-start">
          Start the trial
        </Button>
        <Button onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
      <ErrorNote error={proposing.error ?? starting.error} />
    </div>
  )
}
