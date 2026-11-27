import { RECUT_EVERY_DAYS } from '../../../../shared/product-choices'
import { call, useAction, useQuery } from '../../hooks'
import { Card, ErrorNote, Hint } from '../../ui'

/**
 * A week with no time (DEC-071): while it is on, the content mix of this product rests and each channel that has sent a post gets one draft a
 * week that says an earlier post again in a new form. Drafts only: the owner reads and approves each. Reply drafts go on as usual.
 */
export function LowTimeWeek({ productId }: { productId: string }) {
  const choices = useQuery('choices.get', { productId }, ['products', 'channels'])
  const [set, setting] = useAction((on: boolean) => call('choices.set', { productId, lowTime: on }))
  const view = choices.data
  if (!view) return null
  return (
    <Card title="A week with no time">
      <label className="dates-kind">
        <input type="checkbox" checked={view.lowTime} onChange={(e) => void set(e.target.checked)} disabled={setting.busy} data-testid="low-time-switch" /> I have no time now: keep the minimum going
      </label>
      <Hint>
        While this is on, the content mix rests and each channel that has already sent a post gets one draft every {RECUT_EVERY_DAYS} days: an earlier post said again in a new form, with no new fact. It is a draft; nothing goes out until you approve it. Reply drafts go on as usual. Switch it off when you are back.
      </Hint>
      <ErrorNote error={setting.error} />
    </Card>
  )
}
