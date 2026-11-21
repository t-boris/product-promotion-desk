// What the AI helps of the quick-post composer are given (REQ-004). The composer (or the screen that holds it) owns the post; a help only proposes,
// and changes the post through these callbacks when the owner presses to use what it proposed. Nothing here saves, approves or sends anything.

import type { QuickCard } from '../../../../../../shared/quick-post'
import type { Id } from '../../../../../../shared/types'

/**
 * What the picture of the post is now, as far as a help can use it:
 *   card          the app draws it from a headline; the AI proposes the headline, the style and the colour;
 *   illustration  the owner's own picture is to be made by the AI from a description; the AI proposes the description;
 *   file          a picture the owner chose or made: the AI cannot change it, and the marketer is told only that it exists;
 *   none          nothing for the AI to propose for yet.
 */
export type QuickPictureSource = 'card' | 'illustration' | 'file' | 'none'

/** What every help knows of the post. */
export interface QuickAiPost {
  productId: Id
  /** The channel the post is for when it is one (the first ticked): its style and languages steer a help, and the search runs in its account's browser. */
  channelId: Id | null
  /** The platform whose form is the tightest of the channels ticked (so one caption fits them all); null while no channel is ticked. */
  platform: string | null
  caption: string
  /** The angle the owner chose from the trends ('' when none): it steers the caption and the picture, and the owner sees it where it is used. */
  angle: string
  /** The form is busy with something else (saving): a help waits, and an answer that arrives meanwhile is not put in. */
  disabled: boolean
}

/** The help with the caption: writes it from nothing, or improves what is there. */
export interface QuickCaptionAiProps extends QuickAiPost {
  /** The headline the card shows now; '' when the picture is not a card. The caption goes with it and does not repeat it. */
  headline: string
  onCaption: (caption: string) => void
}

/** What the picture help may change: the card's headline and look, or an illustration's description. */
export interface QuickPictureAiProps extends QuickAiPost {
  source: QuickPictureSource
  /** The card as it is now (the owner's headline once they edited it, otherwise the caption's first line); null when the picture is not a card. */
  card: QuickCard | null
  /** The description the illustration will be made from ('' when none yet). */
  illustrationWish: string
  /**
   * Sets the card's headline; `null` makes the headline follow the caption again (as before the owner edited it). `look` sets the style and the
   * colour with it. Undo calls it again with what was there before.
   */
  onHeadline: (headline: string | null, look?: { style?: QuickCard['style']; colour?: QuickCard['colour'] }) => void
  onIllustrationWish: (description: string) => void
}

/** The search for what is talked about now, in the AI browser of the channel's account. */
export interface QuickTrendsProps extends QuickAiPost {
  /** The owner chose an angle from the topics (or edited it); '' clears it. */
  onAngle: (angle: string) => void
}

/** The marketer: reads the caption and the picture against the promotion goal in the approved knowledge, and offers changes the owner may apply. */
export interface QuickMarketerProps extends QuickAiPost {
  source: QuickPictureSource
  card: QuickCard | null
  illustrationWish: string
  onCaption: (caption: string) => void
  onHeadline: QuickPictureAiProps['onHeadline']
}
