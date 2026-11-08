// Catches the mistake of an account whose name says one platform while the account is on another. Pure, so it is tested without the interface.

import type { PlatformInfo } from '../../../../shared/types'

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether `label` (a platform's name) appears in `name` as a word. Names of one or two letters ("X") are too easily part of any name. */
const mentions = (name: string, label: string): boolean => label.trim().length >= 3 && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(label.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(name)

/**
 * A sentence for the owner when the account's name mentions another platform than the one it is on ("Natal Mystic @ Facebook"
 * on Reddit), otherwise null. The platform of an account is fixed when it is added, so the way out is to add it again.
 */
export function platformMismatch(name: string, platform: string, platforms: Pick<PlatformInfo, 'platform' | 'label'>[]): string | null {
  const own = platforms.find((p) => p.platform === platform)
  if (own && mentions(name, own.label)) return null
  const other = platforms.find((p) => p.platform !== platform && mentions(name, p.label))
  if (!other) return null
  return `The name mentions ${other.label}, but this account is on ${own?.label ?? platform}. If that is a mistake, remove it (under “More”) and add it again with the right platform.`
}
