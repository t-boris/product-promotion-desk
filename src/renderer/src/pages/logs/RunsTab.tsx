import { useQuery } from '../../hooks'
import { Badge, EmptyState, ErrorNote, Loading, formatTime } from '../../ui'
import { RUN_KIND_LABEL, RUN_STATUS_LABEL, RUN_STATUS_TONE, durationText } from './labels'

/** Every run with its time, status and short result (REQ-005). */
export function RunsTab() {
  const runs = useQuery('runs.list', { limit: 200 }, ['logs'])
  const channels = useQuery('channels.list', undefined, ['channels'])
  const targets = new Map(channels.data?.map((c) => [c.id, c.target]))

  return (
    <div className="stack" data-testid="runs-tab">
      <ErrorNote error={runs.error} />
      {runs.loading && !runs.data && <Loading what="Loading runs" />}
      {runs.data?.length === 0 && <EmptyState art="list" title="No runs yet">Checks of channels, metric refreshes and sends are listed here once they happen.</EmptyState>}
      {runs.data && runs.data.length > 0 && (
        <table className="table" data-testid="runs-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Kind</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.data.map((run) => (
              <tr key={run.id} data-testid={`run-${run.id}`}>
                <td>
                  {formatTime(run.startedAt)}
                  <div className="muted small">{durationText(run.startedAt, run.finishedAt)}</div>
                </td>
                <td>{RUN_KIND_LABEL[run.kind] ?? run.kind}</td>
                <td>{run.channelId ? (targets.get(run.channelId) ?? '—') : '—'}</td>
                <td>
                  <Badge tone={RUN_STATUS_TONE[run.status] ?? 'neutral'}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Badge>
                </td>
                <td style={{ wordBreak: 'break-word' }}>{run.summary || <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
