import type { ResultsView } from '../../../../shared/types'
import { productHref } from '../../route'
import { Card, EmptyState } from '../../ui'

/** The promotion goal is read-only here; it is edited on the product's Goal tab. */
export function GoalsCard({ goals }: { goals: ResultsView['goals'] }) {
  const only = goals.length === 1 ? goals[0] : null
  return (
    <Card title={only ? 'Promotion goal' : 'Promotion goals'} actions={<a href={productHref(only?.productId, 'goal')} data-testid="goals-edit-link">Edit on the Goal tab</a>}>
      {goals.length === 0 && <EmptyState title="Product not found">This product has no goal to show.</EmptyState>}
      <div className="stack">
        {goals.map(({ productId, productName, goal }) => (
          <div key={productId} className="list-row" data-testid={`goal-${productId}`}>
            <div>
              <strong>{productName}</strong>
              {goal ? (
                <>
                  <div>{goal.targetAction || <span className="muted">No target action set</span>}</div>
                  {goal.successMetrics.length > 0 && <div className="muted small">Success measured by: {goal.successMetrics.join(', ')}</div>}
                  {goal.notes && <div className="muted small">{goal.notes}</div>}
                </>
              ) : (
                <div className="muted">No promotion goal set. <a href={productHref(productId, 'goal')}>Set one on the Goal tab.</a></div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
