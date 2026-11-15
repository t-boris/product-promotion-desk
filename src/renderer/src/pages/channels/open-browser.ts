// Wording and small pure rules of "Open browser" (DEC-028): the account's own browser, opened where channels are chosen or shown.
// Kept apart from the component so they are tested without a screen. The core decides what can really be opened; these rules only
// explain, before the click, why a button is off.

import type { Account, BrowserState, ChannelSuggestion, PlatformInfo } from '../../../../shared/types'
import { platformOfSuggestion, typedAddress } from './address'

export const OPEN_BROWSER = 'Open browser'
export const OPEN_IN_ACCOUNT_BROWSER = 'Open in the account’s browser'
export const USE_THIS_PAGE = 'Use the page I’m on'

export const TYPE_ADDRESS_FIRST = 'Type the address of the site first.'
export const NO_BROWSE_PAGE = 'This site has no page that lists channels. Type its address when you connect a channel.'
export const AI_WORKING = 'The AI is working on this account. Open its browser when it is done.'
export const OPEN_ALREADY = 'This account’s browser is open already.'
export const NO_PAGE_OPEN = 'No page is open in the browser yet.'
export const ADDRESS_SHORTENED = 'Everything after “?” or “#” was left out of the address. Check that it is the page you meant.'

/**
 * What a control of an account shows: the button (`closed`), the block of the person working in that window (`open`), or the button
 * switched off because another control of the same screen shows the block (`elsewhere`: several buttons lead to the same account, and the
 * block is shown once).
 */
export type OpenMode = 'closed' | 'open' | 'elsewhere'

export function openMode(holder: BrowserState['holder'] | undefined, showsBlock: boolean): OpenMode {
  if (holder !== 'user') return 'closed'
  return showsBlock ? 'open' : 'elsewhere'
}

/**
 * Which of the controls of one account on a screen shows the block: the one that was pressed, or, when that one is not on this screen
 * (the owner went elsewhere and came back), the first one. `mounted` lists the controls on screen in order of appearance.
 */
export function blockHolder(pressed: string | null, mounted: string[]): string | null {
  if (pressed !== null && mounted.includes(pressed)) return pressed
  return mounted[0] ?? null
}

/** Why the button is off now (said beside it), or null when it can open. `hostReason` is the screen's own: nothing to open yet. */
export function openBlocker(input: { aiWorking: boolean; mode: OpenMode; hostReason?: string | null }): string | null {
  if (input.mode === 'elsewhere') return OPEN_ALREADY
  if (input.aiWorking) return AI_WORKING
  return input.hostReason ?? null
}

/** What the block says while the person holds the browser: the app waits, and what ends it. */
export function holdingNote(windowOpen: boolean): string {
  return windowOpen
    ? 'This account’s browser is open and you are working in it, so the app waits. When you are done, press “Done, close the window” (or close the window): the app then checks the sign-in by itself.'
    : 'You took over this account’s browser, so the app does not use it. Give it back when you are done.'
}

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
