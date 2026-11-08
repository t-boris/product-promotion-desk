import type { Id, PassportStatus } from '../../../../shared/types'
import { Badge, Card, formatTime, Loading, type Tone } from '../../ui'
import { useQuery } from '../../hooks'

const TONES: Record<PassportStatus, Tone> = { draft: 'warn', approved: 'good', superseded: 'neutral' }
const LABELS: Record<PassportStatus, string> = { draft: 'Draft', approved: 'Approved', superseded: 'Replaced' }

/** Every approved passport is kept: later versions replace the active one but never change it. */
export function VersionsCard({ productId }: { productId: Id }) {
  const versions = useQuery('passport.versions', { productId }, ['passport', 'products'])
  return (
    <Card title="Versions">
      {versions.loading && !versions.data && <Loading what="Loading versions" />}
      {versions.data && versions.data.length === 0 && <p className="muted">No version yet. The first version is created when you add or approve a statement.</p>}
      <div className="stack" data-testid="passport-versions">
        {versions.data?.map((v) => (
          <div key={v.id} className="list-row" data-testid={`version-${v.version}`}>
            <div className="row">
              <strong>Version {v.version}</strong>
              <Badge tone={TONES[v.status]}>{LABELS[v.status]}</Badge>
            </div>
            <span className="muted small">{v.approvedAt ? `Approved ${formatTime(v.approvedAt)}` : `Started ${formatTime(v.createdAt)}`}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
