import { useId, type ReactNode } from 'react'
import type { Attachment } from '../../../../../shared/types'
import { ViewableImage } from '../../../pictures/ViewableImage'
import { CARD_PICTURE_NAME, drawnPicture } from '../../../pictures/picture-viewer'
import { SegmentedControl } from '../../../ui'
import type { LivePicture } from '../PostPreview'
import { CardControls } from './CardControls'
import { OwnPicture } from './OwnPicture'
import { isCardPicture, chooseCard, choosePicture, withIllustrationWish, type PictureSource, type QuickForm } from './quick-form'

/**
 * The one picture of a quick post. It is the card the app draws from the headline (the default: no AI engine is needed), or a picture of the
 * owner's own (made by the AI, a file, pasted, dropped or from the library). The card is shown here as it is now, at every change; the two
 * sources keep what was set for each, so going back and forth loses nothing. `extras` is the place under the picture for the AI's help with it
 * (REQ-004).
 */
export function PictureSlot({
  productId,
  form,
  onChange,
  platforms,
  live,
  disabled,
  extras
}: {
  productId: string
  form: QuickForm
  onChange: (change: (form: QuickForm) => QuickForm) => void
  platforms: readonly string[]
  /** The card as a picture, drawn from the form as it is now. */
  live: LivePicture | null
  disabled: boolean
  extras?: ReactNode
}) {
  const id = useId()
  const card = isCardPicture(form)
  const source = (next: PictureSource): void => onChange((current) => (next === 'card' ? chooseCard(current) : choosePicture(current)))
  return (
    <section className="quick-picture" aria-labelledby={`${id}-title`} data-testid="quick-picture-slot" data-source={form.source}>
      <div className="quick-picture-head">
        <span className="field-label" id={`${id}-title`}>
          Picture
        </span>
        <SegmentedControl<PictureSource>
          label="Where the picture comes from"
          name={`${id}-source`}
          options={[
            { value: 'card', label: 'Card' },
            { value: 'picture', label: 'Own picture' }
          ]}
          value={form.source}
          onChange={source}
          disabled={disabled}
          testIdPrefix="quick-source-"
        />
      </div>
      {card ? (
        <>
          <div className="quick-card-frame" data-shape={form.card.shape} data-testid="quick-card-frame">
            {live ? <ViewableImage src={live.url} alt={live.alt} picture={drawnPicture(live.url, CARD_PICTURE_NAME, live.alt)} data-testid="quick-card-picture" /> : <span className="muted small">The card is drawn when you save.</span>}
          </div>
          <CardControls form={form} onChange={onChange} disabled={disabled} />
          {extras}
        </>
      ) : (
        <OwnPicture productId={productId} picture={form.picture} caption={form.caption} platforms={platforms} disabled={disabled} onChoose={(picture: Attachment) => onChange((current) => choosePicture(current, picture))} wish={form.illustrationWish} onWish={(wish) => onChange((current) => withIllustrationWish(current, wish))} extras={extras} />
      )}
    </section>
  )
}
