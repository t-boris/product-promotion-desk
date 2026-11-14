import { useState } from 'react'
import { PASSPORT_SECTIONS, type PassportSection, type PassportView } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Hint, More } from '../../ui'
import { ClaimForm } from './ClaimForm'
import { ClaimRow } from './ClaimRow'
import { SECTION_HINTS, SECTION_LABELS } from './labels'
import { approvableClaims, approvalBlocker, groupBySection, summarize } from './model'
import { VersionsCard } from './VersionsCard'

function Section({ section, view }: { section: PassportSection; view: PassportView }) {
  const [adding, setAdding] = useState(false)
  const claims = groupBySection(view.claims)[section]
  const empty = claims.length === 0 && !adding
  return (
    <Card
      title={SECTION_LABELS[section]}
      actions={
        <Button variant="quiet" className="accent" onClick={() => setAdding(true)} disabled={adding} aria-label={`Add statement to ${SECTION_LABELS[section]}`} data-testid={`add-claim-${section}`}>
          + Add statement
        </Button>
      }
      className={`passport-section${empty ? ' compact' : ''}`}
    >
      <div data-testid={`section-${section}`}>
        {/* An empty section is one line: what belongs here, and that nothing is here yet. */}
        <Hint>
          {SECTION_HINTS[section]}
          {empty ? ' · nothing here yet' : ''}
        </Hint>
        <div className="stack claim-list">
          {claims.map((claim) => (
            <ClaimRow key={claim.id} claim={claim} all={view.claims} productId={view.product.id} />
          ))}
        </div>
        {adding && <ClaimForm productId={view.product.id} section={section} onDone={() => setAdding(false)} />}
      </div>
    </Card>
  )
}

/** One line of the empty passport's checklist (BUG-019): the section, what belongs there, and "+ Add statement". */
function SectionRow({ section, view }: { section: PassportSection; view: PassportView }) {
  const [adding, setAdding] = useState(false)
  return (
    <li data-testid={`section-${section}`}>
      <div className="checklist-head">
        <span className="checklist-mark" aria-hidden="true" />
        <span className="checklist-text">
          <strong>{SECTION_LABELS[section]}</strong>
          <span className="hint">{SECTION_HINTS[section]}</span>
        </span>
        <Button variant="quiet" className="accent" onClick={() => setAdding(true)} disabled={adding} aria-label={`Add statement to ${SECTION_LABELS[section]}`} data-testid={`add-claim-${section}`}>
          + Add statement
        </Button>
      </div>
      {adding && <ClaimForm productId={view.product.id} section={section} onDone={() => setAdding(false)} />}
    </li>
  )
}

export function PassportTab({ view, onOpenAnalysis }: { view: PassportView; /** Opens the Analysis tab, the usual way to fill an empty passport. */ onOpenAnalysis: () => void }) {
  const summary = summarize(view.claims)
  const blocker = approvalBlocker(view)
  const { approve: bulk, needLook } = approvableClaims(view.claims)
  const [approve, approving] = useAction(() => call('passport.approve', { productId: view.product.id }))
  // One click for what is plainly approvable. There is no bulk call: each statement is approved in turn, as if the owner had pressed it.
  // The core can still refuse one (a price without a verified source): the others are approved anyway and the refusal is said.
  const [approveAll, approvingAll] = useAction(async () => {
    const refused: string[] = []
    for (const claim of bulk) {
      try {
        await call('passport.claim.setStatus', { claimId: claim.id, status: 'approved' })
      } catch (error) {
        refused.push(`“${claim.text}”: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (refused.length > 0) {
      throw new Error(`${bulk.length - refused.length} approved, ${refused.length} not. ${refused.join(' ')}`)
    }
  })
  const version = view.version
  // No statement and no approved passport: the next step is the analysis, not the approval (BUG-019). A draft emptied by
  // deleting every statement of an approved passport keeps the usual layout, with its version and the approved badge.
  const empty = view.claims.length === 0 && view.product.activePassportVersionId === null
  const approveButton = (
    <Button
      variant={empty ? 'ghost' : 'primary'}
      onClick={() => void approve()}
      disabled={blocker !== null || approving.busy || approvingAll.busy}
      title={blocker ?? 'Make this the passport that drafting and review rely on'}
      data-testid="approve-passport"
    >
      {approving.busy ? 'Approving…' : 'Approve passport'}
    </Button>
  )

  if (empty) {
    return (
      <div className="stack" data-testid="passport-tab">
        <Card title="Product passport">
          <div className="stack">
            <p className="passport-lead" data-testid="passport-empty-lead">
              <strong>No passport yet.</strong> Run the analysis to draft it from your sources, or add the first statement yourself.
            </p>
            <div className="row">
              <Button variant="primary" onClick={onOpenAnalysis} data-testid="passport-open-analysis">
                Open Analysis
              </Button>
              {approveButton}
              <Hint data-testid="approve-blocker">Nothing to approve yet.</Hint>
            </div>
            <div className="row" data-testid="passport-status">
              <span className="hint">
                {summary.approved} approved · {summary.proposed} to review
              </span>
            </div>
            <More label="How the passport works">
              <Hint>Only approved statements are used for drafting and checks.</Hint>
              <Hint>Your edits go into a new draft; the approved version stays as it was until you approve the draft.</Hint>
            </More>
            <ErrorNote error={approving.error} />
          </div>
        </Card>
        <Card title="Sections">
          <ol className="passport-checklist">
            {PASSPORT_SECTIONS.map((section) => (
              <SectionRow key={section} section={section} view={view} />
            ))}
          </ol>
        </Card>
        <VersionsCard productId={view.product.id} />
      </div>
    )
  }

  return (
    <div className="stack" data-testid="passport-tab">
      <Card
        title="Product passport"
        actions={
          <>
            {bulk.length > 0 && (
              <Button onClick={() => void approveAll()} disabled={approvingAll.busy || approving.busy} title={needLook.length > 0 ? `${needLook.length} more need a look first: unknown, conflicting or unconfirmed.` : undefined} data-testid="approve-all-claims">
                {approvingAll.busy ? 'Approving…' : `Approve all ${bulk.length} proposed`}
              </Button>
            )}
            {approveButton}
          </>
        }
      >
        <div className="stack">
          <div className="row" data-testid="passport-status">
            {version ? (
              <>
                <strong>Version {version.version}</strong>
                <Badge tone={version.status === 'approved' ? 'good' : 'warn'}>{version.status === 'approved' ? 'Approved' : 'Draft'}</Badge>
              </>
            ) : (
              <Badge>No passport yet</Badge>
            )}
            <span className="hint">
              {summary.approved} approved · {summary.proposed} to review
            </span>
          </div>
          {/* The reason the button is off stands next to it, at reading size, not as a small grey line below the banners. */}
          {blocker && version?.status === 'draft' && (
            <Hint tone="strong" className="blocker" data-testid="approve-blocker">
              {blocker}
            </Hint>
          )}
          <More label="How the passport works">
            <Hint>Only approved statements are used for drafting and checks.</Hint>
            <Hint>Your edits go into a new draft; the approved version stays as it was until you approve the draft.</Hint>
          </More>
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
          <ErrorNote error={approving.error ?? approvingAll.error} />
        </div>
      </Card>

      {PASSPORT_SECTIONS.map((section) => (
        <Section key={section} section={section} view={view} />
      ))}
      <VersionsCard productId={view.product.id} />
    </div>
  )
}
