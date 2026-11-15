// Which browser an account works in (DEC-026): the application's own, or the owner's installed Google Chrome. The account says which; the
// default is the internal one. Pure, so it is a table to read and test.

import type { BrowserChoice } from '../shared/types'

export type BrowserKind = BrowserChoice

/**
 * The browser for an account. `override` is PPD_BROWSER (`internal` or `chrome`; anything else is ignored): it forces one browser for every
 * account, for probes and for support. Otherwise the account's own setting decides; an account without one is internal.
 */
export function chooseBrowser(setting: BrowserChoice | undefined, override: string | undefined): BrowserKind {
  if (override === 'internal' || override === 'chrome') return override
  return setting === 'chrome' ? 'chrome' : 'internal'
}
