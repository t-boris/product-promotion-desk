import type { ReactNode } from 'react'
import { Hint } from '../../ui'
import type { Blocked } from './suggestion-block'

/**
 * The head of an "ask the AI" block: the title, one line on what it does, the button, and, right under the button, either why it is off
 * (with the link that fixes it) or what it will use. The reason used to sit below the button as a note nobody connected to it (BUG-009).
 */
export function AiIdeaHead({
  title,
  summary,
  button,
  blocked,
  engineLabel,
  blockedTestId
}: {
  title: string
  summary: string
  button: ReactNode
  blocked: Blocked | null
  engineLabel: string | undefined
  blockedTestId: string
}) {
  return (
    <div className="idea-head">
      <div className="idea-title">
        <h3>{title}</h3>
        <Hint>{summary}</Hint>
      </div>
      <div className="idea-action">
        {button}
        {blocked ? (
          <Hint tone="warn" data-testid={blockedTestId}>
            {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
          </Hint>
        ) : (
          <Hint>Uses {engineLabel ?? 'the AI engine'}. Nothing is created or connected.</Hint>
        )}
      </div>
    </div>
  )
}
