// Storing the card (REQ-003): the card is drawn at its full size and goes into the picture library like any picture (origin `card`), so the post
// holds an ordinary attachment and everything that sends, shows or approves pictures works on it as it is. The same bytes give the same library
// picture, so a save that was repeated stores nothing twice.

import type { Attachment, Id } from '../../../../../shared/types'
import { call } from '../../../hooks'
import { toAttachment } from '../PostEditorParts'
import { renderCardPng } from './card-canvas'
import { cardFileName, drawnCard, type QuickForm } from './quick-form'

/** Draws the card of the form and stores it in the library of the product; the picture that came back is the one attachment of the post. */
export async function storeCard(productId: Id, form: QuickForm): Promise<Attachment> {
  const card = drawnCard(form)
  const png = await renderCardPng(card, cardFileName(card.headline))
  const item = await call('media.add', { productId, name: png.name, base64: png.base64, origin: 'card', description: card.headline })
  return toAttachment(item)
}
