import type { ReactNode } from 'react'
import type { Id, PassportView } from '../../../../shared/types'
import { useEvents, useQuery } from '../../hooks'
import { ErrorNote, Loading } from '../../ui'
import { launchStages, type LaunchCounts, type LaunchStage } from './launch-path'
import { LaunchStagesScope, useLaunchCounts } from './LaunchPath'

/** What a screen of one product knows about it: the product with its passport, and where it stands on the launch path. */
export interface ProductFacts {
  view: PassportView
  stages: LaunchStage[]
  /** The product's channels and approved publications. */
  counts: LaunchCounts
}

/**
 * Loads one product's passport and launch path and gives them to its screen. The screens of the product that sit on the path (Setup,
 * Channels, Overview) read the path from here: it decides which of them holds the filled button and where the others point
 * (`useTabAccent`, BUG-065). Waits for the channel and publication counts too, or a launched product would be told to connect a channel
 * for a moment.
 */
export function ProductScope({ productId, children }: { productId: Id; children: (facts: ProductFacts) => ReactNode }) {
  const passport = useQuery('passport.get', { productId }, ['products', 'passport'])
  // Stage progress arrives as its own event while the analysis runs; reload so the stages and the product status stay current.
  useEvents((event) => {
    if (event.type === 'analysis' && event.productId === productId) passport.reload()
  })
  const { countsOf, loaded } = useLaunchCounts()

  const view = passport.data
  if (!view || !loaded) {
    return passport.error ? <ErrorNote error={passport.error} /> : <Loading what="Loading product" />
  }
  const counts = countsOf(productId)
  const stages = launchStages(productId, { hasSources: view.sources.length > 0, passportApproved: view.product.activePassportVersionId !== null, goals: view.product.goals.length, ...counts })
  return (
    <LaunchStagesScope stages={stages}>
      <ErrorNote error={passport.error} />
      {children({ view, stages, counts })}
    </LaunchStagesScope>
  )
}
