import type { ComponentProps } from 'react'
import { QuickCaptionAi, QuickMarketer, QuickPictureAi, QuickTrends, type QuickAiPost } from './ai'
import { drawnCard, pictureSourceOf } from './quick-form'
import type { QuickComposer, QuickSlotContext } from './QuickComposer'

/** The slots of the composer that the AI's help fills (REQ-004). */
export type QuickSlots = Pick<ComponentProps<typeof QuickComposer>, 'captionExtras' | 'pictureExtras' | 'thinkItThrough'>

/** What every help is told of the post: the one place that reads the composer's context into theirs. */
function postOf(context: QuickSlotContext): QuickAiPost {
  return { productId: context.productId, channelId: context.channelId, platform: context.platform, caption: context.caption, angle: context.angle, disabled: context.disabled }
}

/**
 * The one place where the AI-help components meet the composer. Every screen that shows the composer (the new-post form, the review of a saved
 * quick post) spreads this into it, so a help is mounted once and appears everywhere.
 *
 * Each slot is a function of `QuickSlotContext` (the post as it is, and ways to change the caption and the card), returning what is shown:
 *   captionExtras   beside the caption's label: the help that writes or improves the caption
 *   pictureExtras   under the picture: the help that proposes a headline, a style and a colour, or an illustration's description
 *   thinkItThrough  under the preview: what is talked about now (trends) and the marketer's read of the whole post
 * A slot left out shows nothing, and the composer works as it is. Nothing mounted here may save, approve or send anything.
 */
export const QUICK_SLOTS: QuickSlots = {
  captionExtras: (context) => <QuickCaptionAi {...postOf(context)} headline={context.cardPicture ? context.headline : ''} onCaption={context.setCaption} />,
  pictureExtras: (context) => {
    const source = pictureSourceOf(context.form)
    return <QuickPictureAi {...postOf(context)} source={source} card={context.cardPicture ? drawnCard(context.form) : null} illustrationWish={context.illustrationWish} onHeadline={context.setHeadline} onIllustrationWish={context.setIllustrationWish} />
  },
  thinkItThrough: (context) => {
    const source = pictureSourceOf(context.form)
    const card = context.cardPicture ? drawnCard(context.form) : null
    return (
      <>
        <QuickTrends {...postOf(context)} onAngle={context.setAngle} />
        <QuickMarketer {...postOf(context)} source={source} card={card} illustrationWish={context.illustrationWish} onCaption={context.setCaption} onHeadline={context.setHeadline} />
      </>
    )
  }
}
