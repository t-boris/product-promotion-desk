import { useState } from 'react'
import { useQuery } from '../hooks'
import { Button, ErrorNote, Loading, Page } from '../ui'
import { CreateProduct } from './products/CreateProduct'
import { NothingSelected, ProductDetail } from './products/ProductDetail'
import { ProductList } from './products/ProductList'
import './products/products.css'

export function ProductsPage() {
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const list = products.data ?? []
  // A product that was deleted (here or elsewhere) is no longer selected.
  const selected = list.find((p) => p.id === selectedId)?.id ?? null

  return (
    <Page
      title="Products"
      subtitle="Sources, the verified passport, analysis and promotion goal for each product"
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
            setSelectedId(product.id)
          }}
          onCancel={() => setCreating(false)}
        />
      )}
      {products.data && (
        <div className="products-layout">
          <aside className="products-list">
            <ProductList products={list} selectedId={selected} onSelect={setSelectedId} />
          </aside>
          <div className="products-detail">
            {selected ? <ProductDetail key={selected} productId={selected} onDeleted={() => setSelectedId(null)} /> : <NothingSelected />}
          </div>
        </div>
      )}
    </Page>
  )
}
