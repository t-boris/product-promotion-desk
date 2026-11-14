// The one answer to "can the AI help here?" for a screen: the reason it cannot, with the link that fixes it, and the engine's name.

import { useQuery } from '../hooks'
import { assistBlock, type Blocked } from './block'

export function useAssistBlock(options: { productId?: string; needsPassport?: boolean; engineReady?: boolean } = {}): { blocked: Blocked | null; engineLabel: string | undefined } {
  const needsPassport = options.needsPassport ?? false
  const engineReady = options.engineReady ?? true
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  // Only what the answer needs is asked: the engines (their check starts each program) when the engine must be ready, the products when the passport matters.
  const engines = useQuery('engines.list', undefined, ['settings'], { skip: !engineReady })
  const products = useQuery('products.list', undefined, ['products', 'passport'], { skip: !needsPassport })
  const product = options.productId ? products.data?.find((p) => p.id === options.productId) : undefined
  const blocked = assistBlock({
    productId: options.productId,
    needsPassport,
    approved: needsPassport ? (product ? product.activePassportVersionId !== null : null) : true,
    engineId: settings.data?.engineId,
    engines: engines.data,
    ready: !settings.loading && !engines.loading,
    checkReady: engineReady
  })
  return { blocked, engineLabel: engines.data?.find((e) => e.id === settings.data?.engineId)?.label }
}
