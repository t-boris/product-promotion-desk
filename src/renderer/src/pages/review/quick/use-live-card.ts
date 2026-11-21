// The card as a small picture on the screen (REQ-003): drawn again whenever the card would look different, by the same function that draws the
// PNG that is saved. The page may show only data addresses, so the picture is one.

import { useMemo } from 'react'
import { cardAltText } from './preview-model'
import { cardDataUrl } from './card-canvas'
import { cardSignature, drawnCard, isCardPicture, type QuickForm } from './quick-form'
import type { LivePicture } from '../PostPreview'

/** How wide the small card is drawn: twice what the screen shows it at, so it stays sharp on a Retina display. */
const LIVE_WIDTH = 720

/** The card of the form as a picture, or null while the picture is the owner's own. */
export function useLiveCard(form: QuickForm): LivePicture | null {
  const card = drawnCard(form)
  const signature = cardSignature(card)
  const isCard = isCardPicture(form)
  const alt = cardAltText(form)
  return useMemo(() => {
    if (!isCard) return null
    try {
      return { url: cardDataUrl(card, LIVE_WIDTH), alt }
    } catch {
      // A window with no canvas draws nothing; the post can still be saved and the card is drawn when it is.
      return null
    }
    // The card is rebuilt from its signature: the same look is never drawn twice.
  }, [signature, isCard, alt])
}
