import { useEffect, useRef, useState } from 'react'
import type { PassportView, Product, ProductSource } from '../../../../shared/types'
import type { SourcePreview } from '../../../../shared/api'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, EmptyState, ErrorNote, formatTime, Hint, More } from '../../ui'
import { AddSource } from './AddSource'
import { SOURCE_LABELS } from './labels'
import { describeScope } from './model'
import { isMirroredSource, isProse } from './source-view'
import { SourcePreviewPanel } from './SourcePreviewPanel'

/**
 * A text source shows three lines in the interface font, wrapped at words, and opens in full on request (BUG-010, QA finding 23).
 * Whether there is more to show is measured, not guessed from a character count: the width of the window decides.
 */
function SourceText({ text, lines }: { text: string; lines: number }) {
  const box = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const measure = (): void => {
      if (!open) setCut(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, open])
  return (
    <>
      <p ref={box} className={`source-text${open ? ' open' : ''}`} style={{ ['--lines' as string]: lines }} data-testid="source-text">
        {text}
      </p>
      {(cut || open) && (
        <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="source-toggle">
          {open ? 'Show less' : 'Show full text'}
        </button>
      )}
    </>
  )
}

function SourceRow({ source, product }: { source: ProductSource; product: Product }) {
  const [preview, setPreview] = useState<SourcePreview | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [remove, removing] = useAction(() => call('sources.remove', { id: source.id }))
  const [look, looking] = useAction(async () => {
    setPreview(await call('sources.preview', { kind: source.kind, ref: source.ref, scope: source.scope }))
  })
  const scope = describeScope(source.scope)
  const mirrored = isMirroredSource(source, product)

  return (
    <div className="stack" data-testid={`source-${source.id}`}>
      <div className="source-row">
        <div className="source-main">
          <div className="row">
            <Badge tone="info">{SOURCE_LABELS[source.kind]}</Badge>
            {source.label && <strong>{source.label}</strong>}
            {mirrored && <Badge>From product details</Badge>}
          </div>
          {isProse(source) ? <SourceText text={source.ref} lines={mirrored ? 2 : 3} /> : <div className="source-ref mono">{source.ref}</div>}
          <Hint>
            Added {formatTime(source.addedAt)}
            {scope ? ` · ${scope}` : ''}
            {mirrored ? ' · change it with Edit details above' : ''}
          </Hint>
        </div>
        <div className="source-actions">
          {(source.kind === 'code_folder' || source.kind === 'document' || source.kind === 'image') && (
            <Button variant="ghost" onClick={() => void look()} disabled={looking.busy} data-testid={`source-look-${source.id}`}>
              What the AI sees
            </Button>
          )}
          {!mirrored &&
            (confirming ? (
              <>
                <span className="hint strong">Remove this source?</span>
                <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid={`source-remove-confirm-${source.id}`}>
                  {removing.busy ? 'Removing…' : 'Remove'}
                </Button>
                <Button variant="quiet" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="quiet" className="danger" onClick={() => setConfirming(true)} data-testid={`source-remove-${source.id}`}>
                Remove
              </Button>
            ))}
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
        <Hint>The analysis reads only what is listed here.</Hint>
        <More label="What is read, and what never is">
          <Hint>Project code is read, never run. Secrets, environment files and dependencies are never sent to the AI engine.</Hint>
        </More>
        {view.sources.length === 0 ? (
          <EmptyState title="No sources yet">Add a website, notes, a document or a project folder below.</EmptyState>
        ) : (
          <div className="stack source-list">
            {view.sources.map((source) => (
              <SourceRow key={source.id} source={source} product={view.product} />
            ))}
          </div>
        )}
      </Card>
      <AddSource productId={view.product.id} />
    </div>
  )
}
