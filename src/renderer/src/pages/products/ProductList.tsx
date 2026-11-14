import type { Id, Product } from '../../../../shared/types'
import { Badge, EmptyState } from '../../ui'
import { ANALYSIS_LABELS, ANALYSIS_TONES } from './labels'
import { launchStages, type LaunchCounts } from './launch-path'
import { LaunchDots } from './LaunchPath'
import { nextProductStep } from './product-status'

export function ProductList({ products, selectedId, countsOf, onSelect }: { products: Product[]; selectedId: string | null; countsOf: (productId: Id) => LaunchCounts; onSelect: (id: string) => void }) {
  if (products.length === 0) return <EmptyState art="product" title="No products yet">Add the first one with the button above.</EmptyState>
  return (
    <div className="stack" data-testid="product-list">
      {products.map((product) => {
        const counts = countsOf(product.id)
        const next = nextProductStep(product, counts)
        // The list has no sources to count; a product is created with one (see LaunchFacts.hasSources).
        const stages = launchStages(product.id, { hasSources: true, passportApproved: product.activePassportVersionId !== null, goals: product.goals.length, ...counts })
        return (
          <div
            key={product.id}
            role="button"
            tabIndex={0}
            className={`list-row stacked selectable product-card ${product.id === selectedId ? 'active' : ''}`}
            aria-current={product.id === selectedId ? 'true' : undefined}
            onClick={() => onSelect(product.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(product.id)
              }
            }}
            data-testid={`product-${product.id}`}
          >
            <div>
              <div className="product-card-head">
                <strong>{product.name}</strong>
                <LaunchDots stages={stages} testId={`launch-dots-${product.id}`} />
              </div>
              <div className="hint">{product.websiteUrl ?? 'No website yet'}</div>
            </div>
            <div className="row">
              <Badge tone={product.activePassportVersionId ? 'good' : 'warn'}>{product.activePassportVersionId ? 'Passport approved' : 'No approved passport'}</Badge>
              {product.analysisStatus !== 'idle' && <Badge tone={ANALYSIS_TONES[product.analysisStatus]}>{ANALYSIS_LABELS[product.analysisStatus]}</Badge>}
            </div>
            {next && (
              <div className="hint" data-testid={`product-next-${product.id}`}>
                {next}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
