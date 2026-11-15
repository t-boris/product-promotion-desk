import { useCurrentProduct } from '../product-context'
import { parseSetupHash, setupHref } from '../route'
import { useHash } from '../use-hash'
import { OpenFormsScope, Page } from '../ui'
import { NoProduct } from './ProductScreen'
import { CreateProduct } from './products/CreateProduct'
import './products/products.css'
import { SetupBody } from './setup/SetupBody'

const WHAT = 'Sources, the verified passport, analysis and goal'

/**
 * What is configured once for the current product: its sources, passport, analysis and goal, as the vertical stepper of its launch path (DEC-037, phase C4). The form
 * that makes a product is opened here (`#/setup/new`, from the product switcher), above the product that is open.
 */
export function SetupPage() {
  const { current, loading, error, setCreated } = useCurrentProduct()
  const { tab, creating } = parseSetupHash(useHash())

  return (
    // One scope for the page: the "New product" form and the forms of the open product (edit details, a statement, a source) each own
    // the filled button while open, and the resting main action of the product's tab steps back.
    <OpenFormsScope>
      <Page title="Setup" subtitle={current ? `${current.name} · ${WHAT}` : WHAT}>
        {creating && (
          <CreateProduct
            onCreated={(product) => {
              // The new product is the current one at once, before the list holds it, and its first step is its sources.
              setCreated(product.id)
              window.location.hash = setupHref('sources')
            }}
            onCancel={() => (window.location.hash = setupHref())}
          />
        )}
        {!creating && !current && <NoProduct loading={loading} error={error} />}
        {current && <SetupBody key={current.id} productId={current.id} tab={tab} onDeleted={() => (window.location.hash = setupHref())} />}
      </Page>
    </OpenFormsScope>
  )
}
