// What the Channels and Feed screens say about a channel the app cannot read (DEC-034): it takes the owner's own posts and nothing else.
// Words only, in a module without components, so they are tested apart from the interface.

import { isWatchedInBrowser, type ReadingWays } from '../feed/watching-line'

/** The "Reading" row of the status card, in place of the last run, the last success and the next check. */
export const OWN_POSTS_READING = 'Not read by the app. This platform has no way for it to read, so nothing is watched here.'

/** The card that stands in for the mode selector: there is no reply, so there is no mode to choose. */
export const OWN_POSTS_WHAT_IT_DOES = 'Your own posts only. The app does not read this platform, so no reply is prepared here. Each post goes out when you press Send, after you approved that exact text. The app cannot read the page back, so afterwards you tell it whether the post is up.'

// ───────────── A channel the AI watches in the browser (DEC-042) ─────────────
// The platform has no connector, so nothing is replied to, measured or read first as a baseline, but the AI looks at the channel in the account's
// browser like a person, on the channel's schedule, and notes what matters (Noted in the Feed). Posting is as above: the owner's own posts.

/** The "Reading" row of the status card of a channel watched in the browser, above its schedule rows. */
export const BROWSER_WATCH_READING = 'Watched in the browser by the AI, like a person. Nothing is replied to or measured here. Needs Claude Code as the AI engine.'

/** The card that stands in for the mode selector of a channel watched in the browser: it is watched, and still never replied to. */
export const BROWSER_WATCH_WHAT_IT_DOES = 'Your own posts only. The AI watches this platform in the browser and notes what matters in the Feed, but no reply is prepared here. Each post goes out when you press Send, after you approved that exact text. The app cannot read the page back, so afterwards you tell it whether the post is up.'

/** One quiet sentence on the Feed, where the notes of the channels it does not read are shown. */
export const BROWSER_WATCH_NOTE = 'Watched in the browser by the AI like a person: it scrolls, judges each post against your goals and notes what matters here. It never replies or posts from this. Needs Claude Code as the AI engine.'

/** Under the search queries of a channel watched in the browser: the queries are used there too. */
export const BROWSER_WATCH_QUERIES_HINT = 'The AI also searches the platform for these (the first three).'

/** The words of the card that stands in for the mode selector. */
export const ownPostsWhatItDoes = (channel: ReadingWays): string => (isWatchedInBrowser(channel) ? BROWSER_WATCH_WHAT_IT_DOES : OWN_POSTS_WHAT_IT_DOES)

/** Shown on the Feed in place of "Check now" and the older discussions. */
export const OWN_POSTS_NO_CHECK = 'The app does not read this channel: it is for your own posts, so there are no comments to check. Your posts are in Posts.'

/** Shown on the Overview in place of the metrics of a channel the app does not read. */
export const OWN_POSTS_NO_METRICS = 'The app does not read this platform, so there are no metrics to show here.'

/**
 * What "Activate" does, for its tooltip: a channel the app reads gets a baseline, one it does not read is only switched on, and one the AI
 * watches in the browser is switched on and watched, without a baseline.
 */
export const activateHint = (channel: ReadingWays): string => {
  if (channel.reads) return 'Reads the existing discussions once as a baseline, then starts watching for new activity'
  return isWatchedInBrowser(channel) ? 'Starts the channel for your own posts, and the AI starts watching it in the browser. No baseline is read.' : 'Starts the channel for your own posts. Nothing is read.'
}
