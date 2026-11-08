import { useState } from 'react'
import type { Id } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote } from '../../ui'
import { DraftEditor, toInput, type DraftForm } from './DraftEditor'

const EMPTY: DraftForm = { title: '', text: '', link: '', attachments: [] }

/** Write a standalone publication by hand. It is saved as a draft: nothing is published until it is approved. */
export function PublicationForm({ channelId, onCreated, onCancel }: { channelId: Id; onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<DraftForm>(EMPTY)
  const [create, creating] = useAction(async () => {
    await call('publications.create', { channelId, draft: toInput(form, true) })
    setForm(EMPTY)
    onCreated()
  })
  const input = toInput(form, true)
  const empty = !input.text && !input.title && !input.link && (input.attachments?.length ?? 0) === 0

  return (
    <Card title="New publication">
      <DraftEditor form={form} onChange={setForm} withTitle disabled={creating.busy} draft={null} />
      <ErrorNote error={creating.error} />
      <div className="row">
        <Button variant="primary" onClick={() => void create()} disabled={creating.busy || empty} data-testid="create-publication">
          Save as draft
        </Button>
        <Button onClick={onCancel} disabled={creating.busy}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}
