import type { Id } from '../../../../shared/types'
import { setupHref, type SetupTab } from '../../route'
import { NextStage } from '../products/LaunchPath'
import { ProductHeader } from '../products/ProductHeader'
import { ProductScope } from '../products/ProductScope'
import { SetupStepper } from './SetupStepper'

/**
 * The content of Setup: the product's header, the one filled button for the launch path's next stage (when the open step does not hold it),
 * and the stepper of the four steps. The product's channels and results are screens of their own (DEC-037).
 */
export function SetupBody({ productId, tab, onDeleted }: { productId: Id; tab: SetupTab; onDeleted: () => void }) {
  return (
    <ProductScope productId={productId}>
      {({ view, stages, counts }) => (
        <div className="pane" data-testid="product-detail">
          <ProductHeader view={view} channels={counts.channels} onDeleted={onDeleted} onOpenAnalysis={() => (window.location.hash = setupHref('analysis'))} />
          {/* The path decides which step holds the filled button; every other one points at the path's next stage (BUG-065). */}
          <NextStage tab={tab} />
          <SetupStepper view={view} stages={stages} open={tab} />
        </div>
      )}
    </ProductScope>
  )
}
