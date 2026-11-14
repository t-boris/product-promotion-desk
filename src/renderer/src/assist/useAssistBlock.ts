// The one answer to "can the AI help here?" for a screen: the reason it cannot, with the link that fixes it, and the engine's name.

import { useQuery } from '../hooks'
import { assistBlock, type Blocked } from './block'

export function useAssistBlock(options: { productId?: string; needsPassport?: boolean } = {}): { blocked: Blocked | null; engineLabel: string | undefined } {
  const needsPassport = options.needsPassport ?? false
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const product = options.productId ? products.data?.find((p) => p.id === options.productId) : undefined
  const blocked = assistBlock({
    productId: options.productId,
    needsPassport,
    approved: needsPassport ? (product ? product.activePassportVersionId !== null : null) : true,
    engineId: settings.data?.engineId,
    engines: engines.data,
    ready: !settings.loading && !engines.loading
  })
  return { blocked, engineLabel: engines.data?.find((e) => e.id === settings.data?.engineId)?.label }
}
