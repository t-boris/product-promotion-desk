import { Hint, More } from '../../ui'

/** Version 1 shows platform metrics only; this note keeps the page from implying anything about conversions (DEC-002). One line, with the detail one click away. */
export function ConversionsNote() {
  return (
    <div className="note" data-testid="conversions-card">
      <strong>Business conversions are not measured in version 1.</strong>{' '}
      <More label="Why, and what Unavailable means">
        <Hint tone="strong" data-testid="conversions-note">
          Sign-ups, purchases and other events on your own site are not collected, and no analytics service is connected, so nothing here says whether promotion led to them. Only the metrics each platform provides are shown. A metric marked Unavailable was not provided by the platform; that is different from zero.
        </Hint>
      </More>
    </div>
  )
}
