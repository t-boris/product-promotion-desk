import { useState } from 'react'
import type { Id } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, useOpenForm } from '../../ui'
import { DraftEditor, emptyForm, toInput, type DraftForm } from './DraftEditor'
import { PostDrafter } from './PostDrafter'
import type { PostAuthor } from './PostPreview'

/** Write a standalone publication by hand. It is saved as a draft: nothing is published until it is approved. */
export function PublicationForm({ productId, channelId, platform, author, onCreated, onCancel }: { productId: Id; channelId: Id; platform: string; author: PostAuthor; onCreated: () => void; onCancel: () => void }) {
  // The form is open on demand, so "Save as draft" is the screen's filled button while it is the form opened last.
  const saveVariant = useOpenForm()
  const [form, setForm] = useState<DraftForm>(emptyForm(true))
  const [create, creating] = useAction(async () => {
    await call('publications.create', { channelId, draft: toInput(form, true) })
    setForm(emptyForm(true))
    onCreated()
  })
  const input = toInput(form, true)
  const empty = !input.text && !input.title && !input.link && (input.attachments?.length ?? 0) === 0

  return (
    <Card title="New publication">
      <div className="review-body">
        <PostDrafter productId={productId} channelId={channelId} form={form} onChange={setForm} />
        <DraftEditor form={form} onChange={setForm} withTitle disabled={creating.busy} draft={null} autoFocus ai={{ channelId }} post={{ productId, platform, author }} />
        <ErrorNote error={creating.error} />
        <div className="form-actions">
          {empty && (
            <span className="muted small" data-testid="create-publication-reason">
              Write a title, a text or a link first.
            </span>
          )}
          <Button onClick={onCancel} disabled={creating.busy}>
            Cancel
          </Button>
          <Button variant={saveVariant} onClick={() => void create()} disabled={creating.busy || empty} data-testid="create-publication">
            Save as draft
          </Button>
        </div>
      </div>
    </Card>
  )
}
