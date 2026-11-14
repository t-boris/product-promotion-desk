import { useEffect, useState } from 'react'
import { useQuery } from '../hooks'
import { Button, EmptyState, ErrorNote, Loading, Page } from '../ui'
import { CreateProduct } from './products/CreateProduct'
import { ProductDetail } from './products/ProductDetail'
import { ProductList } from './products/ProductList'
import { useProductRoute } from './products/useProductRoute'
import './products/products.css'

const LAST_PRODUCT_KEY = 'ppd.lastProduct'

/** The product the owner looked at last, if the browser lets the page remember it. */
function readLastProduct(): string | null {
  try {
    return window.localStorage.getItem(LAST_PRODUCT_KEY)
  } catch {
    return null
  }
}

function saveLastProduct(id: string): void {
  try {
    window.localStorage.setItem(LAST_PRODUCT_KEY, id)
  } catch {
    // Remembering is a convenience; without it the first product opens.
  }
}

export function ProductsPage() {
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const { productId, tab, selectProduct, selectTab } = useProductRoute()
  const [creating, setCreating] = useState(false)

  const list = products.data ?? []
  // A product that was deleted (here or elsewhere), or a link to one that does not exist, selects nothing.
  const selected = list.find((p) => p.id === productId)?.id ?? null

  // A product is always open: the one seen last, else the first. A bare `#/products` showed an empty panel and cost a click (QA finding 13).
  useEffect(() => {
    if (!products.data || list.length === 0 || selected) return
    const wanted = readLastProduct()
    selectProduct(list.find((p) => p.id === wanted)?.id ?? list[0].id, tab, true)
  }, [products.data, selected])
  useEffect(() => {
    if (selected) saveLastProduct(selected)
  }, [selected])

  return (
    <Page
      title="Products"
      subtitle="Sources, the verified passport, analysis, goal, channels and results for each product"
      actions={
        <Button variant="primary" onClick={() => setCreating(true)} disabled={creating} data-testid="new-product">
          New product
        </Button>
      }
    >
      <ErrorNote error={products.error} />
      {products.loading && !products.data && <Loading what="Loading products" />}
      {creating && (
        <CreateProduct
          onCreated={(product) => {
            setCreating(false)
            selectProduct(product.id, 'sources')
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {products.data && list.length === 0 && !creating && (
        <EmptyState
          fill
          title="No products yet"
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Add your first product
            </Button>
          }
        >
          A name plus a website address or a short description is enough to start. The app builds a passport from it for you to approve. Nothing is sent anywhere until you approve it.
        </EmptyState>
      )}
      {products.data && list.length > 0 && (
        <div className="products-layout">
          <aside className="products-list">
            <ProductList products={list} selectedId={selected} onSelect={(id) => selectProduct(id)} />
          </aside>
          <div className="products-detail">
            {selected ? <ProductDetail key={selected} productId={selected} tab={tab} onTabChange={selectTab} onDeleted={() => selectProduct(null)} /> : <Loading what="Opening the product" />}
          </div>
        </div>
      )}
    </Page>
  )
}
