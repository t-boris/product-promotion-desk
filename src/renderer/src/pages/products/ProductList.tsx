import type { Product } from '../../../../shared/types'
import { Badge, EmptyState } from '../../ui'
import { ANALYSIS_LABELS, ANALYSIS_TONES } from './labels'
import { nextProductStep } from './product-status'

export function ProductList({ products, selectedId, onSelect }: { products: Product[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (products.length === 0) return <EmptyState title="No products yet">Add the first one with the button above.</EmptyState>
  return (
    <div className="stack" data-testid="product-list">
      {products.map((product) => (
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
            <strong>{product.name}</strong>
            <div className="hint">{product.websiteUrl ?? 'No website yet'}</div>
          </div>
          <div className="row">
            <Badge tone={product.activePassportVersionId ? 'good' : 'warn'}>{product.activePassportVersionId ? 'Passport approved' : 'No approved passport'}</Badge>
            {product.analysisStatus !== 'idle' && <Badge tone={ANALYSIS_TONES[product.analysisStatus]}>{ANALYSIS_LABELS[product.analysisStatus]}</Badge>}
          </div>
          <div className="hint" data-testid={`product-next-${product.id}`}>
            {nextProductStep(product).text}
          </div>
        </div>
      ))}
    </div>
  )
}
