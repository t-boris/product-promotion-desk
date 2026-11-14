import { useId, useRef, useState, type FormEvent } from 'react'
import type { Product } from '../../../../shared/types'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, Field, Hint, useOpenForm } from '../../ui'
import { applySiteProposal, proposalFits, siteProposalNote } from './site-proposal'

/**
 * A product starts from a website address and/or a description, and a name. The AI can read the site and fill the name and the description
 * (only the fields that are empty: what is typed stays). Everything else is added later.
 */
export function CreateProduct({ onCreated, onCancel }: { onCreated: (product: Product) => void; onCancel: () => void }) {
  const submitVariant = useOpenForm()
  const websiteId = useId()
  const [name, setName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [description, setDescription] = useState('')
  const [siteNote, setSiteNote] = useState<string | null>(null)
  const { blocked } = useAssistBlock()
  // The form as it is when the answer arrives, not as it was when the question was asked: the owner may type while the AI reads the site.
  const latest = useRef({ name, websiteUrl, description })
  latest.current = { name, websiteUrl, description }
  const [create, state] = useAction((args: Parameters<typeof call<'products.create'>>[1]) => call('products.create', args))
  const [fillFromSite, filling] = useAction(async () => {
    setSiteNote(null)
    const asked = websiteUrl
    const proposal = await call('products.draftFromSite', { url: asked })
    if (!proposal) {
      setSiteNote('The site says nothing usable about a product. Type the name and a description yourself.')
      return
    }
    if (!proposalFits(asked, latest.current.websiteUrl)) {
      setSiteNote('You changed the address while the AI was reading the site, so its proposal was not used. Press "Fill from the website" again.')
      return
    }
    const applied = applySiteProposal(latest.current, proposal)
    setName(applied.form.name)
    setWebsiteUrl(applied.form.websiteUrl)
    setDescription(applied.form.description)
    setSiteNote(siteProposalNote(applied))
  })

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
        <div className="field ai-field">
          <div className="field-head">
            <label className="field-label" htmlFor={websiteId}>
              Website address
            </label>
            <Button variant="secondary" onClick={() => void fillFromSite()} disabled={websiteUrl.trim() === '' || blocked !== null || filling.busy} data-testid="product-fill-from-site">
              {filling.busy ? 'Reading the site…' : 'Fill from the website'}
            </Button>
          </div>
          <input id={websiteId} className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" data-testid="product-url" autoFocus />
          <span className="hint">The AI can read the site and fill the name and the description. The application also reads the site (and its pricing or about pages) when you run the analysis.</span>
          {blocked && (
            <Hint tone="warn" data-testid="product-fill-blocked">
              {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
            </Hint>
          )}
          <ErrorNote error={filling.error} />
          {siteNote && (
            <p className="hint" role="status" data-testid="product-fill-note">
              {siteNote}
            </p>
          )}
        </div>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Natal Mystic" data-testid="product-name" />
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
          <Button variant={submitVariant} type="submit" disabled={!canSubmit} data-testid="create-product-submit">
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
