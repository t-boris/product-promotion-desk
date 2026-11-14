import type { Id, Product } from '../../../../shared/types'
import { Badge, EmptyState } from '../../ui'
import { ANALYSIS_LABELS, ANALYSIS_TONES } from './labels'
import { launchStages, type LaunchCounts } from './launch-path'
import { LaunchDots } from './LaunchPath'
import { productLabels } from './product-labels'
import { nextProductStep, websiteHost } from './product-status'

export function ProductList({ products, selectedId, countsOf, onSelect }: { products: Product[]; selectedId: string | null; countsOf: (productId: Id) => LaunchCounts; onSelect: (id: string) => void }) {
  if (products.length === 0) return <EmptyState art="product" title="No products yet">Add the first one with the button above.</EmptyState>
  const labels = productLabels(products)
  return (
    <div className="panel" data-testid="product-list">
      {products.map((product) => {
        const label = labels.get(product.id) ?? product.name
        const counts = countsOf(product.id)
        const next = nextProductStep(product, counts)
        // The list has no sources to count; a product is created with one (see LaunchFacts.hasSources).
        const stages = launchStages(product.id, { hasSources: true, passportApproved: product.activePassportVersionId !== null, goals: product.goals.length, ...counts })
        return (
          <div
            key={product.id}
            role="button"
            tabIndex={0}
            className={`panel-row${product.id === selectedId ? ' active' : ''}`}
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
            <div className="panel-row-top">
              <span className={`panel-row-title${label === product.name ? '' : ' wrap'}`} title={label}>{label}</span>
              <LaunchDots stages={stages} testId={`launch-dots-${product.id}`} />
            </div>
            <div className="panel-row-line" title={product.websiteUrl ?? undefined}>
              {product.websiteUrl ? websiteHost(product.websiteUrl) : 'No website yet'}
            </div>
            {/* The passport and the analysis are in the header and in the next step; only a state worth a glance gets a tag here. */}
            {(product.analysisStatus === 'running' || product.analysisStatus === 'paused' || product.analysisStatus === 'failed') && (
              <div className="row">
                <Badge tone={ANALYSIS_TONES[product.analysisStatus]}>{ANALYSIS_LABELS[product.analysisStatus]}</Badge>
              </div>
            )}
            {next && (
              <div className="panel-row-line wrap" data-testid={`product-next-${product.id}`}>
                {next}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
