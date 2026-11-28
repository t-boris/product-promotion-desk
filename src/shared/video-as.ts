import { isVideoMime, type VideoAs } from './types'

/** What stands beside the choice: Facebook's own limits for a Reel (its guide "Reels Publishing API"), and that the choice is approved with the post. */
export const REEL_HINT = 'A Reel is vertical (9:16), 3 to 90 seconds long and at least 540 × 960. Facebook refuses a video that does not fit. The choice is part of what you approve.'

/** A Reel is one video and nothing beside it. Null: the post can be one. */
export function reelProblem(attachments: { mime: string }[]): string | null {
  return attachments.length === 1 && isVideoMime((attachments[0] as { mime: string }).mime) ? null : 'A Reel is one video with no picture beside it.'
}

/** What the preview says of the choice before the approval; null for the usual video post. */
export const videoAsNote = (videoAs: VideoAs | null | undefined, label: string): string | null => (videoAs === 'reel' ? `The video goes out as a Reel on ${label}.` : null)
