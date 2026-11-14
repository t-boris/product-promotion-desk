import { useState } from 'react'
import type { PassportView, Product } from '../../../../shared/types'
import { productHref, type ProductTab } from '../../route'
import { call, useAction } from '../../hooks'
import { Badge, Button, Card, ConfirmAction, ErrorNote, Field, ObjectHeader, useOpenForm } from '../../ui'
import { ClampedText } from './ClampedText'
import { ANALYSIS_LABELS, ANALYSIS_TONES } from './labels'
import { deleteBlocker, NOT_ANALYZED_HINT, passportStatus } from './product-status'

function EditDetails({ product, onDone }: { product: Product; onDone: () => void }) {
  const saveVariant = useOpenForm()
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
        <Button variant={saveVariant} type="submit" disabled={!valid || state.busy} data-testid="edit-product-save">
          {state.busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ProductHeader({ view, channels, onDeleted, onOpenTab }: { view: PassportView; channels: number; onDeleted: () => void; onOpenTab: (tab: ProductTab) => void }) {
  const { product } = view
  const passport = passportStatus(product, view.version, view.claims)
  const [editing, setEditing] = useState(false)
  // A connected channel stands in the way of a delete (BUG-046). Pressing Delete says so before any question; the note is worked out from the
  // channel count on every render, so it goes with the last channel and is never left on screen after its cause is gone.
  const [asked, setAsked] = useState(false)
  if (asked && channels === 0) setAsked(false)
  const blocker = asked ? deleteBlocker(channels) : null
  const [remove, removing] = useAction(async () => {
    await call('products.delete', { id: product.id })
    onDeleted()
  })

  return (
    <div className="obj">
      <ObjectHeader
        title={product.name}
        actions={
          <>
            <Button onClick={() => setEditing((v) => !v)} data-testid="edit-product">
              {editing ? 'Close' : 'Edit details'}
            </Button>
            {channels > 0 ? (
              <Button variant="danger" onClick={() => setAsked(true)} data-testid="delete-product">
                Delete
              </Button>
            ) : (
              <ConfirmAction
                label="Delete"
                question={`Delete "${product.name}" with its sources, passport and version history? This cannot be undone.`}
                confirmLabel="Delete product"
                busyLabel="Deleting…"
                onConfirm={() => remove()}
                testId="delete-product"
                confirmTestId="delete-product-confirm"
              />
            )}
          </>
        }
      />
      {editing ? (
        <Card title="Edit details">
          <EditDetails product={product} onDone={() => setEditing(false)} />
        </Card>
      ) : (
        <dl className="kv" data-testid="product-details">
          <dt>Website</dt>
          <dd>
            {product.websiteUrl ?? (
              <span className="muted">
                No website yet{' '}
                <button type="button" className="link-btn" onClick={() => setEditing(true)} data-testid="add-website">
                  Add website
                </button>
              </span>
            )}
          </dd>
          <dt>Description</dt>
          {/* Two lines and "Show full text": the full text is also a source on the Sources tab, and the tabs stay near the top (BUG-037). */}
          <dd>
            {product.description ? (
              <ClampedText text={product.description} lines={2} testId="product-description" toggleTestId="product-description-toggle" />
            ) : (
              <span className="muted">No description yet</span>
            )}
          </dd>
          <dt>Status</dt>
          <dd className="row">
            <Badge tone={passport.tone}>{passport.label}</Badge>
            {/* Statements waiting for the owner: a link to the Passport tab, where they are reviewed (BUG-037). */}
            {passport.detail && (
              <a className="badge badge-warn" href={productHref(product.id, 'passport')} title="Review them on the Passport tab" data-testid="passport-review-link">
                {passport.detail}
              </a>
            )}
            {product.analysisStatus === 'idle' ? (
              // Amber and clickable: it is a step still to do, not a quiet caption (QA findings 42, 48).
              <>
                <Badge tone="warn">{ANALYSIS_LABELS.idle}</Badge>
                <button type="button" className="link-btn" onClick={() => onOpenTab('analysis')} title={NOT_ANALYZED_HINT} data-testid="open-analysis">
                  Open Analysis
                </button>
              </>
            ) : (
              <Badge tone={ANALYSIS_TONES[product.analysisStatus]}>{ANALYSIS_LABELS[product.analysisStatus]}</Badge>
            )}
          </dd>
        </dl>
      )}
      {blocker && (
        <div className="note" role="status" data-testid="delete-product-blocked">
          {blocker}{' '}
          <a href={productHref(product.id, 'channels')} data-testid="delete-product-open-channels">
            Open the Channels tab
          </a>
        </div>
      )}
      <ErrorNote error={removing.error} />
    </div>
  )
}
