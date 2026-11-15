// Small pure rules about a channel address, kept apart from model.ts (which the screens import with their components) so they can be tested and shared.

import type { ChannelSuggestion, PlatformInfo } from '../../../../shared/types'

/** What the owner typed, with a handle ("@brand") on a named platform turned into the address it stands for. */
export function typedAddress(info: PlatformInfo | undefined, text: string): string {
  const handle = /^@([A-Za-z0-9_.]{1,60})$/.exec(text.trim())?.[1]
  return handle && info?.handleUrl ? info.handleUrl.replace('{handle}', handle) : text.trim()
}

/** The platform a suggestion is meant for: "other" (or an unknown key) means a site the app has no prepared connector for. */
export function platformOfSuggestion(suggestion: ChannelSuggestion, platforms: PlatformInfo[]): PlatformInfo | undefined {
  return platforms.find((p) => p.platform === suggestion.platform) ?? platforms.find((p) => p.platform === 'web')
}
