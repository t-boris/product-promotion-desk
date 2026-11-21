import { useId, type ReactNode } from 'react'
import { captionCounter } from './limits'

/**
 * The caption of a quick post: one text field, and under it the count against the tightest limit of the channels chosen, shown while typing and
 * said in words once it is passed. `extras` is the place beside the label for the AI's help with the caption (REQ-004): the composer gives it the
 * caption and a way to change it, and nothing else is decided here.
 */
export function CaptionField({
  value,
  onChange,
  platforms,
  disabled,
  autoFocus = false,
  extras
}: {
  value: string
  onChange: (caption: string) => void
  /** The platform of each channel the post goes to: the limit shown is the tightest of them. */
  platforms: readonly string[]
  disabled: boolean
  autoFocus?: boolean
  extras?: ReactNode
}) {
  const id = useId()
  const counter = captionCounter(value, platforms)
  const counterId = `${id}-count`
  return (
    <div className="field quick-caption-field" data-testid="quick-caption-field">
      <div className="field-head">
        <label className="field-label" htmlFor={id}>
          Caption
        </label>
        {extras}
      </div>
      {/* `draft-text` is what "Edit the text" of the approval check puts the cursor in. */}
      <textarea
        id={id}
        className="input draft-text quick-caption"
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={6}
        aria-describedby={counterId}
        aria-invalid={counter.over || undefined}
        onChange={(e) => onChange(e.target.value)}
        data-testid="quick-caption"
      />
      <div className="quick-caption-foot">
        <span id={counterId} className={`quick-counter${counter.over ? ' over' : ''}`} data-testid="quick-counter" data-over={counter.over}>
          {counter.label}
        </span>
        {counter.whose && (
          <span className="muted small" data-testid="quick-counter-whose">
            {counter.whose}
          </span>
        )}
      </div>
    </div>
  )
}
