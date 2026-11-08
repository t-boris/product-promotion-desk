// Named platforms served by the universal connector (DEC-013). Each one is data: where to sign in, which domains belong to it, how a
// short handle becomes an address, what a post can hold. There is no code per platform, and nothing here claims that a platform works:
// every channel on these platforms starts as "needs check" until its site profile was prepared and its abilities were actually seen.

import type { PlatformContentKind } from '../../shared/types'

export interface PlatformPreset {
  /** Key stored on accounts and channels. */
  platform: string
  label: string
  loginUrl: string
  /** The registration page; opened in the account's own browser by "Create account on the platform" (DEC-015). Empty when the platform has none on the web. */
  signupUrl: string
  /** Said instead of the registration steps when there is no registration page: where the account is made. */
  signupNote?: string
  /** Domains of the platform; an address on any other domain does not belong to it. */
  hosts: string[]
  /** Address of a page from a handle, `{handle}` replaced: "@brand" becomes https://www.instagram.com/brand/. */
  handleUrl: string
  /** A typical address, shown as the placeholder of the address field. */
  example: string
  accepts: PlatformContentKind[]
  hint: string
  note: string
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    platform: 'instagram',
    label: 'Instagram',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    signupUrl: 'https://www.instagram.com/accounts/emailsignup/',
    hosts: ['instagram.com'],
    handleUrl: 'https://www.instagram.com/{handle}/',
    example: '@yourbrand',
    accepts: ['image', 'video'],
    hint: 'The address of the profile, e.g. https://www.instagram.com/yourbrand/ or @yourbrand.',
    note: 'A post needs a photo or a video: the application does not create media, you bring the files. The platform restricts automation, so expect checks and limits.'
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    loginUrl: 'https://www.facebook.com/login/',
    signupUrl: 'https://www.facebook.com/r.php',
    hosts: ['facebook.com', 'fb.com'],
    handleUrl: 'https://www.facebook.com/{handle}',
    example: 'https://www.facebook.com/groups/yourgroup',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of a page or a group, e.g. https://www.facebook.com/groups/astrologyclub.',
    note: 'Groups have their own rules and often need approval of posts. The platform restricts automation.'
  },
  {
    platform: 'tiktok',
    label: 'TikTok',
    loginUrl: 'https://www.tiktok.com/login',
    signupUrl: 'https://www.tiktok.com/signup',
    hosts: ['tiktok.com'],
    handleUrl: 'https://www.tiktok.com/@{handle}',
    example: '@yourbrand',
    accepts: ['video'],
    hint: 'The address of the profile, e.g. https://www.tiktok.com/@yourbrand or @yourbrand.',
    note: 'A post is a video that you make: the application does not create media. The platform restricts automation.'
  },
  {
    platform: 'x',
    label: 'X (Twitter)',
    loginUrl: 'https://x.com/i/flow/login',
    signupUrl: 'https://x.com/i/flow/signup',
    hosts: ['x.com', 'twitter.com'],
    handleUrl: 'https://x.com/{handle}',
    example: '@yourbrand',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of the profile, e.g. https://x.com/yourbrand or @yourbrand.',
    note: 'Posts are short. The platform restricts automation and sets limits on what an account may do.'
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    loginUrl: 'https://www.linkedin.com/login',
    signupUrl: 'https://www.linkedin.com/signup',
    hosts: ['linkedin.com'],
    handleUrl: 'https://www.linkedin.com/company/{handle}/',
    example: 'https://www.linkedin.com/company/yourbrand/',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of a company page or a group, e.g. https://www.linkedin.com/company/yourbrand/.',
    note: 'The tone is professional. The platform restricts automation.'
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    loginUrl: 'https://www.youtube.com/',
    signupUrl: 'https://accounts.google.com/signup',
    hosts: ['youtube.com', 'youtu.be'],
    handleUrl: 'https://www.youtube.com/@{handle}',
    example: '@yourbrand',
    accepts: ['video', 'text'],
    hint: 'The address of the channel, e.g. https://www.youtube.com/@yourbrand.',
    note: 'Videos are made by you; comments under videos are text. You sign in with a Google account.'
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    loginUrl: 'https://web.telegram.org/',
    signupUrl: '',
    signupNote: 'Telegram accounts are made in the Telegram app on your phone, with your phone number. Then sign in here with the QR code.',
    hosts: ['t.me', 'telegram.me', 'web.telegram.org'],
    handleUrl: 'https://t.me/{handle}',
    example: '@yourchannel',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of a channel or a group, e.g. https://t.me/yourchannel or @yourchannel.',
    note: 'Groups and channels set their own rules on who may post.'
  },
  {
    platform: 'threads',
    label: 'Threads',
    loginUrl: 'https://www.threads.net/login',
    signupUrl: '',
    signupNote: 'Threads has no sign-up of its own: it uses an Instagram account. Add an Instagram account first, then sign in to Threads with it.',
    hosts: ['threads.net', 'threads.com'],
    handleUrl: 'https://www.threads.net/@{handle}',
    example: '@yourbrand',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of the profile, e.g. https://www.threads.net/@yourbrand or @yourbrand.',
    note: 'Short text posts. The platform restricts automation.'
  },
  {
    platform: 'pinterest',
    label: 'Pinterest',
    loginUrl: 'https://www.pinterest.com/login/',
    signupUrl: 'https://www.pinterest.com/signup/',
    hosts: ['pinterest.com'],
    handleUrl: 'https://www.pinterest.com/{handle}/',
    example: 'https://www.pinterest.com/yourbrand/',
    accepts: ['image', 'video', 'link'],
    hint: 'The address of the profile or a board, e.g. https://www.pinterest.com/yourbrand/.',
    note: 'A pin needs an image or a video that you bring, and a link to the page it leads to.'
  }
]

export const presetFor = (platform: string): PlatformPreset | undefined => PLATFORM_PRESETS.find((p) => p.platform === platform)

/** Whether `hostname` is one of the domains (or a sub-domain of one). */
export const hostMatches = (hostname: string, domains: string[]): boolean => {
  const host = hostname.toLowerCase()
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

/** "@brand" becomes the address of that handle on the platform; anything else is left as it was typed. */
export function expandHandle(preset: PlatformPreset, input: string): string {
  const text = input.trim()
  const handle = /^@([A-Za-z0-9_.]{1,60})$/.exec(text)?.[1]
  return handle ? preset.handleUrl.replace('{handle}', handle) : text
}

/** Whether a (normalized) address is on the platform's own domains. */
export function addressOnPlatform(preset: PlatformPreset, url: string): boolean {
  try {
    return hostMatches(new URL(url).hostname, preset.hosts)
  } catch {
    return false
  }
}
