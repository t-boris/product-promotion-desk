// Wording and small pure rules for the Channels screen. Kept apart from the components so they stay easy to read.

import type { AccountStatus, Capability, CapabilityKey, CapabilityStatus, Channel, ChannelMode, ChannelStatus } from '../../../../shared/types'
import type { Tone } from '../../ui'

/** Platforms an account can be created for. The core refuses any platform it has no connector for. */
export const PLATFORM_OPTIONS: { id: string; label: string; addressHint: string }[] = [
  { id: 'reddit', label: 'Reddit', addressHint: 'r/astrology or https://www.reddit.com/r/astrology/' },
  { id: 'web', label: 'Other website (universal connector)', addressHint: 'https://forum.example.com/c/general' }
]

export function platformLabel(platform: string): string {
  return PLATFORM_OPTIONS.find((p) => p.id === platform)?.label.split(' (')[0] ?? platform
}

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  ready: 'Signed in',
  login_required: 'Sign-in needed',
  captcha: 'CAPTCHA to solve',
  suspended: 'Suspended by the platform'
}

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
  unavailable: 'bad',
  restricted: 'bad'
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
