import { ChannelsPanel } from './channels/ChannelsPanel'
import { ProductScreen } from './ProductScreen'

/** The channels of the current product and the accounts it works with (DEC-009, DEC-015, DEC-037). */
export function ChannelsPage() {
  return (
    <ProductScreen title="Channels" subtitle="Where the product is promoted, and the accounts it uses" tab="channels">
      {(product) => <ChannelsPanel productId={product.id} />}
    </ProductScreen>
  )
}
