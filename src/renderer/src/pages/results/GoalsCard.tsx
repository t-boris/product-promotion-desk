import type { ResultsView } from '../../../../shared/types'
import { Card, EmptyState } from '../../ui'

/** Promotion goals are read-only here; they are edited on the product page. */
export function GoalsCard({ goals }: { goals: ResultsView['goals'] }) {
  return (
    <Card title="Promotion goals" actions={<a href="#/products" data-testid="goals-edit-link">Edit in Products</a>}>
      {goals.length === 0 && <EmptyState title="No products yet">Add a product and set its promotion goal on the Products page.</EmptyState>}
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
                <div className="muted">No promotion goal set. <a href="#/products">Set one on the Products page.</a></div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
