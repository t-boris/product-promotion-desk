import { useState } from 'react'
import { PASSPORT_SECTIONS, type PassportSection, type PassportView } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote } from '../../ui'
import { ClaimForm } from './ClaimForm'
import { ClaimRow } from './ClaimRow'
import { SECTION_HINTS, SECTION_LABELS } from './labels'
import { approvalBlocker, groupBySection, summarize } from './model'
import { VersionsCard } from './VersionsCard'

function Section({ section, view }: { section: PassportSection; view: PassportView }) {
  const [adding, setAdding] = useState(false)
  const claims = groupBySection(view.claims)[section]
  return (
    <Card
      title={SECTION_LABELS[section]}
      actions={
        <Button onClick={() => setAdding(true)} disabled={adding} data-testid={`add-claim-${section}`}>
          Add statement
        </Button>
      }
      className="passport-section"
    >
      <div data-testid={`section-${section}`}>
        <p className="muted small">{SECTION_HINTS[section]}</p>
        {claims.length === 0 && !adding && <p className="muted">Nothing here yet.</p>}
        <div className="stack">
          {claims.map((claim) => (
            <ClaimRow key={claim.id} claim={claim} all={view.claims} productId={view.product.id} />
          ))}
        </div>
        {adding && <ClaimForm productId={view.product.id} section={section} onDone={() => setAdding(false)} />}
      </div>
    </Card>
  )
}

export function PassportTab({ view }: { view: PassportView }) {
  const summary = summarize(view.claims)
  const blocker = approvalBlocker(view)
  const [approve, approving] = useAction(() => call('passport.approve', { productId: view.product.id }))
  const version = view.version

  return (
    <div className="stack" data-testid="passport-tab">
      <Card
        title="Product passport"
        actions={
          <Button variant="primary" onClick={() => void approve()} disabled={blocker !== null || approving.busy} title={blocker ?? 'Make this the passport that drafting and review rely on'} data-testid="approve-passport">
            {approving.busy ? 'Approving…' : 'Approve passport'}
          </Button>
        }
      >
        <div className="row" data-testid="passport-status">
          {version ? (
            <>
              <strong>Version {version.version}</strong>
              <Badge tone={version.status === 'approved' ? 'good' : 'warn'}>{version.status === 'approved' ? 'Approved' : 'Draft'}</Badge>
            </>
          ) : (
            <Badge>No passport yet</Badge>
          )}
          <span className="muted small">
            {summary.approved} approved · {summary.proposed} to review
          </span>
        </div>
        <p className="muted small">
          Only approved statements are used for drafting and checks. Your edits go into a new draft; the approved version stays as it was until you approve the draft.
        </p>
        {summary.unresolvedContradictions > 0 && (
          <div className="error-note" role="alert" data-testid="contradiction-banner">
            {summary.unresolvedContradictions} contradiction{summary.unresolvedContradictions === 1 ? '' : 's'} between sources. Neither version has been chosen: settle or dismiss each one before approving.
          </div>
        )}
        {summary.unconfirmed > 0 && (
          <div className="warn-note" data-testid="unconfirmed-banner">
            {summary.unconfirmed} statement{summary.unconfirmed === 1 ? '' : 's'} found only in the project code. Confirm that users can really use {summary.unconfirmed === 1 ? 'it' : 'them'} before approving.
          </div>
        )}
        {blocker && version?.status === 'draft' && (
          <p className="muted small" data-testid="approve-blocker">
            {blocker}
          </p>
        )}
        <ErrorNote error={approving.error} />
      </Card>

      {PASSPORT_SECTIONS.map((section) => (
        <Section key={section} section={section} view={view} />
      ))}
      <VersionsCard productId={view.product.id} />
    </div>
  )
}
