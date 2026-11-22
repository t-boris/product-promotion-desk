import { useCurrentProduct } from '../product-context'
import { AddChannelButton, ChannelsPanel } from './channels/ChannelsPanel'
import { ProductScreen } from './ProductScreen'

/** The channels of the current product, as a list with the open channel (or the add-a-channel flow) beside it (DEC-009, DEC-037). */
export function ChannelsPage() {
  const { current } = useCurrentProduct()
  return (
    <ProductScreen title="Channels" subtitle="Where the product is promoted" tab="channels" fill nextStage={false} actions={current ? <AddChannelButton productId={current.id} /> : undefined}>
      {(product) => <ChannelsPanel productId={product.id} />}
    </ProductScreen>
  )
}
