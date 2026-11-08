import type { ResultsView } from '../../../../shared/types'
import { productHref } from '../../route'
import { Card, EmptyState } from '../../ui'

/** The promotion goals are read-only here; they are edited on the product's Goal tab. */
export function GoalsCard({ goals }: { goals: ResultsView['goals'] }) {
  const only = goals.length === 1 ? goals[0] : null
  return (
    <Card title="Promotion goals" actions={<a href={productHref(only?.productId, 'goal')} data-testid="goals-edit-link">Edit on the Goal tab</a>}>
      {goals.length === 0 && <EmptyState title="Product not found">This product has no goals to show.</EmptyState>}
      <div className="stack">
        {goals.map(({ productId, productName, goals: productGoals }) => (
          <div key={productId} className="list-row stacked" data-testid={`goal-${productId}`}>
            <strong>{productName}</strong>
            {productGoals.length === 0 ? (
              <div className="muted">No promotion goals set. <a href={productHref(productId, 'goal')}>Add one on the Goal tab.</a></div>
            ) : (
              productGoals.map((goal) => (
                <div key={goal.id} className="goal-line" data-testid={`goal-line-${goal.id}`}>
                  <div>{goal.targetAction}</div>
                  {goal.successMetrics.length > 0 && <div className="muted small">Success measured by: {goal.successMetrics.join(', ')}</div>}
                  {goal.notes && <div className="muted small">{goal.notes}</div>}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
