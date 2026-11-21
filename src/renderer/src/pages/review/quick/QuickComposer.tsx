import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { CardColour, CardShape, CardStyle } from '../../../../../shared/quick-post'
import type { Draft, Id } from '../../../../../shared/types'
import { useQuery } from '../../../hooks'
import { Badge } from '../../../ui'
import { PostPreview, type PostAuthor } from '../PostPreview'
import { CaptionField } from './CaptionField'
import { PictureSlot } from './PictureSlot'
import { previewChoices, previewContent } from './preview-model'
import { distinctPlatforms } from './kinds'
import { tightestLimit } from './limits'
import { drawnCard, followCaption, isCardPicture, withAngle, withCaption, withHeadline, withIllustrationWish, withLook, type QuickForm } from './quick-form'
import { useLiveCard } from './use-live-card'
import './quick-post.css'

/**
 * What a help of the composer is given to work with (REQ-004): the post as it is, and a way to change the caption and the card. Nothing here saves
 * or sends anything: a help only proposes, and the owner presses to use it. The AI-help components in `quick/ai/` mount in the slots below with it.
 */
export interface QuickSlotContext {
  productId: Id
  /** The channel the post is for when it is one (the first ticked); its own style and languages steer a help. */
  channelId: Id | null
  /** The platform of each channel ticked, and the one whose form is the tightest: a help writes for that one so the caption fits them all. */
  platforms: readonly string[]
  platform: string | null
  form: QuickForm
  caption: string
  /** The headline the card shows now (the owner's, or the caption's first line). */
  headline: string
  /** The card is the picture (not an own picture). */
  cardPicture: boolean
  disabled: boolean
  /** The angle the owner chose from the trends, and the description an illustration is made from: what the helps share, kept with the form. */
  angle: string
  illustrationWish: string
  setAngle: (angle: string) => void
  setIllustrationWish: (description: string) => void
  setCaption: (caption: string) => void
  /** Sets the card's headline as the owner's own; `null` makes it follow the caption again. `look` sets the style and the colour with it (one change, so one undo). */
  setHeadline: (headline: string | null, look?: { style?: CardStyle; colour?: CardColour }) => void
  setLook: (look: { style?: CardStyle; colour?: CardColour; shape?: CardShape }) => void
  /** Any other change of the form, as a function of the form as it is then (a slow answer is applied to the form it finds, never to the one it was asked from). */
  update: Dispatch<SetStateAction<QuickForm>>
}

/**
 * The quick-post composer (REQ-002, REQ-003): one caption, one picture (the card the app draws, or the owner's own), and the post as the chosen
 * channel shows it, live. It holds nothing of its own: the form is the parent's, so the new-post form and the review of a saved post use it the
 * same way, and what is saved is decided there.
 *
 * Slots for the AI's help (REQ-004), all optional and empty when nothing is mounted: `captionExtras` beside the caption's label, `pictureExtras`
 * under the picture, `thinkItThrough` below the preview and the picture (the marketer's read of the whole post, the trends).
 */
export function QuickComposer({
  productId,
  channelId = null,
  form,
  onChange,
  platforms,
  lookAlso = [],
  author,
  reads = false,
  disabled,
  draft = null,
  autoFocus = false,
  captionExtras,
  pictureExtras,
  thinkItThrough
}: {
  productId: Id
  channelId?: Id | null
  form: QuickForm
  onChange: Dispatch<SetStateAction<QuickForm>>
  /** The platform of each channel the post goes to, in the order they were ticked. */
  platforms: readonly string[]
  /** The platforms of the product's other connected channels of the same kind: the preview can look at the post as them too, nothing is sent there. */
  lookAlso?: readonly string[]
  /** Who speaks and where: the sketch names them. */
  author: PostAuthor
  /** The application reads the channel (a connector can post to it). The channels of a quick post are not read, so this is false unless a connector exists. */
  reads?: boolean
  disabled: boolean
  /** The saved draft this form came from, when it is one: who wrote it is said above the fields. */
  draft?: Draft | null
  autoFocus?: boolean
  captionExtras?: (context: QuickSlotContext) => ReactNode
  pictureExtras?: (context: QuickSlotContext) => ReactNode
  thinkItThrough?: (context: QuickSlotContext) => ReactNode
}) {
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const live = useLiveCard(form)
  const { content } = previewContent(form)
  const tight = tightestLimit(platforms).platform ?? platforms[0] ?? null
  const context: QuickSlotContext = {
    productId,
    channelId,
    platforms,
    platform: tight,
    form,
    caption: form.caption,
    headline: drawnCard(form).headline,
    cardPicture: isCardPicture(form),
    disabled,
    angle: form.angle,
    illustrationWish: form.illustrationWish,
    setAngle: (angle) => onChange((current) => withAngle(current, angle)),
    setIllustrationWish: (description) => onChange((current) => withIllustrationWish(current, description)),
    setCaption: (caption) => onChange((current) => withCaption(current, caption)),
    setHeadline: (headline, look) =>
      onChange((current) => {
        const headed = headline === null ? followCaption(current) : withHeadline(current, headline)
        return look ? withLook(headed, look) : headed
      }),
    setLook: (look) => onChange((current) => withLook(current, look)),
    update: onChange
  }
  return (
    <div className="quick-composer" data-testid="quick-composer" data-post-type="quick">
      {draft && (
        <div className="draft-meta">
          <Badge>{draft.author === 'ai' ? 'Prepared by the AI' : 'Written by you'}</Badge>
          {draft.rationale && <span data-testid="draft-rationale">Why: {draft.rationale}</span>}
        </div>
      )}
      <div className="quick-pair">
        <div className="quick-fields">
          <CaptionField value={form.caption} onChange={context.setCaption} platforms={platforms} disabled={disabled} autoFocus={autoFocus} extras={captionExtras?.(context)} />
          <PictureSlot productId={productId} form={form} onChange={onChange} platforms={platforms} live={live} disabled={disabled} extras={pictureExtras?.(context)} />
        </div>
        <div className="quick-side">
          {platforms.length > 0 && (
            <PostPreview
              content={content}
              channelPlatform={platforms[0]}
              platforms={previewChoices(platforms, lookAlso).map((c) => c.platform)}
              ticked={distinctPlatforms(platforms)}
              author={author}
              aiBrowser={settings.data?.publishWith === 'ai_browser' || !reads}
              noConnector={!reads}
              livePicture={live ?? undefined}
              pictureShape={isCardPicture(form) ? form.card.shape : undefined}
            />
          )}
          {thinkItThrough?.(context)}
        </div>
      </div>
    </div>
  )
}
