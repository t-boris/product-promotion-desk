// What the Channels and Feed screens say about a channel the app cannot read (DEC-034): it takes the owner's own posts and nothing else.
// Words only, in a module without components, so they are tested apart from the interface.

import type { Channel } from '../../../../shared/types'

/** The "Reading" row of the status card, in place of the last run, the last success and the next check. */
export const OWN_POSTS_READING = 'Not read by the app. This platform has no way for it to read, so nothing is watched here.'

/** The card that stands in for the mode selector: there is no reply, so there is no mode to choose. */
export const OWN_POSTS_WHAT_IT_DOES = 'Your own posts only. The app does not read this platform, so no reply is prepared here. Each post goes out when you press Send, after you approved that exact text. The app cannot read the page back, so afterwards you tell it whether the post is up.'

/** Shown on the Feed in place of "Check now" and the older discussions. */
export const OWN_POSTS_NO_CHECK = 'The app does not read this channel: it is for your own posts, so there are no comments to check. Your posts are in Posts.'

/** Shown on the Overview in place of the metrics of a channel the app does not read. */
export const OWN_POSTS_NO_METRICS = 'The app does not read this platform, so there are no metrics to show here.'

/** What "Activate" does, for its tooltip: a channel the app reads gets a baseline, one it does not read is only switched on. */
export const activateHint = (channel: Pick<Channel, 'reads'>): string =>
  channel.reads ? 'Reads the existing discussions once as a baseline, then starts watching for new activity' : 'Starts the channel for your own posts. Nothing is read.'
