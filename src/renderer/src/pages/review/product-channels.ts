import type { Channel, Id } from '../../../../shared/types'
import { useQuery } from '../../hooks'

const NO_CHANNELS: Channel[] = []

/** The channels of the current product, for the screens that list its work (Feed, Posts). The product is the context, so no filter is offered (DEC-037). */
export function useProductChannels(productId: Id): { channels: Channel[]; ready: boolean; error: string | null } {
  const query = useQuery('channels.list', { productId }, ['channels', 'products'])
  return { channels: query.data ?? NO_CHANNELS, ready: query.data !== undefined, error: query.error }
}
