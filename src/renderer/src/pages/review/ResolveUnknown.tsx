import { useState } from 'react'
import type { Id } from '../../../../shared/types'
import { Button, Field } from '../../ui'
import type { ReviewActions } from './useReviewActions'

/**
 * For an unknown result the application cannot settle by itself (the platform check keeps failing, or finds
 * nothing and the owner knows better): the owner looks at the platform and says what they saw. Either answer is
 * logged. "Published" closes the item; "not published" sends it back to review, where a new attempt needs a new
 * approval.
 */
export function ResolveUnknown({ id, actions }: { id: Id; actions: ReviewActions }) {
  const [url, setUrl] = useState('')
  return (
    <div data-testid="resolve-unknown">
      <Field label="I checked the platform myself" hint="If it was published, paste the link to it (optional).">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" data-testid="resolve-url" />
      </Field>
      <div className="row">
        <Button onClick={() => void actions.resolveUnknown(id, 'published', url.trim())} disabled={actions.busy} data-testid="resolve-published">
          It was published
        </Button>
        <Button variant="danger" onClick={() => void actions.resolveUnknown(id, 'not_published')} disabled={actions.busy} data-testid="resolve-not-published">
          It was not published
        </Button>
      </div>
    </div>
  )
}
