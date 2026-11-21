import type { DraftSource } from '../../../../shared/types'
import { AddressLink } from '../AddressLink'
import { sourceHost } from './post-draft'

/**
 * What the AI found on the web and built its text on: each page by its title and its site, opening in the app's own browser like every other address,
 * with the fact it took from the page folded away. Shown only when the AI searched; the addresses are never put into the text.
 */
export function FoundSources({ sources }: { sources: readonly DraftSource[] }) {
  if (sources.length === 0) return null
  return (
    <div className="ai-found" data-testid="ai-found">
      <strong>What the AI found</strong>
      <ul>
        {sources.map((source) => (
          <li key={source.url}>
            <AddressLink url={source.url} testId="ai-found-link">
              {source.title}
            </AddressLink>{' '}
            <span className="muted small">{sourceHost(source.url)}</span>
            <details className="ai-found-fact">
              <summary className="muted small">What it took from this page</summary>
              <span className="small">{source.fact}</span>
            </details>
          </li>
        ))}
      </ul>
    </div>
  )
}
