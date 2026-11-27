import { useQuery } from '../../hooks'
import { analyticsNote } from '../../../../shared/site-visits'
import { Hint, More } from '../../ui'

/**
 * Keeps the page from implying anything about conversions (DEC-002): sign-ups and purchases are not measured. What it says about the site's
 * analytics follows the product's own choice (DEC-073): none, a service the application reads visitors from, or one it does not read.
 */
export function ConversionsNote({ productId }: { productId: string }) {
  const visits = useQuery('visits.get', { productId }, ['products', 'results'])
  return (
    <div className="note" data-testid="conversions-card">
      <strong>Sign-ups and purchases are not measured.</strong>{' '}
      <More label="Why, and what Unavailable means">
        <Hint tone="strong" data-testid="conversions-note">
          Sign-ups, purchases and other events on your own site are not collected. {analyticsNote(visits.data)} Under each channel only the metrics its platform provides are shown. A metric marked Unavailable was not provided by the platform; that is different from zero.
        </Hint>
      </More>
    </div>
  )
}
