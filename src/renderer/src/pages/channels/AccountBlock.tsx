import type { ReactNode } from 'react'

/** One numbered block of the account card: what it is, its value in one line, the buttons for it, and room for a form below. */
export function AccountBlock({
  step,
  title,
  summary,
  actions,
  testId,
  children
}: {
  step: number
  title: string
  summary: ReactNode
  actions?: ReactNode
  testId?: string
  children?: ReactNode
}) {
  return (
    <section className="acct-block" data-testid={testId}>
      <div className="acct-block-head">
        <span className="acct-step" aria-hidden="true">
          {step}
        </span>
        <div className="acct-block-title">
          <strong>{title}</strong>
          <div className="acct-summary">{summary}</div>
        </div>
        {actions && <div className="acct-actions">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
