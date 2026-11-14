import type { ResultsView } from '../../../../shared/types'
import { productHref } from '../../route'
import { Card, EmptyState, Hint } from '../../ui'

/** The promotion goals are read-only here; they are edited on the product's Goal tab. */
export function GoalsCard({ goals }: { goals: ResultsView['goals'] }) {
  const only = goals.length === 1 ? goals[0] : null
  // Results is the page of one product: its name is already in the header above, so a single product's goals do not repeat it (QA finding 44).
  const showName = goals.length > 1
  return (
    <Card title="Promotion goals" actions={<a href={productHref(only?.productId, 'goal')} data-testid="goals-edit-link">Edit on the Goal tab</a>}>
      {goals.length === 0 && <EmptyState title="Product not found">This product has no goals to show.</EmptyState>}
      <div className="stack">
        {goals.map(({ productId, productName, goals: productGoals }) => (
          <div key={productId} className="list-row stacked" data-testid={`goal-${productId}`}>
            {showName && <strong>{productName}</strong>}
            {productGoals.length === 0 ? (
              <div className="muted">No promotion goals set. <a href={productHref(productId, 'goal')}>Add one on the Goal tab.</a></div>
            ) : (
              productGoals.map((goal) => (
                <div key={goal.id} className="goal-line" data-testid={`goal-line-${goal.id}`}>
                  <div>{goal.targetAction}</div>
                  {goal.successMetrics.length > 0 && <Hint>Success measured by: {goal.successMetrics.join(', ')}</Hint>}
                  {goal.notes && <Hint>{goal.notes}</Hint>}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
