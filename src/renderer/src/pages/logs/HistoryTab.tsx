import type { HistoryEntry } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { Badge, EmptyState, ErrorNote, Loading, formatTime } from '../../ui'
import { SEND_STATE_LABEL, SEND_STATE_TONE } from './labels'
import { useVersionLabels } from './useVersionLabels'

const EXCERPT = 220

function excerpt(text: string): string {
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text
}

function isWebLink(url: string | null): url is string {
  return !!url && /^https?:\/\//i.test(url)
}

function HistoryRow({ entry, versionLabel }: { entry: HistoryEntry; versionLabel: string | null }) {
  const { action, draft, opportunity } = entry
  const when = action.completedAt ?? action.attemptedAt
  return (
    <tr data-testid={`history-${action.id}`}>
      <td>
        {formatTime(when)}
        {action.completedAt && <div className="muted small">Attempted {formatTime(action.attemptedAt)}</div>}
      </td>
      <td style={{ wordBreak: 'break-word' }}>
        {draft.title && <strong>{draft.title}</strong>}
        <div>{excerpt(draft.text)}</div>
        {draft.link && <div className="muted small">Link: {draft.link}</div>}
        <div className="muted small">{opportunity.kind === 'standalone' ? 'Standalone publication' : 'Reply'}</div>
      </td>
      <td style={{ wordBreak: 'break-word' }}>
        <div>
          {entry.channelTarget} as {entry.accountLabel}
        </div>
        {isWebLink(action.destination) ? (
          <a className="small" href={action.destination} target="_blank" rel="noreferrer">
            {action.destination}
          </a>
        ) : (
          <div className="muted small">{action.destination}</div>
        )}
      </td>
      <td style={{ wordBreak: 'break-word' }}>
        <div data-testid={`basis-${action.id}`}>{action.authorizationBasis}</div>
        <div className="muted small">Knowledge {versionLabel ?? action.knowledgeVersionId?.slice(0, 8) ?? 'not recorded'}</div>
      </td>
      <td>
        <Badge tone={SEND_STATE_TONE[action.state] ?? 'neutral'}>{SEND_STATE_LABEL[action.state] ?? action.state}</Badge>
        {isWebLink(action.resultUrl) && (
          <div>
            <a className="small" href={action.resultUrl} target="_blank" rel="noreferrer" data-testid={`result-link-${action.id}`}>
              Open published message
            </a>
          </div>
        )}
        {action.error && <div className="muted small">{action.error}</div>}
      </td>
    </tr>
  )
}

/** What was sent, where, when and on what basis (REQ-006). */
export function HistoryTab() {
  const history = useQuery('history.list', { limit: 200 }, ['opportunities', 'logs'])
  const labels = useVersionLabels(history.data?.map((e) => e.opportunity.productId) ?? [])

  return (
    <div className="stack" data-testid="history-tab">
      <ErrorNote error={history.error} />
      {history.loading && !history.data && <Loading what="Loading action history" />}
      {history.data?.length === 0 && <EmptyState art="list" title="Nothing has been sent yet">Every message the application sends is recorded here, with the approval or rule that allowed it.</EmptyState>}
      {history.data && history.data.length > 0 && (
        <table className="table" data-testid="history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>What was sent</th>
              <th>Where</th>
              <th>On what basis</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((entry) => (
              <HistoryRow key={entry.action.id} entry={entry} versionLabel={entry.action.knowledgeVersionId ? (labels.get(entry.action.knowledgeVersionId) ?? null) : null} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
