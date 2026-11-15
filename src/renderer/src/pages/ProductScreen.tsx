import { Fragment, type ReactNode } from 'react'
import type { Product } from '../../../shared/types'
import { useCurrentProduct } from '../product-context'
import { NEW_PRODUCT_HREF, type ProductTab } from '../route'
import { EmptyState, ErrorNote, Loading, OpenFormsScope, Page } from '../ui'
import { NextStage } from './products/LaunchPath'
import { websiteHost } from './products/product-status'
import { ProductScope } from './products/ProductScope'

/** What a screen of the current product shows while there is none: the list loading, its error, or the way to add the first product. */
export function NoProduct({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <ErrorNote error={error} />
  if (loading) return <Loading what="Loading products" />
  return (
    <EmptyState
      fill
      art="product"
      title="No products yet"
      action={
        <a className="btn btn-primary" href={NEW_PRODUCT_HREF} data-testid="add-first-product">
          Add your first product
        </a>
      }
    >
      A name plus a website address or a short description is enough to start. The app builds a passport from it for you to approve. Nothing is sent anywhere until you approve it.
    </EmptyState>
  )
}

/**
 * A screen that shows the current product's work (DEC-037): the page header names the product, the body is built for it and is
 * rebuilt when another product is chosen, so nothing typed for one product is carried to the next. With a `tab` the screen is a place of
 * the launch path: it reads the path, so that the path decides whether the screen or the next stage holds the filled button.
 */
export function ProductScreen({ title, subtitle, tab, actions, withWebsite = false, children }: { title: string; subtitle: string; tab?: ProductTab; /** The header names the product's website after its name (the Overview does). */ withWebsite?: boolean; /** The page header's buttons and controls (a period, a refresh), on the right. */ actions?: ReactNode; children: (product: Product) => ReactNode }) {
  const { current, loading, error } = useCurrentProduct()
  return (
    // One scope for the page: a form opened on demand owns the screen's filled button while it is open.
    <OpenFormsScope>
      <Page title={title} subtitle={current ? [current.name, withWebsite && current.websiteUrl ? websiteHost(current.websiteUrl) : null, subtitle].filter(Boolean).join(' · ') : subtitle} actions={current ? actions : undefined}>
        {current ? (
          <Fragment key={current.id}>
            {tab ? (
              <ProductScope productId={current.id}>
                {() => (
                  <>
                    <NextStage tab={tab} />
                    {children(current)}
                  </>
                )}
              </ProductScope>
            ) : (
              children(current)
            )}
          </Fragment>
        ) : (
          <NoProduct loading={loading} error={error} />
        )}
      </Page>
    </OpenFormsScope>
  )
}
