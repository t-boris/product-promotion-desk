import type { Channel, PlatformInfo } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, formatTime } from '../../ui'
import { PLAN_FORMAT_LABEL, platformLabel } from './model'

/**
 * What to do on this channel (DEC-013): the AI reads the approved passport, the goals and what the platform accepts, and proposes steps.
 * It is advice stored with the channel. Nothing in it is done by the application, and nothing is published without the owner's approval.
 */
export function ChannelPlanCard({ channel, platforms, blockedReason }: { channel: Channel; platforms: PlatformInfo[]; blockedReason: string | null }) {
  const [prepare, state] = useAction(() => call('channels.preparePlan', { channelId: channel.id }))
  const plan = channel.plan
  const platform = platformLabel(channel.platform, platforms)

  return (
    <Card
      title="What to do here"
      actions={
        <Button onClick={() => void prepare()} disabled={blockedReason !== null || state.busy} data-testid="plan-prepare">
          {state.busy ? 'Thinking…' : plan ? 'Plan again' : 'Plan with AI'}
        </Button>
      }
    >
      <p className="muted small">
        The AI reads the approved passport, your goals and what {platform} accepts, and proposes what to do on this channel. It is advice only: the app does nothing from it, and nothing is published without your approval.
      </p>
      {blockedReason && (
        <div className="note warn" data-testid="plan-blocked">
          {blockedReason}
        </div>
      )}
      <ErrorNote error={state.error} />
      {!plan && !state.busy && !state.error && <p className="muted">No plan yet. Press “Plan with AI”.</p>}
      {plan && (
        <div className="stack" data-testid="plan">
          <p data-testid="plan-summary">{plan.summary}</p>
          {plan.steps.map((step, index) => (
            <div className="list-row stacked" key={`${index}:${step.title}`} data-testid="plan-step">
              <div>
                <strong>
                  {index + 1}. {step.title}
                </strong>{' '}
                <Badge tone="info">{PLAN_FORMAT_LABEL[step.format]}</Badge>
                {step.frequency && <span className="muted small"> · {step.frequency}</span>}
              </div>
              <div>{step.detail}</div>
              {step.youPrepare && (
                <div className="muted small">
                  <strong>You prepare:</strong> {step.youPrepare}
                </div>
              )}
            </div>
          ))}
          {plan.watchOut.length > 0 && (
            <div className="note warn" data-testid="plan-watch-out">
              <strong>Check first</strong>
              <ul className="plain-list">
                {plan.watchOut.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small">
            Prepared {formatTime(plan.generatedAt)} with {plan.engineId === 'claude' ? 'Claude Code' : 'Codex'}. Check it yourself before acting on it.
          </p>
        </div>
      )}
    </Card>
  )
}
