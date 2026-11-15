// Wording and small pure rules of "Open browser" (DEC-028, DEC-038): the account's own browser, opened where channels are chosen or shown.
// Kept apart from the component so they are tested without a screen. The core decides what can really be opened; these rules only
// explain, before the click, why a button is off. Opening a window takes nothing from the AI (DEC-038), so the only reason a button
// is off is the screen's own.

import type { Account, ChannelSuggestion, PlatformInfo } from '../../../../shared/types'
import { platformOfSuggestion, typedAddress } from './address'

export const OPEN_BROWSER = 'Open browser'
export const OPEN_IN_ACCOUNT_BROWSER = 'Open in the account’s browser'
export const USE_THIS_PAGE = 'Use the page I’m on'

export const TYPE_ADDRESS_FIRST = 'Type the address of the site first.'
export const NO_BROWSE_PAGE = 'This site has no page that lists channels. Type its address when you connect a channel.'
export const NO_PAGE_OPEN = 'No page is open in the browser yet.'
export const ADDRESS_SHORTENED = 'Everything after “?” or “#” was left out of the address. Check that it is the page you meant.'

/** What to do with the answer of `accounts.currentPage`: the address to use, or the sentence that says there is none. */
export function pageResult(page: { url: string; title: string; trimmed?: boolean } | null): { address: string; note: string | null } | { note: string } {
  return page && page.url.trim() !== '' ? { address: page.url, note: page.trimmed ? ADDRESS_SHORTENED : null } : { note: NO_PAGE_OPEN }
}

/** The address typed in a form, as the core should read it, or nothing when the field is empty (then the platform's browse page opens). */
export function browseAddress(info: PlatformInfo | undefined, text: string): string | undefined {
  const address = typedAddress(info, text)
  return address === '' ? undefined : address
}

/** In a form with an address field: a site without a browse page of its own has nothing to open until an address is typed. */
export function browseBlocker(info: PlatformInfo | undefined, address: string): string | null {
  return info !== undefined && !info.browseUrl && address.trim() === '' ? TYPE_ADDRESS_FIRST : null
}

/** In a list of accounts, where there is no field to type in: a site without a browse page cannot be opened from here. */
export function rowBlocker(info: PlatformInfo | undefined): string | null {
  return info !== undefined && !info.browseUrl ? NO_BROWSE_PAGE : null
}

/** What "Open browser" does in the Connect form, said once beside it. */
export function browseHint(info: PlatformInfo | undefined): string {
  return `Opens ${info?.label ?? 'the site'} in this account’s own browser, signed in as it. Find the place there, then press “${USE_THIS_PAGE}”.`
}

/**
 * The account an idea is looked at in: the first account on the idea's platform, the product's own accounts before the rest of the
 * library (`accounts` is in that order). This is the account "Use this" chooses too, so both lead to the same login. Nothing when none
 * is on that platform: the button is not offered.
 */
export function accountForIdea(idea: ChannelSuggestion, platforms: PlatformInfo[], accounts: Account[]): Account | undefined {
  const wanted = platformOfSuggestion(idea, platforms)
  return wanted ? accounts.find((a) => a.platform === wanted.platform) : undefined
}
