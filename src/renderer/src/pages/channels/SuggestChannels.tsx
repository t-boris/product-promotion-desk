import { useState } from 'react'
import type { ChannelSuggestion, PlatformInfo } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote, Hint, More } from '../../ui'
import { AiIdeaHead } from './AiIdeaHead'
import { platformLabel } from './model'
import type { Blocked } from './suggestion-block'

/** Ideas from the AI for where this product's audience talks. Nothing is connected: "Use this" only fills the form above. */
export function SuggestChannels({
  productId,
  platforms,
  blocked,
  engineLabel,
  onUse
}: {
  productId: string
  platforms: PlatformInfo[]
  blocked: Blocked | null
  engineLabel: string | undefined
  onUse: (suggestion: ChannelSuggestion) => void
}) {
  const [ideas, setIdeas] = useState<ChannelSuggestion[] | null>(null)
  const [suggest, state] = useAction(() => call('channels.suggest', { productId }))

  async function ask(): Promise<void> {
    const result = await suggest()
    if (result) setIdeas(result)
  }

  return (
    <section className="idea" data-testid="suggest-channels-card">
      <AiIdeaHead
        title="Where to promote"
        summary="Places where the audience may talk, from the approved passport."
        button={
          <Button variant="primary" onClick={() => void ask()} disabled={blocked !== null || state.busy} data-testid="suggest-channels">
            {state.busy ? 'Thinking…' : 'Suggest channels with AI'}
          </Button>
        }
        blocked={blocked}
        engineLabel={engineLabel}
        blockedTestId="suggest-blocked"
      />
      <More>
        <Hint>These are only ideas: nothing is connected, and an address may not exist or may not allow promotion.</Hint>
      </More>
      <ErrorNote error={state.error} />
      {ideas && ideas.length === 0 && <p className="muted">The AI had no safe suggestion this time.</p>}
      {ideas && ideas.length > 0 && (
        <div className="stack" data-testid="suggestions">
          {ideas.map((idea, index) => (
            <div className="list-row suggestion" key={`${idea.platform}:${idea.target}:${index}`} data-testid="suggestion">
              <div>
                <strong>{idea.target}</strong> <span className="muted">{platformLabel(idea.platform, platforms)}</span> <Badge tone="warn">Unverified</Badge>
                <div className="hint">{idea.reason}</div>
              </div>
              <Button onClick={() => onUse(idea)} data-testid="suggestion-use">
                Use this
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
