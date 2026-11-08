import { useState } from 'react'
import type { ChannelSuggestion, PlatformInfo } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote } from '../../ui'
import { platformLabel } from './model'

/** Ideas from the AI for where this product's audience talks. Nothing is connected: "Use this" only fills the form below. */
export function SuggestChannels({ productId, platforms, blockedReason, onUse }: { productId: string; platforms: PlatformInfo[]; blockedReason: string | null; onUse: (suggestion: ChannelSuggestion) => void }) {
  const [ideas, setIdeas] = useState<ChannelSuggestion[] | null>(null)
  const [suggest, state] = useAction(() => call('channels.suggest', { productId }))

  async function ask(): Promise<void> {
    const result = await suggest()
    if (result) setIdeas(result)
  }

  return (
    <Card
      title="Where to promote"
      actions={
        <Button onClick={() => void ask()} disabled={blockedReason !== null || state.busy} data-testid="suggest-channels">
          {state.busy ? 'Thinking…' : 'Suggest channels with AI'}
        </Button>
      }
    >
      <p className="muted small">The AI looks at the approved passport and suggests places where the audience may talk. These are only ideas: nothing is connected, and an address may not exist or may not allow promotion.</p>
      {blockedReason && (
        <div className="note warn" data-testid="suggest-blocked">
          {blockedReason}
        </div>
      )}
      <ErrorNote error={state.error} />
      {ideas && ideas.length === 0 && <p className="muted">The AI had no safe suggestion this time.</p>}
      {ideas && ideas.length > 0 && (
        <div className="stack" data-testid="suggestions">
          {ideas.map((idea, index) => (
            <div className="list-row suggestion" key={`${idea.platform}:${idea.target}:${index}`} data-testid="suggestion">
              <div>
                <strong>{idea.target}</strong> <span className="muted">{platformLabel(idea.platform, platforms)}</span> <Badge tone="warn">Unverified</Badge>
                <div className="muted small">{idea.reason}</div>
              </div>
              <Button onClick={() => onUse(idea)} data-testid="suggestion-use">
                Use this
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
