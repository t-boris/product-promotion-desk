import { useState } from 'react'
import type { SourcePreview } from '../../../../shared/api'
import type { Id, SourceKind } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field, Hint, SegmentedControl } from '../../ui'
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

export function AddSource({ productId }: { productId: Id }) {
  const [kind, setKind] = useState<SourceKind>('url')
  const [ref, setRef] = useState('')
  const [label, setLabel] = useState('')
  const [include, setInclude] = useState('')
  const [exclude, setExclude] = useState('')
  const [preview, setPreview] = useState<SourcePreview | null>(null)

  const scope = kind === 'code_folder' ? scopeFromText(include, exclude) : null
  const [add, adding] = useAction(async () => {
    const source = await call('sources.add', { productId, kind, ref: ref.trim(), label: label.trim() || undefined, scope })
    setRef('')
    setLabel('')
    setInclude('')
    setExclude('')
    setPreview(null)
    return source
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
    <Card title="Add a source">
      <div className="stack">
      <SegmentedControl
        label="Kind of source"
        name="source-kind"
        value={kind}
        onChange={changed(setKind)}
        options={KINDS.map((k) => ({ value: k, label: SOURCE_LABELS[k] }))}
        testIdPrefix="source-kind-"
      />
      <Hint>{KIND_HINTS[kind]}</Hint>
      <div className={kind === 'text' ? 'stack' : 'source-fields'}>
        <Field label={kind === 'text' ? 'Text' : kind === 'url' ? 'Address' : 'Path'}>
          {kind === 'text' ? (
            <textarea className="input" value={ref} onChange={(e) => changed(setRef)(e.target.value)} placeholder={SOURCE_PLACEHOLDERS[kind]} data-testid="source-ref" />
          ) : (
            <input className="input" value={ref} onChange={(e) => changed(setRef)(e.target.value)} placeholder={SOURCE_PLACEHOLDERS[kind]} data-testid="source-ref" />
          )}
        </Field>
        <Field label="Name (optional)">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} data-testid="source-label" />
        </Field>
      </div>
      {kind === 'code_folder' && (
        <div className="scope-grid">
          <Field label="Read only these paths" hint="One folder or file per line, relative to the project. Empty means the whole project.">
            <textarea className="input short" value={include} onChange={(e) => changed(setInclude)(e.target.value)} placeholder="src&#10;docs" data-testid="source-scope-include" />
          </Field>
          <Field label="Also hold back" hint="One path per line, on top of the built-in exclusions.">
            <textarea className="input short" value={exclude} onChange={(e) => changed(setExclude)(e.target.value)} placeholder="src/generated" data-testid="source-scope-exclude" />
          </Field>
        </div>
      )}
      <ErrorNote error={adding.error ?? previewing.error} />
      {preview && <SourcePreviewPanel preview={preview} />}
      <div className="row source-add-actions">
        <Button onClick={() => void showPreview()} disabled={!ready || previewing.busy} data-testid="source-preview-button">
          {previewing.busy ? 'Checking…' : 'Preview what the AI will see'}
        </Button>
        <Button variant="primary" onClick={() => void add()} disabled={!ready || adding.busy} data-testid="source-add">
          {adding.busy ? 'Adding…' : 'Add source'}
        </Button>
      </div>
      </div>
    </Card>
  )
}
