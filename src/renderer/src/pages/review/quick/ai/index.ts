// The AI helps of the quick-post composer (REQ-004). Each is a component of its own, with the props of ./types; the screen that holds the composer
// mounts them in its slots (quick-slots.tsx). None of them saves, approves or sends anything.

export { QuickCaptionAi } from './QuickCaptionAi'
export { QuickPictureAi } from './QuickPictureAi'
export { QuickTrends } from './QuickTrends'
export { QuickMarketer } from './QuickMarketer'
export type { QuickAiPost, QuickCaptionAiProps, QuickMarketerProps, QuickPictureAiProps, QuickPictureSource, QuickTrendsProps } from './types'
