// The rules of the add-a-channel flow: which platform says what, which accounts can serve it, why "Connect channel" is off, which ideas fit.
// Kept apart from the component so they are tested without a screen.

import type { Account, Channel, ChannelSuggestion, PlatformInfo } from '../../../../shared/types'
import { platformOfSuggestion } from './address'

/** The key of "Other website" in the platform catalog (the universal connector). */
export const OTHER_SITE = 'web'

/** One line under a platform's name: what the application does there, in words of what the owner sees. */
export function platformLine(info: Pick<PlatformInfo, 'platform' | 'prepared' | 'canJoin'>): string {
  if (info.platform === 'reddit' || info.canJoin) return 'Reads communities, can join them'
  if (info.platform === OTHER_SITE) return 'Needs a site profile first'
  if (info.platform === 'telegram') return 'A channel or group you run'
  return 'Your own posts, in your account'
}

/** The platforms in the order they are offered: the ones the application reads first, the named ones by name, "Other website" last. */
export function platformChoices(platforms: readonly PlatformInfo[]): PlatformInfo[] {
  const rank = (p: PlatformInfo): number => (p.platform === OTHER_SITE ? 2 : p.prepared ? 0 : 1)
  return [...platforms].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
}

export interface AccountChoices {
  /** The product's own accounts on the platform: made for it, or used by its channels. */
  mine: Account[]
  /** The rest of the library's accounts on the platform. */
  others: Account[]
}

/** The accounts that can serve a channel on a platform: only that platform's, the product's own first (any of the library can serve any product). */
export function accountsFor(platform: string | null, accounts: readonly Account[], productId: string, channels: readonly Channel[]): AccountChoices {
  const onPlatform = platform === null ? [] : accounts.filter((a) => a.platform === platform)
  const mine = onPlatform.filter((a) => a.productId === productId || channels.some((c) => c.accountId === a.id))
  return { mine, others: onPlatform.filter((a) => !mine.includes(a)) }
}

/** The account the flow uses: the one asked for while it serves the platform, else the first (the product's own before the others). */
export function chosenAccount(choices: AccountChoices, wantedId: string | null): Account | undefined {
  const all = [...choices.mine, ...choices.others]
  return all.find((a) => a.id === wantedId) ?? all[0]
}

/** Why "Connect channel" is off, said beside it; null when it can be pressed. */
export function connectReason(args: { platformLabel: string | null; hasAccount: boolean; target: string }): string | null {
  if (args.platformLabel === null) return 'Choose where the channel is first.'
  if (!args.hasAccount) return `Add an account for ${args.platformLabel} first.`
  if (args.target.trim() === '') return 'Type the address of the channel.'
  return null
}

/** The sentence that asks for the address, in the platform's own word. */
export function addressLabel(info: Pick<PlatformInfo, 'platform'> | undefined): string {
  if (info?.platform === 'reddit') return 'Community'
  return 'Address'
}

/** The ideas that are for the platform the owner chose (the AI was asked for it; an idea of another one is never offered here). */
export function ideasForPlatform(ideas: readonly ChannelSuggestion[], platform: PlatformInfo | undefined, platforms: readonly PlatformInfo[]): ChannelSuggestion[] {
  if (!platform) return []
  return ideas.filter((idea) => platformOfSuggestion(idea, platforms as PlatformInfo[])?.platform === platform.platform)
}

/** Whether "Prepare a site profile" is offered: only for "Other website", the one platform that has no definition of its own until a profile of the site is saved (a named platform such as Instagram already has its own). */
export const needsSiteProfile = (info: Pick<PlatformInfo, 'platform'> | undefined, address: string): boolean => info?.platform === OTHER_SITE && /^https?:\/\//i.test(address.trim())

/** What is said under "Find with AI" before it was pressed. */
export const FIND_WITH_AI_NOTE = 'The AI suggests places from the approved passport. They are only ideas: nothing is connected until you press Connect channel.'

/** The last two labels of a host: reddit.com for old.reddit.com. Enough to tell the listed platforms apart. */
const siteOf = (address: string): string | null => {
  try {
    return new URL(address).hostname.toLowerCase().split('.').slice(-2).join('.')
  } catch {
    return null
  }
}

/** The listed platform a web address belongs to, by the site of the platform's own sign-in page; null when it is none of them. */
export function platformOfAddress(address: string, platforms: readonly Pick<PlatformInfo, 'platform' | 'loginUrl'>[]): string | null {
  const site = siteOf(address)
  if (!site) return null
  return platforms.find((p) => p.loginUrl !== '' && siteOf(p.loginUrl) === site)?.platform ?? null
}
