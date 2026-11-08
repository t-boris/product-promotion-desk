import type { SourcePreview } from '../../../../shared/api'
import { Badge } from '../../ui'

/** What the AI will see for a source, before anything is analyzed: what is included, and what is held back and why. */
export function SourcePreviewPanel({ preview }: { preview: SourcePreview }) {
  return (
    <div className="preview" data-testid="source-preview">
      <strong>What the AI will see</strong>
      <p className="muted small" data-testid="preview-summary">
        {preview.summary}
      </p>
      <div className="preview-columns">
        <div>
          <div className="row">
            <Badge tone="good">Included</Badge>
            <span className="muted small">{preview.included.length}</span>
          </div>
          {preview.included.length === 0 ? (
            <p className="muted small">Nothing from this source will be read.</p>
          ) : (
            <ul className="preview-list" data-testid="preview-included">
              {preview.included.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="row">
            <Badge tone="warn">Held back</Badge>
            <span className="muted small">{preview.excluded.length}</span>
          </div>
          {preview.excluded.length === 0 ? (
            <p className="muted small">Nothing is held back.</p>
          ) : (
            <ul className="preview-list" data-testid="preview-excluded">
              {preview.excluded.map((entry) => (
                <li key={entry.path}>
                  {entry.path} <span className="muted">— {entry.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
