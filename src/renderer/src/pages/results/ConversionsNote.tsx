import { Card } from '../../ui'

/** Version 1 shows platform metrics only; this note keeps the page from implying anything about conversions (DEC-002). */
export function ConversionsNote() {
  return (
    <Card title="Business conversions are not measured in version 1">
      <p className="muted" data-testid="conversions-note">
        Sign-ups, purchases and other events on your own site are not collected, and no analytics service is connected, so nothing here says whether promotion led to them. Only the metrics each platform provides are shown. A metric marked Unavailable was not provided by the platform; that is different from zero.
      </p>
    </Card>
  )
}
