import { useState } from 'react'
import type { SourcePreview } from '../../../../shared/api'
import type { Id, ProductSource, SourceKind } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Field, Hint, SegmentedControl } from '../../ui'
import { SOURCE_LABELS, SOURCE_PLACEHOLDERS } from './labels'
import { scopeFromText } from './model'
import { SourcePreviewPanel } from './SourcePreviewPanel'

const KINDS: SourceKind[] = ['url', 'text', 'document', 'image', 'code_folder']

const KIND_HINTS: Record<SourceKind, string> = {
  url: 'The page and related pricing, about and terms pages of the same site are read.',
  text: 'Pasted notes, a price list or a description. Kept exactly as you type it.',
  document: 'Full path of a file on this computer. Text files are read; other files are kept as materials.',
  image: 'Full path of an image. Images are kept as materials and are not analyzed.',
  code_folder: 'Full path of the project folder. Files are only read, never run. Secrets, environment files and dependencies are always held back.'
}

/** What "Edit" says once a source is saved: the passport was drafted from the old text, so it needs a new analysis (BUG-034). */
export const SOURCE_SAVED_TEXT = 'Saved. Run the analysis again to update the passport.'

interface SourceFormProps {
  productId: Id
  /** The source to correct; without one the form adds a new source. */
  source?: ProductSource
  /** Called after an edit is saved. */
  onSaved?: () => void
  /** Closes an edit without saving. */
  onCancel?: () => void
}

/**
 * The fields of a source, a preview of what the AI will see, and the action row. "Add a source" shows it empty; "Edit" on a
 * source row shows it filled with that source, in place (BUG-034). An edited source keeps its kind, its id and the date it was
 * added, so the statements that cite it keep their source.
 */
export function SourceForm({ productId, source, onSaved, onCancel }: SourceFormProps) {
  const editing = source !== undefined
  // The add form and an open edit form are on the page together: their test ids differ, so a query finds the one it means.
  const tid = (name: string): string => (editing ? `source-edit-${name}` : `source-${name}`)
  const [kind, setKind] = useState<SourceKind>(source?.kind ?? 'url')
  const [ref, setRef] = useState(source?.ref ?? '')
  const [label, setLabel] = useState(source?.label ?? '')
  const [include, setInclude] = useState(source?.scope?.include.join('\n') ?? '')
  const [exclude, setExclude] = useState(source?.scope?.exclude.join('\n') ?? '')
  const [preview, setPreview] = useState<SourcePreview | null>(null)

  const scope = kind === 'code_folder' ? scopeFromText(include, exclude) : null
  const [save, saving] = useAction(async () => {
    const input = { ref: ref.trim(), label: label.trim() || undefined, scope }
    if (source) {
      await call('sources.update', { id: source.id, ...input })
      onSaved?.()
      return
    }
    await call('sources.add', { productId, kind, ...input })
    setRef('')
    setLabel('')
    setInclude('')
    setExclude('')
    setPreview(null)
  })
  const [showPreview, previewing] = useAction(async () => {
    setPreview(await call('sources.preview', { kind, ref: ref.trim(), scope }))
  })

  const changed = <T,>(set: (value: T) => void) => (value: T): void => {
    setPreview(null)
    set(value)
  }
  const ready = ref.trim() !== ''

  return (
    <div className="stack" data-testid={editing ? `source-edit-form-${source.id}` : undefined}>
      {editing ? (
        // The kind of a saved source stays what it is; only what it points at and its name change.
        <div className="row">
          <Badge tone="info">{SOURCE_LABELS[kind]}</Badge>
        </div>
      ) : (
        <SegmentedControl
          label="Kind of source"
          name="source-kind"
          value={kind}
          onChange={changed(setKind)}
          options={KINDS.map((k) => ({ value: k, label: SOURCE_LABELS[k] }))}
          testIdPrefix="source-kind-"
        />
      )}
      <Hint>{KIND_HINTS[kind]}</Hint>
      <div className={kind === 'text' ? 'stack' : 'source-fields'}>
        <Field label={kind === 'text' ? 'Text' : kind === 'url' ? 'Address' : 'Path'}>
          {kind === 'text' ? (
            <textarea className="input" value={ref} onChange={(e) => changed(setRef)(e.target.value)} placeholder={SOURCE_PLACEHOLDERS[kind]} data-testid={tid('ref')} />
          ) : (
            <input className="input" value={ref} onChange={(e) => changed(setRef)(e.target.value)} placeholder={SOURCE_PLACEHOLDERS[kind]} data-testid={tid('ref')} />
          )}
        </Field>
        <Field label="Name (optional)">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} data-testid={tid('label')} />
        </Field>
      </div>
      {kind === 'code_folder' && (
        <div className="scope-grid">
          <Field label="Read only these paths" hint="One folder or file per line, relative to the project. Empty means the whole project.">
            <textarea className="input short" value={include} onChange={(e) => changed(setInclude)(e.target.value)} placeholder="src&#10;docs" data-testid={tid('scope-include')} />
          </Field>
          <Field label="Also hold back" hint="One path per line, on top of the built-in exclusions.">
            <textarea className="input short" value={exclude} onChange={(e) => changed(setExclude)(e.target.value)} placeholder="src/generated" data-testid={tid('scope-exclude')} />
          </Field>
        </div>
      )}
      <ErrorNote error={saving.error ?? previewing.error} />
      {preview && <SourcePreviewPanel preview={preview} />}
      <div className="row source-add-actions">
        <Button onClick={() => void showPreview()} disabled={!ready || previewing.busy} data-testid={tid('preview-button')}>
          {previewing.busy ? 'Checking…' : 'Preview what the AI will see'}
        </Button>
        {editing ? (
          <>
            <Button variant="primary" onClick={() => void save()} disabled={!ready || saving.busy} data-testid="source-save">
              {saving.busy ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="quiet" onClick={onCancel} disabled={saving.busy} data-testid="source-edit-cancel">
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => void save()} disabled={!ready || saving.busy} data-testid="source-add">
            {saving.busy ? 'Adding…' : 'Add source'}
          </Button>
        )}
      </div>
    </div>
  )
}

export function AddSource({ productId }: { productId: Id }) {
  return (
    <Card title="Add a source">
      <SourceForm productId={productId} />
    </Card>
  )
}
