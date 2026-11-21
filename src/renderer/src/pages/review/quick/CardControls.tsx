import { useId } from 'react'
import { CARD_COLOURS, CARD_SHAPES, CARD_STYLES, CARD_PIXELS, type CardColour, type CardShape, type CardStyle } from '../../../../../shared/quick-post'
import { Button, SegmentedControl } from '../../../ui'
import { CARD_PALETTES } from './card-colours'
import { drawnCard, followCaption, withColour, withHeadline, withShape, withStyle, type QuickForm } from './quick-form'

const STYLE_LABELS: Record<CardStyle, string> = { bold: 'Bold', quote: 'Quote', minimal: 'Minimal' }
const SHAPE_LABELS: Record<CardShape, string> = { square: 'Square', portrait: 'Portrait', wide: 'Wide' }
const SHAPE_RATIOS: Record<CardShape, string> = { square: '1:1', portrait: '4:5', wide: '1.91:1' }

/**
 * What the owner chooses for the card, by clicks and one field: the headline, the style, the colour, the shape. The card is drawn again at every
 * change (the picture beside shows it), so nothing needs saving to see it. The headline follows the first line of the caption until the owner
 * writes in this field; "Use the caption" gives it back.
 */
export function CardControls({ form, onChange, disabled }: { form: QuickForm; onChange: (change: (form: QuickForm) => QuickForm) => void; disabled: boolean }) {
  const id = useId()
  const headline = drawnCard(form).headline
  const own = form.card.headlineEdited
  const colourName = `${id}-colour`
  return (
    <div className="quick-card-controls" data-testid="quick-card-controls">
      <div className="field">
        <label className="field-label" htmlFor={`${id}-headline`}>
          Headline on the card
        </label>
        <div className="quick-headline-row">
          <input
            id={`${id}-headline`}
            className="input"
            value={headline}
            disabled={disabled}
            onChange={(e) => onChange((current) => withHeadline(current, e.target.value))}
            aria-describedby={`${id}-headline-note`}
            data-testid="quick-headline"
          />
          {own && (
            <Button variant="quiet" onClick={() => onChange(followCaption)} disabled={disabled} data-testid="quick-headline-follow">
              Use the caption
            </Button>
          )}
        </div>
        <span className="hint" id={`${id}-headline-note`} data-testid="quick-headline-note">
          {own ? 'This headline is yours: it stays when the caption changes.' : 'Follows the first line of the caption until you change it here.'}
        </span>
      </div>
      <div className="quick-card-row">
        <div className="quick-control">
          <span className="field-label">Style</span>
          <SegmentedControl<CardStyle> label="Style" name={`${id}-style`} options={CARD_STYLES.map((value) => ({ value, label: STYLE_LABELS[value] }))} value={form.card.style} onChange={(style) => onChange((current) => withStyle(current, style))} disabled={disabled} testIdPrefix="quick-style-" />
        </div>
        <div className="quick-control">
          <span className="field-label">Shape</span>
          <SegmentedControl<CardShape>
            label="Shape"
            name={`${id}-shape`}
            options={CARD_SHAPES.map((value) => ({ value, label: `${SHAPE_LABELS[value]} ${SHAPE_RATIOS[value]}` }))}
            value={form.card.shape}
            onChange={(shape) => onChange((current) => withShape(current, shape))}
            disabled={disabled}
            testIdPrefix="quick-shape-"
          />
        </div>
      </div>
      <div className="quick-control">
        <span className="field-label">Colour</span>
        <div className="quick-colours" role="radiogroup" aria-label="Colour">
          {CARD_COLOURS.map((colour: CardColour) => (
            <label key={colour} className={`quick-swatch${form.card.colour === colour ? ' on' : ''}${disabled ? ' off' : ''}`} title={CARD_PALETTES[colour].label}>
              <input type="radio" name={colourName} checked={form.card.colour === colour} disabled={disabled} onChange={() => onChange((current) => withColour(current, colour))} aria-label={CARD_PALETTES[colour].label} data-testid={`quick-colour-${colour}`} />
              <span className="quick-swatch-chip" style={{ background: `linear-gradient(135deg, ${CARD_PALETTES[colour].stops[0]}, ${CARD_PALETTES[colour].stops[2]})` }} aria-hidden="true" />
            </label>
          ))}
          <span className="muted small quick-card-size" data-testid="quick-card-size">
            {CARD_PIXELS[form.card.shape].width} × {CARD_PIXELS[form.card.shape].height} pixels
          </span>
        </div>
      </div>
    </div>
  )
}
