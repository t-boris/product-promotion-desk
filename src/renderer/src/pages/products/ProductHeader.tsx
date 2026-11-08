import { useState } from 'react'
import type { Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ErrorNote, Field } from '../../ui'
import { ANALYSIS_LABELS, ANALYSIS_TONES } from './labels'

function EditDetails({ product, onDone }: { product: Product; onDone: () => void }) {
  const [name, setName] = useState(product.name)
  const [websiteUrl, setWebsiteUrl] = useState(product.websiteUrl ?? '')
  const [description, setDescription] = useState(product.description ?? '')
  const [save, state] = useAction(() =>
    call('products.update', { id: product.id, name: name.trim(), websiteUrl: websiteUrl.trim() || null, description: description.trim() || null })
  )
  const valid = name.trim() !== '' && (websiteUrl.trim() !== '' || description.trim() !== '')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save().then((saved) => saved && onDone())
      }}
      data-testid="edit-product-form"
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-product-name" />
      </Field>
      <Field label="Website address">
        <input className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} data-testid="edit-product-url" />
      </Field>
      <Field label="Description" hint="Keep a website address or a description: the product needs something to be analyzed from.">
        <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="edit-product-description" />
      </Field>
      <ErrorNote error={state.error} />
      <div className="row">
        <Button variant="primary" type="submit" disabled={!valid || state.busy} data-testid="edit-product-save">
          {state.busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ProductHeader({ product, onDeleted }: { product: Product; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false)
  const [remove, removing] = useAction(async () => {
    const message = `Delete "${product.name}" with its sources, passport and version history? This cannot be undone.`
    if (!window.confirm(message)) return false
    await call('products.delete', { id: product.id })
    onDeleted()
    return true
  })

  return (
    <Card
      title={product.name}
      actions={
        <>
          <Button onClick={() => setEditing((v) => !v)} data-testid="edit-product">
            {editing ? 'Close' : 'Edit details'}
          </Button>
          <Button variant="danger" onClick={() => void remove()} disabled={removing.busy} data-testid="delete-product">
            Delete
          </Button>
        </>
      }
    >
      {editing ? (
        <EditDetails product={product} onDone={() => setEditing(false)} />
      ) : (
        <dl className="kv" data-testid="product-details">
          <dt>Website</dt>
          <dd>{product.websiteUrl ?? <span className="muted">Not set</span>}</dd>
          <dt>Description</dt>
          <dd>{product.description ?? <span className="muted">Not set</span>}</dd>
          <dt>Status</dt>
          <dd className="row">
            <Badge tone={product.activePassportVersionId ? 'good' : 'warn'}>{product.activePassportVersionId ? 'Passport approved' : 'No approved passport'}</Badge>
            <Badge tone={ANALYSIS_TONES[product.analysisStatus]}>{ANALYSIS_LABELS[product.analysisStatus]}</Badge>
          </dd>
        </dl>
      )}
      <ErrorNote error={removing.error} />
    </Card>
  )
}
