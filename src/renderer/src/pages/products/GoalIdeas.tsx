import type { GoalIdea } from '../../../../shared/types'
import { AiProposal } from '../../assist/AiProposal'
import type { Blocked } from '../../assist/block'
import { call } from '../../hooks'
import { Badge, Hint } from '../../ui'

/** One promotion goal idea at a time, from the approved passport. Nothing is saved: "Use this" fills the goal form and the owner adds the goal. */
export function GoalIdeas({ productId, blocked, engineLabel, onUse }: { productId: string; blocked: Blocked | null; engineLabel: string | undefined; onUse: (idea: GoalIdea) => void }) {
  return (
    <AiProposal<GoalIdea>
      title="Ideas for a goal"
      summary="What a person could do after they meet the product, from the approved passport."
      askLabel="Suggest a goal with AI"
      anotherLabel="Another one"
      note="Nothing is saved: Use this fills the goal form below and you add the goal."
      steer={{ label: 'Lean toward', placeholder: 'Lean toward (optional), for example: people trying it for free' }}
      blocked={blocked}
      engineLabel={engineLabel}
      emptyText="The AI had no new safe goal idea this time. Try a hint, or write the goal yourself."
      testId="goal-ideas"
      ask={({ hint, avoid }) => call('goals.suggest', { productId, hint: hint.trim() || undefined, avoid })}
      keyOf={(idea) => idea.targetAction}
      onUse={onUse}
    >
      {(idea) => (
        <>
          <strong data-testid="goal-idea-target">{idea.targetAction}</strong>
          {idea.successMetrics.length > 0 && (
            <div className="row" aria-label="Suggested success metrics">
              {idea.successMetrics.map((metric) => (
                <Badge key={metric}>{metric}</Badge>
              ))}
            </div>
          )}
          {idea.reason && <Hint>{idea.reason}</Hint>}
        </>
      )}
    </AiProposal>
  )
}
