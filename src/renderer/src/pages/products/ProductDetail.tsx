import { useState } from 'react'
import type { Id } from '../../../../shared/types'
import { useEvents, useQuery } from '../../hooks'
import { EmptyState, ErrorNote, Loading } from '../../ui'
import { AnalysisTab } from './AnalysisTab'
import { GoalTab } from './GoalTab'
import { PassportTab } from './PassportTab'
import { ProductHeader } from './ProductHeader'
import { SourcesTab } from './SourcesTab'

type TabId = 'sources' | 'passport' | 'analysis' | 'goal'

const TABS: { id: TabId; label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'passport', label: 'Passport' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'goal', label: 'Goal' }
]

export function ProductDetail({ productId, onDeleted }: { productId: Id; onDeleted: () => void }) {
  const [tab, setTab] = useState<TabId>('sources')
  const passport = useQuery('passport.get', { productId }, ['products', 'passport'])
  // Stage progress arrives as its own event while the analysis runs; reload so the stages and the product status stay current.
  useEvents((event) => {
    if (event.type === 'analysis' && event.productId === productId) passport.reload()
  })

  const view = passport.data
  if (!view) {
    return passport.error ? <ErrorNote error={passport.error} /> : <Loading what="Loading product" />
  }

  return (
    <div className="stack" data-testid="product-detail">
      <ProductHeader product={view.product} onDeleted={onDeleted} />
      <div className="tabs" role="tablist" aria-label="Product sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} data-testid={`product-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      <ErrorNote error={passport.error} />
      {tab === 'sources' && <SourcesTab view={view} />}
      {tab === 'passport' && <PassportTab view={view} />}
      {tab === 'analysis' && <AnalysisTab view={view} />}
      {tab === 'goal' && <GoalTab product={view.product} />}
    </div>
  )
}

export function NothingSelected() {
  return (
    <EmptyState title="Select a product">
      Pick a product to see its sources, passport, analysis and goal, or add a new one.
    </EmptyState>
  )
}
