import { useEffect, useState } from 'react'
import { siteLinkFor } from '../../../../shared/post-format'
import { postTypeOfPlatform } from '../../../../shared/quick-post'
import { hasTopicField } from '../../../../shared/topic-tag'
import type { GroupChannelOption, Id, IsoTime } from '../../../../shared/types'
import { call, useAction, useQuery } from '../../hooks'
import { Button, Card, ErrorNote, useOpenForm } from '../../ui'
import { DraftEditor, emptyForm, toInput, type DraftForm } from './DraftEditor'
import { PostDrafter } from './PostDrafter'
import { PostFromMaterial } from './PostFromMaterial'
import type { PostAuthor } from './PostPreview'
import { saveIntent, saveLabel, toggled, whereRows } from './post-group'
import { WhereToPost, useChannelOptions } from './WhereToPost'
import { plannedTimeNote } from '../posts/planned-note'
import { blockedChannels, chosenPlatforms, kindOfChannels } from './quick/kinds'
import { QuickComposer } from './quick/QuickComposer'
import { QUICK_SLOTS } from './quick/quick-slots'
import { emptyQuickForm, isCardPicture, quickInput, quickQuestion, quickReason, type QuickForm } from './quick/quick-form'
import { savePlan, saveReason } from './quick/save-plan'
import { storeCard } from './quick/store-card'

/**
 * Write a post by hand for one channel, or for several (DEC-032). It is saved as a draft (a version for each channel): nothing is
 * published until it is approved. `onCreated` says which channel the post is for, so the screen can show it.
 *
 * The form follows the channels ticked (REQ-001): Instagram, Threads and Facebook make a picture post (a caption and one picture, with the card the
 * app draws as the default), every other channel an article (a title, the text, pictures in it). The two are never ticked together, so the other
 * kind's channels are off, with the reason, while one kind is ticked; with nothing ticked the article form shows and every channel is offered.
 * Each kind keeps what was typed in it while the form is open, so ticking the other kind and coming back loses nothing.
 */
export function PublicationForm({ productId, channelId, platform, reads, author, plannedAt = null, onCreated, onCancel }: { productId: Id; channelId: Id; platform: string; reads: boolean; author: PostAuthor; /** The time the post is planned for when it was started from a day of the calendar; the draft is saved with it. */ plannedAt?: IsoTime | null; /** `note` says what could not be done beside saving (a time a channel cannot take). */ onCreated: (channelId: Id, note?: string) => void; onCancel: () => void }) {
  // The form is open on demand, so "Save as draft" is the screen's filled button while it is the form opened last.
  const saveVariant = useOpenForm()
  // One form for each kind of post; the channels ticked decide which one is shown.
  const [form, setForm] = useState<DraftForm>(emptyForm(true))
  const [typed, setQuick] = useState<QuickForm>(emptyQuickForm())
  const products = useQuery('products.list', undefined, ['products'])
  // The channel the screen is on is ticked until the owner ticks anything; nothing else is ticked for them.
  const [picked, setPicked] = useState<Id[] | null>(null)
  const chosen = picked ?? [channelId]
  // The platform of every channel, from the last answer of the core: the kind is known before the next answer comes (the question depends on the kind).
  const [known, setKnown] = useState<GroupChannelOption[] | undefined>(undefined)
  const own = { channelId, platform }
  const platforms = chosenPlatforms(known, chosen, own)
  const kind = kindOfChannels(platforms)
  // The preview can also look at the post as the product's other connected channels of the same kind (nothing is sent to them): Threads next to Instagram.
  const lookAlso = [...new Set([own.platform, ...(known ?? []).map((row) => row.platform)])].filter((p) => postTypeOfPlatform(p) === kind)
  // A new picture post ends with the product's site, as the core writes it into the first draft (DEC-044): the preview and the limits count it already.
  const product = products.data?.find((p) => p.id === productId)
  // With the tags on, the address names the channel it stands on: the preview shows the first ticked channel's, as the core writes each version its own.
  const firstTarget = chosen[0] === undefined || chosen[0] === channelId ? author.target : (known?.find((row) => row.channelId === chosen[0])?.target ?? author.target)
  const siteLink = product && platforms.length > 0 ? siteLinkFor(platforms[0]!, product, firstTarget) : null
  const quick: QuickForm = typed.link === null && siteLink ? { ...typed, link: siteLink } : typed
  // A topic is sent only when one of the chosen channels has a field for it (Threads): for the others it would be a part of the post nothing can type.
  const whole = toInput(form, true)
  const input = platforms.some(hasTopicField) ? whole : { ...whole, topicTag: null }
  const options = useChannelOptions(productId, kind === 'quick' ? quickQuestion(quick) : input)
  useEffect(() => {
    if (options.data) setKnown(options.data)
  }, [options.data])
  const rows = whereRows(options.data, chosen, { channelId, platform, target: author.target, accountLabel: author.name })
  const blocked = blockedChannels(rows, chosen, own)
  const intent = saveIntent(chosen, rows)
  const [create, creating] = useAction(async () => {
    // A card is drawn and stored when the post is saved, not before: nothing is stored for a post that is never saved.
    const draft = kind === 'quick' ? quickInput(quick, isCardPicture(quick) ? await storeCard(productId, quick) : undefined) : input
    const plan = savePlan(intent, productId, draft)
    if (!plan) return
    const made = plan.method === 'publications.create' ? [(await call('publications.create', plan.args)).opportunity.id] : (await call('postGroups.create', plan.args)).versions.map((v) => v.card.opportunity.id)
    // A time chosen on the calendar goes on every version the channel can take; a refusal is reported, the draft stays.
    const refused: string[] = []
    if (plannedAt) {
      for (const id of made) {
        try {
          await call('publications.schedule', { id, at: plannedAt })
        } catch (error) {
          refused.push(error instanceof Error ? error.message : String(error))
        }
      }
    }
    setForm(emptyForm(true))
    setQuick(emptyQuickForm())
    setPicked(null)
    onCreated(intent.kind === 'single' ? intent.channelId : channelId, plannedTimeNote(made.length, refused))
  })
  const empty = !input.text && !input.title && !input.link && (input.attachments?.length ?? 0) === 0
  const reason = kind === 'quick' ? saveReason(quick, intent) : empty ? 'Write a title, a text or a link first.' : intent.kind === 'none' ? intent.reason : null
  const stopped = kind === 'quick' ? quickReason(quick) !== null : empty

  return (
    <Card title="New publication">
      <div className="review-body">
        {kind === 'quick' ? (
          <QuickComposer {...QUICK_SLOTS} productId={productId} channelId={chosen[0] ?? null} form={quick} onChange={setQuick} platforms={platforms} lookAlso={lookAlso} author={author} disabled={creating.busy} autoFocus={picked === null} />
        ) : (
          <>
            <PostFromMaterial productId={productId} channelId={channelId} form={form} onChange={setForm} />
            <PostDrafter productId={productId} channelId={channelId} form={form} onChange={setForm} />
            <DraftEditor form={form} onChange={setForm} withTitle disabled={creating.busy} draft={null} autoFocus={picked === null} ai={{ channelId }} post={{ productId, platform, author, reads, platforms }} />
          </>
        )}
        <WhereToPost
          heading="Where to post"
          note="Tick every channel this post should go to. Nothing is ticked for you but the channel you are on; “Suggested” only marks a channel the post fits. A picture post (Instagram, Threads, Facebook) and an article cannot go together."
          rows={rows}
          loading={options.loading}
          error={options.error}
          chosen={chosen}
          onToggle={(id) => setPicked(toggled(chosen, id))}
          disabled={creating.busy}
          blocked={blocked}
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
          <Button variant={saveVariant} onClick={() => void create()} disabled={creating.busy || stopped || intent.kind === 'none'} data-testid={kind === 'quick' ? 'quick-save' : 'create-publication'} data-post-type={kind}>
            {saveLabel(intent)}
          </Button>
        </div>
      </div>
    </Card>
  )
}
