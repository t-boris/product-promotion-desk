import type { Id } from '../../../../shared/types'
import { useEvents, useQuery } from '../../hooks'
import type { ProductTab } from '../../route'
import { ErrorNote, Loading } from '../../ui'
import { ChannelsPanel } from '../channels/ChannelsPanel'
import { ResultsPanel } from '../results/ResultsPanel'
import { AnalysisTab } from './AnalysisTab'
import { GoalTab } from './GoalTab'
import { launchStages, type LaunchCounts } from './launch-path'
import { LaunchPath, LaunchStagesScope, NextStage } from './LaunchPath'
import { PassportTab } from './PassportTab'
import { ProductHeader } from './ProductHeader'
import { SourcesTab } from './SourcesTab'

/** Channels and Results belong to the product (DEC-009), so they are tabs here and not entries of the main menu. */
const TABS: { id: ProductTab; label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'passport', label: 'Passport' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'goal', label: 'Goal' },
  { id: 'channels', label: 'Channels' },
  { id: 'results', label: 'Results' }
]

export function ProductDetail({
  productId,
  tab,
  counts,
  onTabChange,
  onDeleted
}: {
  productId: Id
  tab: ProductTab
  /** The product's channels and approved publications, for the launch path. */
  counts: LaunchCounts
  onTabChange: (tab: ProductTab) => void
  onDeleted: () => void
}) {
  const passport = useQuery('passport.get', { productId }, ['products', 'passport'])
  // Stage progress arrives as its own event while the analysis runs; reload so the stages and the product status stay current.
  useEvents((event) => {
    if (event.type === 'analysis' && event.productId === productId) passport.reload()
  })

  const view = passport.data
  if (!view) {
    return passport.error ? <ErrorNote error={passport.error} /> : <Loading what="Loading product" />
  }

  const stages = launchStages(productId, {
    hasSources: view.sources.length > 0,
    passportApproved: view.product.activePassportVersionId !== null,
    goals: view.product.goals.length,
    ...counts
  })

  return (
    <div className="pane" data-testid="product-detail">
      <ProductHeader view={view} channels={counts.channels} onDeleted={onDeleted} onOpenTab={onTabChange} />
      <LaunchPath stages={stages} />
      <div className="tabs" role="tablist" aria-label="Product sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => onTabChange(t.id)} data-testid={`product-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {/* The path decides which tab holds the filled button; every other tab points at the path's next stage (BUG-065). */}
      <LaunchStagesScope stages={stages}>
        <NextStage tab={tab} />
        <ErrorNote error={passport.error} />
        {tab === 'sources' && <SourcesTab view={view} />}
        {tab === 'passport' && <PassportTab view={view} onOpenAnalysis={() => onTabChange('analysis')} />}
        {tab === 'analysis' && <AnalysisTab view={view} />}
        {tab === 'goal' && <GoalTab product={view.product} onOpenResults={() => onTabChange('results')} />}
        {tab === 'channels' && <ChannelsPanel productId={productId} />}
        {tab === 'results' && <ResultsPanel productId={productId} />}
      </LaunchStagesScope>
    </div>
  )
}
