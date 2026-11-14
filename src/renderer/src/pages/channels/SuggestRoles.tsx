import { useState } from 'react'
import type { RoleSuggestion } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Hint, More } from '../../ui'
import { AiIdeaHead } from './AiIdeaHead'
import type { Blocked } from './suggestion-block'

/** Ideas from the AI for roles and login names. Nothing is created and nothing is registered anywhere: "Use this role" only opens the form with the role filled in. */
export function SuggestRoles({ productId, blocked, engineLabel, onUse }: { productId: string; blocked: Blocked | null; engineLabel: string | undefined; onUse: (suggestion: RoleSuggestion) => void }) {
  const [ideas, setIdeas] = useState<RoleSuggestion[] | null>(null)
  const [suggest, state] = useAction(() => call('accounts.suggestRoles', { productId }))

  async function ask(): Promise<void> {
    const result = await suggest()
    if (result) setIdeas(result)
  }

  return (
    <section className="idea" data-testid="suggest-roles-card">
      <AiIdeaHead
        title="Roles for logins"
        summary="A role gives an account its own voice, for example an astrologer or a developer."
        button={
          <Button variant="secondary" onClick={() => void ask()} disabled={blocked !== null || state.busy} data-testid="suggest-roles">
            {state.busy ? 'Thinking…' : 'Suggest roles with AI'}
          </Button>
        }
        blocked={blocked}
        engineLabel={engineLabel}
        blockedTestId="suggest-roles-blocked"
      />
      <More>
        <Hint>The AI proposes roles and login names from the approved passport.</Hint>
        <Hint>“Use this role” opens the new-account form in the Accounts section with the role filled in. You create the real account on the platform yourself: the app never registers it for you.</Hint>
      </More>
      <ErrorNote error={state.error} />
      {ideas && ideas.length === 0 && <p className="muted">The AI had no new role to suggest this time.</p>}
      {ideas && ideas.length > 0 && (
        <div className="stack" data-testid="role-suggestions">
          {ideas.map((idea, index) => (
            <div className="list-row suggestion" key={`${idea.name}:${index}`} data-testid="role-suggestion">
              <div>
                <strong>{idea.name}</strong>
                <div className="small">{idea.voice}</div>
                <div className="hint">Login name ideas: {idea.usernameIdeas.join(', ')}. Check that the name is free on the platform.</div>
                <div className="hint">{idea.reason}</div>
              </div>
              <Button onClick={() => onUse(idea)} data-testid="role-use">
                Use this role
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
