import type { PageReport } from '../../../../shared/types'

/**
 * What an account's page showed and did when the owner asked (DEC-016): the messages the site shows, the requests it made and the
 * errors of its console, with a screenshot. A form field's value is never in it.
 */
export function PageReportView({ report, testId }: { report: PageReport | null; testId: string }) {
  if (report === null) {
    return (
      <p className="muted small" data-testid={testId}>
        There is no page open for this account.
      </p>
    )
  }
  const refused = (status: number | null, error: string | null): boolean => error !== null || (status !== null && status >= 400)
  return (
    <div className="stack page-report" data-testid={testId}>
      <div>
        <strong>{report.title || '(no title)'}</strong> <span className="muted small">{report.address}</span>
      </div>
      <div className="small" data-testid={`${testId}-alerts`}>
        <strong>The page says</strong>
        {report.alerts.length === 0 ? (
          <span className="muted"> nothing in an alert or an error box.</span>
        ) : (
          <ul className="plain-lines">
            {report.alerts.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="small" data-testid={`${testId}-requests`}>
        <strong>What the page sent</strong>
        {report.requests.length === 0 ? (
          <span className="muted"> nothing worth noting.</span>
        ) : (
          <ul className="plain-lines">
            {report.requests.map((request, index) => (
              <li key={index} className={refused(request.status, request.error) ? 'bad' : undefined}>
                {request.method} {request.target} → {request.error ?? request.status}
                {request.count > 1 ? ` ×${request.count}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
      {report.consoleErrors.length > 0 && (
        <div className="small" data-testid={`${testId}-console`}>
          <strong>Errors in the page’s console</strong>
          <ul className="plain-lines">
            {report.consoleErrors.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {report.screenshot ? <img className="page-shot" src={report.screenshot} alt={`Screenshot of ${report.address}`} data-testid={`${testId}-shot`} /> : <span className="muted small">The page could not be captured.</span>}
      {report.savedAs && <span className="muted small">Saved as {report.savedAs}</span>}
    </div>
  )
}
