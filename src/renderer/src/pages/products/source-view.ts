// How a source is shown in the Sources tab. Pure, so the rules are tested without the interface.

import type { ProductSource } from '../../../../shared/types'

// The rule is shared with the core, which refuses to edit a mirrored source (BUG-034).
export { isMirroredSource } from '../../../../shared/sources'

/** A text source is read as sentences (the interface font, wraps at words); an address or a path is a code-like string. */
export const isProse = (source: Pick<ProductSource, 'kind'>): boolean => source.kind === 'text'
