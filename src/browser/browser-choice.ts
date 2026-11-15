// Which browser an account works in (DEC-025): the built-in one, or the owner's installed Google Chrome. Pure, so it is a table to read and test.

export type BrowserKind = 'app' | 'chrome'

/**
 * The platforms whose accounts work in Chrome. A site that refuses what it takes for an embedded shell (Facebook's registration did) gets
 * a browser every site supports; every other platform stays in the built-in browser, where its sessions already live. A session lives in
 * one browser only, so this is a decision about a platform, not a switch for the whole app.
 */
export const CHROME_PLATFORMS: readonly string[] = ['facebook']

export interface BrowserChoice {
  kind: BrowserKind
  /** Said once in the log when the choice is not what the platform asks for (Chrome wanted and not found). */
  note: string | null
}

/**
 * `override` is PPD_BROWSER (`app` or `chrome`; anything else is ignored): for probes and for the owner who wants the other one. Chrome that
 * is wanted and not installed never stops an account: it uses the built-in browser and says so.
 */
export function chooseBrowser(platform: string, override: string | undefined, chromeFound: boolean): BrowserChoice {
  const wanted: BrowserKind = override === 'app' || override === 'chrome' ? override : CHROME_PLATFORMS.includes(platform.toLowerCase()) ? 'chrome' : 'app'
  if (wanted === 'chrome' && !chromeFound) {
    return { kind: 'app', note: 'Google Chrome was not found on this Mac, so the built-in browser is used for this account.' }
  }
  return { kind: wanted, note: null }
}
