import { useQuery } from '../../hooks'
import { accountsNewHref } from '../../route'
import { SuggestRoles } from '../channels/SuggestRoles'
import { suggestionBlock } from '../channels/suggestion-block'

/**
 * Role ideas on the new-account form, shown when the form was opened from a product's Channels page: the AI proposes roles and login names from
 * that product's approved passport, and "Use this role" opens the form again with the role filled in. They used to sit on the Channels page, where
 * nothing else was about roles.
 */
export function RoleIdeas({ productId, platform }: { productId: string; platform: string | null }) {
  const products = useQuery('products.list', undefined, ['products', 'passport'])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const product = products.data?.find((p) => p.id === productId)
  const blocked = suggestionBlock({
    productId,
    approved: product ? product.activePassportVersionId !== null : null,
    engineId: settings.data?.engineId,
    engines: engines.data,
    ready: !settings.loading && !engines.loading
  })
  const engineLabel = engines.data?.find((e) => e.id === settings.data?.engineId)?.label
  return (
    <SuggestRoles
      productId={productId}
      blocked={blocked}
      engineLabel={engineLabel}
      onUse={(idea) => (window.location.hash = accountsNewHref({ name: idea.name, voice: idea.voice }, productId, platform ?? undefined))}
    />
  )
}
