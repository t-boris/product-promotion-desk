// What the live preview of the composer shows (REQ-002): the post as the form holds it now, in the layout of one of the channels ticked. Pure;
// the sketches themselves are `PostPreview`, which reads this.

import type { PostContent } from '../../../../../shared/post-format'
import { drawnCard, isCardPicture, quickInput, type QuickForm } from './quick-form'

/** The platform the preview shows: the one the owner picked while it is still among the channels ticked, else the first of them. Null with nothing ticked. */
export function previewPlatformOf(picked: string | null, platforms: readonly string[]): string | null {
  if (picked !== null && platforms.includes(picked)) return picked
  return platforms[0] ?? null
}

/**
 * The post as the preview reads it. While the picture is the card it is not saved yet, so the preview gets the card to draw as a picture
 * without a library id (`live`); `PostPreview` draws that picture from the card as it is on the screen now.
 */
export function previewContent(form: QuickForm): { content: PostContent; live: boolean } {
  const input = quickInput(form)
  return {
    content: { title: null, text: input.text, link: input.link ?? null, attachments: input.attachments ?? [], markup: 'legacy', postType: 'quick' },
    live: isCardPicture(form)
  }
}

/** The headline the live card carries, for a name on the picture when it is described to a screen reader. */
export const cardAltText = (form: QuickForm): string => {
  const headline = drawnCard(form).headline.trim()
  return headline === '' ? 'The card, with no headline yet' : `The card: ${headline}`
}
