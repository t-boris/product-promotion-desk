import { useState, type FormEvent } from 'react'
import type { Product } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field } from '../../ui'

/** A product starts from a name plus a website address and/or a description; everything else is added later. */
export function CreateProduct({ onCreated, onCancel }: { onCreated: (product: Product) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [description, setDescription] = useState('')
  const [create, state] = useAction((args: Parameters<typeof call<'products.create'>>[1]) => call('products.create', args))

  const missingSource = websiteUrl.trim() === '' && description.trim() === ''
  const canSubmit = name.trim() !== '' && !missingSource && !state.busy

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return
    const product = await create({ name: name.trim(), websiteUrl: websiteUrl.trim() || undefined, description: description.trim() || undefined })
    if (product) onCreated(product)
  }

  return (
    <Card title="New product">
      <form onSubmit={(e) => void submit(e)} data-testid="create-product-form">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Natal Mystic" data-testid="product-name" autoFocus />
        </Field>
        <Field label="Website address" hint="The application reads the site (and its pricing or about pages) when you run the analysis.">
          <input className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" data-testid="product-url" />
        </Field>
        <Field label="Description" hint="Your own words about what the product does. You can use this instead of a website.">
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="product-description" />
        </Field>
        {name.trim() !== '' && missingSource && (
          <p className="muted small" data-testid="create-product-hint">
            Enter a website address or a description so there is something to start from.
          </p>
        )}
        <ErrorNote error={state.error} />
        <div className="row">
          <Button variant="primary" type="submit" disabled={!canSubmit} data-testid="create-product-submit">
            {state.busy ? 'Creating…' : 'Create product'}
          </Button>
          <Button type="button" onClick={onCancel} data-testid="create-product-cancel">
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}
