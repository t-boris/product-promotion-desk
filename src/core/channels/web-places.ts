// Where the AI looks when the app cannot read a channel (DEC-042, DEC-045). Any channel the app does not read is watched in the account's browser, so the
// pages the AI may open come from the channel itself and not from a table of platforms: the domains of a platform the app knows, else the site of the channel's
// own address, and, for the places that have one, the site's own search and its newest and best pages. A site the app knows nothing about gets its channel
// page only: the AI follows the links it sees there, on the same site. Pure: no network, no state.

import type { Channel } from '../../shared/types'
import { hostMatches, presetFor, searchAddress } from './presets'

export interface WebPlaces {
  /** The domains the AI's pages stay on (a sub-domain of one is the same site). */
  hosts: string[]
  /** The site's own search for `query`, or null when the app knows none for this site. */
  search(query: string): string | null
  /** The channel's newest posts, when that is not the channel's page itself; null otherwise. */
  newest: string | null
  /** The channel's best posts of the last week, when the site has such a page; null otherwise. */
  top: string | null
}

const REDDIT_HOSTS = ['reddit.com']
const SUBREDDIT = /^\/r\/([A-Za-z0-9_]{2,21})(?:\/|$)/

/** The community a Reddit address names ("https://www.reddit.com/r/astrology" gives "astrology"), or null. */
function subredditOf(url: URL): string | null {
  return hostMatches(url.hostname, REDDIT_HOSTS) ? (SUBREDDIT.exec(url.pathname)?.[1] ?? null) : null
}

/** The site of an address without a leading "www.": what a forum calls itself, and as far as the AI's pages may go. */
const siteOf = (url: URL): string => url.hostname.toLowerCase().replace(/^www\./, '')

const NONE: WebPlaces = { hosts: [], search: () => null, newest: null, top: null }

export function webPlaces(channel: Pick<Channel, 'platform' | 'url'>): WebPlaces {
  let url: URL
  try {
    url = new URL(channel.url)
  } catch {
    return NONE
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return NONE

  const sub = subredditOf(url)
  if (sub) {
    const base = `https://www.reddit.com/r/${sub}`
    return {
      hosts: REDDIT_HOSTS,
      search: (query) => {
        const text = query.replace(/\s+/g, ' ').trim().slice(0, 120)
        return text ? `${base}/search/?q=${encodeURIComponent(text)}&restrict_sr=1&sort=new` : null
      },
      newest: `${base}/new/`,
      top: `${base}/top/?t=week`
    }
  }

  const preset = presetFor(channel.platform)
  if (preset) return { hosts: preset.hosts, search: (query) => searchAddress(preset, query), newest: null, top: null }

  return { hosts: [siteOf(url)], search: () => null, newest: null, top: null }
}
