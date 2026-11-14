import { useQuery } from '../../hooks'
import { Badge, Card, EmptyState, ErrorNote, Loading, formatTime } from '../../ui'
import { RUN_KIND_LABEL, RUN_STATUS_LABEL, RUN_STATUS_TONE, durationText } from './labels'

/** Every run with its time, status and short result (REQ-005). */
export function RunsTab() {
  const runs = useQuery('runs.list', { limit: 200 }, ['logs'])
  const channels = useQuery('channels.list', undefined, ['channels'])
  const targets = new Map(channels.data?.map((c) => [c.id, c.target]))

  return (
    <div className="log-tab" data-testid="runs-tab">
      <ErrorNote error={runs.error} />
      {runs.loading && !runs.data && <Loading what="Loading runs" />}
      {runs.data && (
        <Card className="log-card">
          {runs.data.length === 0 && <EmptyState art="list" title="No runs yet">Checks of channels, metric refreshes and sends are listed here once they happen.</EmptyState>}
          {runs.data.length > 0 && (
            <table className="table log-table" data-testid="runs-table">
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
                    <td className="log-fit">
                      {formatTime(run.startedAt)}
                      <div className="muted small">{durationText(run.startedAt, run.finishedAt)}</div>
                    </td>
                    <td className="log-fit">{RUN_KIND_LABEL[run.kind] ?? run.kind}</td>
                    <td className="log-text">{run.channelId ? (targets.get(run.channelId) ?? '—') : '—'}</td>
                    <td>
                      <Badge tone={RUN_STATUS_TONE[run.status] ?? 'neutral'}>{RUN_STATUS_LABEL[run.status] ?? run.status}</Badge>
                    </td>
                    <td className="log-text">{run.summary || <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  )
}
