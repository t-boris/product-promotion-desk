import type { Suggestion } from '../../../../shared/overview-suggestions'
import { suggestionHref } from './overview-data'

/** "The AI suggests": each line says what to do and the fact it comes from, with one link that goes to the place to do it. */
export function Suggestions({ suggestions }: { suggestions: Suggestion[] }) {
  if (suggestions.length === 0) return <p className="muted" data-testid="overview-no-suggestions">Nothing to suggest right now: the channels are planned, nothing waits and nothing is quiet.</p>
  return (
    <ul className="ov-suggestions" data-testid="overview-suggestions">
      {suggestions.map((suggestion) => (
        <li key={suggestion.id} data-testid={`suggestion-${suggestion.id}`}>
          <span className="ov-suggestion-text">
            <strong>{suggestion.text}</strong>
            <span className="muted">{suggestion.why}</span>
          </span>
          <a className="btn" href={suggestionHref(suggestion.action)}>
            {suggestion.actionLabel}
          </a>
        </li>
      ))}
    </ul>
  )
}
