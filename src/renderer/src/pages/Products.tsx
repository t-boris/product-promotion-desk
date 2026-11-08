import { useState } from 'react'
import { useQuery } from '../hooks'
import { Button, ErrorNote, Loading, Page } from '../ui'
import { CreateProduct } from './products/CreateProduct'
import { NothingSelected, ProductDetail } from './products/ProductDetail'
import { ProductList } from './products/ProductList'
import { useProductRoute } from './products/useProductRoute'
import './products/products.css'

export function ProductsPage() {
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const { productId, tab, selectProduct, selectTab } = useProductRoute()
  const [creating, setCreating] = useState(false)

  const list = products.data ?? []
  // A product that was deleted (here or elsewhere), or a link to one that does not exist, selects nothing.
  const selected = list.find((p) => p.id === productId)?.id ?? null

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
      {products.data && (
        <div className="products-layout">
          <aside className="products-list">
            <ProductList products={list} selectedId={selected} onSelect={(id) => selectProduct(id)} />
          </aside>
          <div className="products-detail">
            {selected ? <ProductDetail key={selected} productId={selected} tab={tab} onTabChange={selectTab} onDeleted={() => selectProduct(null)} /> : <NothingSelected />}
          </div>
        </div>
      )}
    </Page>
  )
}
