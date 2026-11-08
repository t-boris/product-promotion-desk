import { useState } from 'react'
import type { PassportView, ProductSource } from '../../../../shared/types'
import type { SourcePreview } from '../../../../shared/api'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, formatTime } from '../../ui'
import { AddSource } from './AddSource'
import { SOURCE_LABELS } from './labels'
import { describeScope } from './model'
import { SourcePreviewPanel } from './SourcePreviewPanel'

function SourceRow({ source }: { source: ProductSource }) {
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [remove, removing] = useAction(() => call('sources.remove', { id: source.id }))
  const [look, looking] = useAction(async () => {
    setPreview(await call('sources.preview', { kind: source.kind, ref: source.ref, scope: source.scope }))
  })
  const scope = describeScope(source.scope)
  const shown = source.kind === 'text' ? source.ref.slice(0, 160) + (source.ref.length > 160 ? '…' : '') : source.ref

  return (
    <div className="stack" data-testid={`source-${source.id}`}>
      <div className="list-row">
        <div className="source-main">
          <div className="row">
            <Badge tone="info">{SOURCE_LABELS[source.kind]}</Badge>
            {source.label && <strong>{source.label}</strong>}
          </div>
          <div className="source-ref">{shown}</div>
          <div className="muted small">
            Added {formatTime(source.addedAt)}
            {scope ? ` · ${scope}` : ''}
          </div>
        </div>
        <div className="row">
          {(source.kind === 'code_folder' || source.kind === 'document' || source.kind === 'image') && (
            <Button onClick={() => void look()} disabled={looking.busy} data-testid={`source-look-${source.id}`}>
              What the AI sees
            </Button>
          )}
          <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`source-remove-${source.id}`}>
            Remove
          </Button>
        </div>
      </div>
      <ErrorNote error={looking.error ?? removing.error} />
      {preview && <SourcePreviewPanel preview={preview} />}
    </div>
  )
}

export function SourcesTab({ view }: { view: PassportView }) {
  return (
    <div className="stack" data-testid="sources-tab">
      <Card title="Sources">
        <p className="muted">
          The analysis reads only what is listed here. Project code is read, never run, and secrets are never sent to the AI engine.
        </p>
        {view.sources.length === 0 ? (
          <EmptyState title="No sources yet">Add a website, notes, a document or a project folder below.</EmptyState>
        ) : (
          <div className="stack">
            {view.sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </div>
        )}
      </Card>
      <AddSource productId={view.product.id} />
    </div>
  )
}
