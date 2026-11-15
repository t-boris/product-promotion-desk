import type { ReactNode } from 'react'

/**
 * One numbered step of the account card, as a group box: the number in a small neutral circle, the title, one line of what is set
 * (`--text-2`), the control on the right, and room below for a form. The number is also in the "Next:" note above, so it stays.
 */
export function AccountBlock({
  step,
  title,
  summary,
  actions,
  testId,
  children
}: {
  /** The number of the step; a block that is a setting, not a step, has none (the column keeps its place). */
  step?: number
  title: string
  summary: ReactNode
  actions?: ReactNode
  testId?: string
  children?: ReactNode
}) {
  return (
    <section className="card step" data-testid={testId}>
      <div className="step-head">
        <span className={`step-num${step === undefined ? ' blank' : ''}`} aria-hidden="true">
          {step}
        </span>
        <div className="step-main">
          <strong className="step-title">{title}</strong>
          <div className="step-summary">{summary}</div>
        </div>
        {actions && <div className="step-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
