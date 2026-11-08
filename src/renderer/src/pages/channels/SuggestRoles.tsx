import { useState } from 'react'
import type { RoleSuggestion } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote } from '../../ui'

/** Ideas from the AI for roles and login names. Nothing is created and nothing is registered anywhere: "Use this role" only opens the form with the role filled in. */
export function SuggestRoles({ productId, blockedReason, onUse }: { productId: string; blockedReason: string | null; onUse: (suggestion: RoleSuggestion) => void }) {
  const [ideas, setIdeas] = useState<RoleSuggestion[] | null>(null)
  const [suggest, state] = useAction(() => call('accounts.suggestRoles', { productId }))

  async function ask(): Promise<void> {
    const result = await suggest()
    if (result) setIdeas(result)
  }

  return (
    <Card
      title="Roles for logins"
      actions={
        <Button onClick={() => void ask()} disabled={blockedReason !== null || state.busy} data-testid="suggest-roles">
          {state.busy ? 'Thinking…' : 'Suggest roles with AI'}
        </Button>
      }
    >
      <p className="muted small">
        A role gives an account its own voice, for example an astrologer or a developer. The AI proposes roles and login names from the approved passport. “Use this role” opens the new-account form in the Accounts section with the role filled in; you create the real account on the platform yourself, the app never registers it for you.
      </p>
      {blockedReason && (
        <div className="note warn" data-testid="suggest-roles-blocked">
          {blockedReason}
        </div>
      )}
      <ErrorNote error={state.error} />
      {ideas && ideas.length === 0 && <p className="muted">The AI had no new role to suggest this time.</p>}
      {ideas && ideas.length > 0 && (
        <div className="stack" data-testid="role-suggestions">
          {ideas.map((idea, index) => (
            <div className="list-row suggestion" key={`${idea.name}:${index}`} data-testid="role-suggestion">
              <div>
                <strong>{idea.name}</strong>
                <div className="small">{idea.voice}</div>
                <div className="muted small">Login name ideas: {idea.usernameIdeas.join(', ')}. Check that the name is free on the platform.</div>
                <div className="muted small">{idea.reason}</div>
              </div>
              <Button onClick={() => onUse(idea)} data-testid="role-use">
                Use this role
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
