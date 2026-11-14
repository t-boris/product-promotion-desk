// Wording and small pure rules for the Channels screen. Kept apart from the components so they stay easy to read.

import type { Account, AccountStatus, Capability, CapabilityKey, CapabilityStatus, Channel, ChannelMode, ChannelStatus, ChannelSuggestion, PlanFormat, PlatformInfo } from '../../../../shared/types'
import type { Tone } from '../../ui'

/** The name of a platform for people: the connector's own label, from platforms.list. */
export function platformLabel(platform: string, platforms: PlatformInfo[]): string {
  const known = platforms.find((p) => p.platform === platform)
  if (known) return known.label
  return platform === 'other' ? 'Other website' : platform.charAt(0).toUpperCase() + platform.slice(1)
}

/** What to type as a channel address on a platform: prepared platforms know their own short forms; any other site needs a web address. */
export function addressExample(info: PlatformInfo | undefined): string {
  if (info?.example) return info.example
  return info && !info.prepared ? 'https://forum.example.com/c/general' : 'Community name or web address'
}

/** What the owner typed, with a handle ("@brand") on a named platform turned into the address it stands for. */
export function typedAddress(info: PlatformInfo | undefined, text: string): string {
  const handle = /^@([A-Za-z0-9_.]{1,60})$/.exec(text.trim())?.[1]
  return handle && info?.handleUrl ? info.handleUrl.replace('{handle}', handle) : text.trim()
}

/** An address written the way people write it, reduced so that "r/Astrology", "reddit.com/r/astrology/" and the full link compare equal. */
function plainAddress(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^(www\.|old\.|new\.|m\.)/, '')
    .replace(/^reddit\.com\//, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

/** Whether the typed address is the one of a channel that exists already (as its short form or as its link). */
export function isSameAddress(typed: string, channel: Channel): boolean {
  const wanted = plainAddress(typed)
  return wanted !== '' && (wanted === plainAddress(channel.target) || wanted === plainAddress(channel.url))
}

/** "Name (Platform) — role", so the owner picks the voice as well as the login. */
export function accountOptionLabel(account: Account, platforms: PlatformInfo[]): string {
  return `${account.label} (${platformLabel(account.platform, platforms)})${account.role ? ` — ${account.role.name}` : ''}`
}

export function isWebAddress(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim())
}

/** The platform a suggestion is meant for: "other" (or an unknown key) means a site the app has no prepared connector for. */
export function platformOfSuggestion(suggestion: ChannelSuggestion, platforms: PlatformInfo[]): PlatformInfo | undefined {
  return platforms.find((p) => p.platform === suggestion.platform) ?? platforms.find((p) => p.platform === 'web')
}

/** What a step of a channel plan is made of, in plain words. */
export const PLAN_FORMAT_LABEL: Record<PlanFormat, string> = { text: 'Text', image: 'Photo', video: 'Video', link: 'Link', other: 'Other' }

// The words live with the top bar's account summary, which lists them in its tooltip; one place for both.
export { ACCOUNT_STATUS_LABEL } from '../../status-labels'

export const ACCOUNT_STATUS_TONE: Record<AccountStatus, Tone> = {
  ready: 'good',
  login_required: 'warn',
  captcha: 'warn',
  suspended: 'bad'
}

export const CHANNEL_STATUS_LABEL: Record<ChannelStatus, string> = {
  setup: 'Setting up',
  active: 'Active',
  paused: 'Paused',
  needs_user: 'Needs you',
  error: 'Problem'
}

export const CHANNEL_STATUS_TONE: Record<ChannelStatus, Tone> = {
  setup: 'info',
  active: 'good',
  paused: 'neutral',
  needs_user: 'warn',
  error: 'bad'
}

export const CAPABILITY_ORDER: CapabilityKey[] = ['read_posts', 'read_comments', 'detect_changes', 'rules', 'metrics', 'publish_post', 'publish_reply', 'verify_send']

export const CAPABILITY_LABEL: Record<CapabilityKey, string> = {
  read_posts: 'Read posts',
  read_comments: 'Read comments',
  detect_changes: 'Detect new activity',
  rules: 'Read community rules',
  metrics: 'Read metrics',
  publish_post: 'Publish a post',
  publish_reply: 'Send a reply',
  verify_send: 'Confirm that a message was published'
}

/** The abilities that onboarding can never prove: only an actual, authorized send does. */
export const SENDING_CAPABILITIES: CapabilityKey[] = ['publish_post', 'publish_reply', 'verify_send']

export const CAPABILITY_STATUS_LABEL: Record<CapabilityStatus, string> = {
  verified: 'Verified',
  needs_check: 'Needs verification',
  needs_user: 'Needs you',
  unavailable: 'Unavailable',
  restricted: 'Restricted by rules'
}

export const CAPABILITY_STATUS_TONE: Record<CapabilityStatus, Tone> = {
  verified: 'good',
  needs_check: 'info',
  needs_user: 'warn',
  // The platform does not offer it: a plain fact. Restricted by the community's rules: amber, the owner may decide.
  unavailable: 'neutral',
  restricted: 'warn'
}

export const CAPABILITY_STATUS_HELP: Record<CapabilityStatus, string> = {
  verified: 'Confirmed by really doing it: reading worked, or a real send was confirmed.',
  needs_check: 'Looks possible, but is not confirmed yet.',
  needs_user: 'A person has to act first, for example sign in or solve a check.',
  unavailable: 'The platform does not offer this here.',
  restricted: 'Technically possible, but the community rules forbid it.'
}

export function capabilityOf(channel: Channel, key: CapabilityKey): Capability | undefined {
  return channel.capabilities.find((c) => c.key === key)
}

export function neverAssessed(channel: Channel): boolean {
  return channel.capabilities.every((c) => c.checkedAt === null)
}

export const MODE_OPTIONS: { id: ChannelMode; label: string; summary: string }[] = [
  { id: 'observe', label: 'Observe', summary: 'Shows new discussions and comments as events. Nothing is drafted and nothing is sent.' },
  { id: 'draft', label: 'Draft', summary: 'Also prepares reply drafts for you to read and use. Nothing is sent.' },
  { id: 'approval', label: 'Approval', summary: 'Prepares drafts and queues them. A message goes out only after you approve that exact text.' },
  {
    id: 'auto',
    label: 'Automatic',
    summary: 'Replies by itself, but only to the simple categories you enable (thanks, questions answered from approved facts). Everything else still waits for you.'
  }
]

/** Mirrors the core's rule so the screen can explain a disabled mode; the core still decides. */
export function modeBlockedReason(channel: Channel, mode: ChannelMode): string | null {
  if (mode === 'observe' || mode === 'draft') return null
  const reply = capabilityOf(channel, 'publish_reply')
  if (reply?.status === 'restricted') return 'Replying is forbidden by the community rules here.'
  if (reply?.status === 'unavailable') return 'Replying is not possible here.'
  if (mode === 'auto' && channel.settings.autoCategories.length === 0) return 'Choose at least one automatic category in the settings first.'
  return null
}

/** "Next check" for the status line: only an active channel has one. */
export function nextCheckText(channel: Channel, format: (iso: string | null) => string): string {
  switch (channel.status) {
    case 'active':
      return channel.nextCheckAt ? format(channel.nextCheckAt) : 'Soon'
    case 'paused':
      return 'Paused'
    case 'setup':
      return 'Not started'
    case 'needs_user':
      return 'Waiting for you'
    case 'error':
      return channel.nextCheckAt ? format(channel.nextCheckAt) : 'Retrying'
  }
}
