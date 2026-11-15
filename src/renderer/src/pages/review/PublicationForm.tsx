import { useState } from 'react'
import type { Id } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, Card, ErrorNote, useOpenForm } from '../../ui'
import { DraftEditor, emptyForm, toInput, type DraftForm } from './DraftEditor'
import { PostDrafter } from './PostDrafter'
import type { PostAuthor } from './PostPreview'
import { saveIntent, saveLabel, toggled, whereRows } from './post-group'
import { WhereToPost, useChannelOptions } from './WhereToPost'

/**
 * Write a post by hand for one channel, or for several (DEC-032). It is saved as a draft (a version for each channel): nothing is
 * published until it is approved. `onCreated` says which channel the post is for, so the screen can show it.
 */
export function PublicationForm({ productId, channelId, platform, reads, author, onCreated, onCancel }: { productId: Id; channelId: Id; platform: string; reads: boolean; author: PostAuthor; onCreated: (channelId: Id) => void; onCancel: () => void }) {
  // The form is open on demand, so "Save as draft" is the screen's filled button while it is the form opened last.
  const saveVariant = useOpenForm()
  const [form, setForm] = useState<DraftForm>(emptyForm(true))
  // The channel the screen is on is ticked until the owner ticks anything; nothing else is ticked for them.
  const [picked, setPicked] = useState<Id[] | null>(null)
  const chosen = picked ?? [channelId]
  const input = toInput(form, true)
  const options = useChannelOptions(productId, input)
  const rows = whereRows(options.data, chosen, { channelId, platform, target: author.target, accountLabel: author.name })
  const intent = saveIntent(chosen, rows)
  const [create, creating] = useAction(async () => {
    if (intent.kind === 'single') await call('publications.create', { channelId: intent.channelId, draft: input })
    else if (intent.kind === 'group') await call('postGroups.create', { productId, channelIds: intent.channelIds, draft: input })
    else return
    setForm(emptyForm(true))
    setPicked(null)
    onCreated(intent.kind === 'single' ? intent.channelId : channelId)
  })
  const empty = !input.text && !input.title && !input.link && (input.attachments?.length ?? 0) === 0
  const reason = empty ? 'Write a title, a text or a link first.' : intent.kind === 'none' ? intent.reason : null

  return (
    <Card title="New publication">
      <div className="review-body">
        <PostDrafter productId={productId} channelId={channelId} form={form} onChange={setForm} />
        <DraftEditor form={form} onChange={setForm} withTitle disabled={creating.busy} draft={null} autoFocus ai={{ channelId }} post={{ productId, platform, author, reads }} />
        <WhereToPost
          heading="Where to post"
          note="Tick every channel this post should go to. Nothing is ticked for you but the channel you are on; “Suggested” only marks a channel the post fits."
          rows={rows}
          loading={options.loading}
          error={options.error}
          chosen={chosen}
          onToggle={(id) => setPicked(toggled(chosen, id))}
          disabled={creating.busy}
          alone="This product has no other channel that can post. Connect another one to write a post for several channels."
        />
        <ErrorNote error={creating.error} />
        <div className="form-actions">
          {reason && (
            <span className="muted small" data-testid="create-publication-reason">
              {reason}
            </span>
          )}
          <Button onClick={onCancel} disabled={creating.busy}>
            Cancel
          </Button>
          <Button variant={saveVariant} onClick={() => void create()} disabled={creating.busy || empty || intent.kind === 'none'} data-testid="create-publication">
            {saveLabel(intent)}
          </Button>
        </div>
      </div>
    </Card>
  )
}
