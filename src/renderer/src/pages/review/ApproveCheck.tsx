import { useEffect, useRef, type ReactNode } from 'react'
import { Badge, Button } from '../../ui'
import { approveAnywayLabel, countLabel, introLine, mayApproveAnyway, type Held } from './approve-check'

interface Props {
  held: Held
  /** Pressed "Edit the text": the panel goes and the text is next to be changed. */
  onEdit: () => void
  /** Pressed "Approve anyway": what was pressed before goes on as it would have without the panel. */
  onApprove: () => void
  busy: boolean
  /** The filled button of the card, or a secondary one when another card owns it (the screen has one filled button). */
  editVariant: 'primary' | 'secondary'
  /** The rare actions (defer, reject) stay where they are on every card. */
  side: ReactNode
}

/**
 * The panel that stands between a click on Approve and the approval, for a text the owner wrote: one row for each rule the text breaks
 * (the rule, the words it is about, why), and two buttons. Nothing is approved while it is shown. "Edit the text" is the way back and
 * has the focus; "Approve anyway" approves as before, and is not offered while a finding blocks (the approval would refuse it).
 */
export function ApproveCheck({ held, onEdit, onApprove, busy, editVariant, side }: Props) {
  const root = useRef<HTMLDivElement>(null)
  // The panel appears where the buttons were pressed: the focus goes to the way back, not to the page (the pressed button is gone).
  useEffect(() => {
    root.current?.querySelector<HTMLButtonElement>('[data-testid="approve-check-edit"]')?.focus()
  }, [])

  return (
    <div className="check-panel" ref={root} role="alert" data-testid="approve-check">
      <div className="check-head">
        <strong>Check before you approve</strong>
        {held.error === null && <Badge tone="warn">{countLabel(held.findings)}</Badge>}
      </div>
      <p className="muted small check-intro" data-testid="approve-check-intro">
        {introLine(held)}
      </p>
      {held.findings.length > 0 && (
        <ul className="check-list">
          {held.findings.map((finding, i) => (
            <li key={`${finding.rule}-${i}`} data-testid="approve-check-item" data-rule={finding.rule} data-blocks={finding.blocks}>
              <span className="check-rule">
                {finding.title}
                {finding.blocks && <Badge tone="bad">Must be fixed</Badge>}
              </span>
              {finding.quote && <q>{finding.quote}</q>}
              <span className="muted small">{finding.why}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="review-actions">
        <div className="review-actions-main">
          {mayApproveAnyway(held) && (
            <Button onClick={onApprove} disabled={busy} data-testid="approve-check-anyway">
              {approveAnywayLabel(held.which)}
            </Button>
          )}
          <Button variant={editVariant} onClick={onEdit} disabled={busy} data-testid="approve-check-edit">
            Edit the text
          </Button>
        </div>
        <div className="review-actions-side">{side}</div>
      </div>
    </div>
  )
}
