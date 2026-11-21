import { moreLabel } from '../list-paging'
import { Button } from '../ui'

/** Under a long list: how much is shown and the button that shows more. Nothing when the whole list is shown. */
export function ShowMore({ hidden, total, onMore, testId = 'show-more' }: { hidden: number; total: number; onMore: () => void; testId?: string }) {
  if (hidden <= 0) return null
  return (
    <div className="show-more" data-testid={testId}>
      <span className="muted small">
        Showing {total - hidden} of {total}
      </span>
      <Button variant="secondary" onClick={onMore} data-testid={`${testId}-button`}>
        {moreLabel(hidden)}
      </Button>
    </div>
  )
}
