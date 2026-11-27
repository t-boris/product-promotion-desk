// Named platforms served by the universal connector (DEC-013). Each one is data: where to sign in, which domains belong to it, how a
// short handle becomes an address, what a post can hold. There is no code per platform, and nothing here claims that a platform works:
// every channel on these platforms starts as "needs check" until its site profile was prepared and its abilities were actually seen.

import type { AccountKindChoice, GuideStep, PlatformContentKind } from '../../shared/types'

export interface PlatformPreset {
  /** Key stored on accounts and channels. */
  platform: string
  label: string
  loginUrl: string
  /** Where channels of the platform are found and chosen (a list or search of groups, communities, accounts); opened in the account's own browser (DEC-028). On the platform's own domains. */
  browseUrl: string
  /** The registration page; opened in the account's own browser by "Create account on the platform" (DEC-015). Empty when the platform has none on the web. */
  signupUrl: string
  /** Said instead of the registration steps when there is no registration page: where the account is made. */
  signupNote?: string
  /** The platform whose account this one signs in through (DEC-027): an account is made only with such an account to sign in through, and has no credentials of its own. */
  signsInWith?: string
  /** Domains of the platform; an address on any other domain does not belong to it. */
  hosts: string[]
  /** Address of a page from a handle, `{handle}` replaced: "@brand" becomes https://www.instagram.com/brand/. */
  handleUrl: string
  /** The platform's own search for a word or a phrase, `{q}` replaced by the encoded query; on the platform's own domains. Only for the platforms the app watches through the browser (DEC-042). */
  searchUrl?: string
  /** A typical address, shown as the placeholder of the address field. */
  example: string
  accepts: PlatformContentKind[]
  hint: string
  note: string
  /** The kinds of account the platform has, asked for each account (DEC-074). */
  kinds?: AccountKindChoice[]
  /** How an account is connected, per kind; '' is for a kind not said yet, or a platform with no kinds. Addresses are on the platform's own domains. */
  guides?: Record<string, GuideStep[]>
}

const SIGN_IN = (label: string): GuideStep => ({ text: `Sign in to ${label} in this account’s browser (the Sign-in step below), or create the account there.` })
const INSTAGRAM_SETTINGS = 'https://www.instagram.com/accounts/edit/'
const INSTAGRAM_CHANNEL: GuideStep = { text: 'Then connect its channel on the Channels screen: the address is the profile, like @yourbrand.' }
const FACEBOOK_PAGES = 'https://www.facebook.com/pages/'

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    platform: 'instagram',
    label: 'Instagram',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    browseUrl: 'https://www.instagram.com/explore/',
    signupUrl: 'https://www.instagram.com/accounts/emailsignup/',
    hosts: ['instagram.com'],
    handleUrl: 'https://www.instagram.com/{handle}/',
    searchUrl: 'https://www.instagram.com/explore/search/keyword/?q={q}',
    example: '@yourbrand',
    accepts: ['image', 'video'],
    hint: 'The address of the profile, e.g. https://www.instagram.com/yourbrand/ or @yourbrand.',
    kinds: [
      { id: 'professional', label: 'Professional (business or creator)', hint: 'A public account with a category under its name; Instagram shows it the views of each post.' },
      { id: 'personal', label: 'Personal', hint: 'An ordinary account; it may be private.' }
    ],
    guides: {
      '': [
        SIGN_IN('Instagram'),
        {
          text: 'Find out the kind: in Settings look for “For professionals”, then “Account type and tools”. If it offers “Switch to professional account”, the account is personal; if it offers to switch to a personal account, it is professional. Then choose the kind above.',
          url: INSTAGRAM_SETTINGS,
          link: 'Open Instagram’s settings'
        },
        INSTAGRAM_CHANNEL
      ],
      professional: [
        SIGN_IN('Instagram'),
        {
          text: 'Check the kind: Settings, “For professionals”, “Account type and tools”. If it offers “Switch to professional account”, the account is still personal: press it and choose Creator or Business. It is free, and a professional account is always public.',
          url: INSTAGRAM_SETTINGS,
          link: 'Open Instagram’s settings'
        },
        INSTAGRAM_CHANNEL
      ],
      personal: [
        SIGN_IN('Instagram'),
        { text: 'Nothing more is needed on Instagram’s side. If the account is private, only its followers see what is posted.' },
        {
          text: 'To make it professional later (free): Settings, “For professionals”, “Account type and tools”, “Switch to professional account”. Then change the kind above.',
          url: INSTAGRAM_SETTINGS,
          link: 'Open Instagram’s settings'
        },
        INSTAGRAM_CHANNEL
      ]
    },
    note: 'A post needs a photo or a video. A picture can be brought by the owner or made by the AI from a description (when Codex is ready); the application does not make video. The platform restricts automation, so expect checks and limits.'
  },
  {
    platform: 'facebook',
    label: 'Facebook',
    loginUrl: 'https://www.facebook.com/login/',
    browseUrl: 'https://www.facebook.com/groups/discover/',
    signupUrl: 'https://www.facebook.com/r.php',
    hosts: ['facebook.com', 'fb.com'],
    handleUrl: 'https://www.facebook.com/{handle}',
    searchUrl: 'https://www.facebook.com/search/posts/?q={q}',
    example: 'https://www.facebook.com/groups/yourgroup',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of a page or a group, e.g. https://www.facebook.com/groups/astrologyclub.',
    kinds: [
      { id: 'page', label: 'A Page', hint: 'A public page of a business or a brand. It has no login of its own: a personal profile manages it.' },
      { id: 'profile', label: 'A personal profile', hint: 'A person’s own profile; it posts to its timeline and to the groups it joined.' }
    ],
    guides: {
      '': [
        SIGN_IN('Facebook'),
        { text: 'Say what this account posts as: a Page, or the personal profile itself. The Pages this profile manages are listed here. Then choose the kind above.', url: FACEBOOK_PAGES, link: 'Open your Pages' }
      ],
      page: [
        { text: 'A Page has no login of its own: sign in with the personal profile that manages it (the Sign-in step below).' },
        { text: 'Create the Page: give it a name and a category. Skip this when the Page exists.', url: 'https://www.facebook.com/pages/create', link: 'Open “Create a Page”' },
        {
          text: 'Switch into the Page, so that posts go out as the Page: press your picture at the top right and choose the Page (Facebook also calls it “See all profiles” or “Switch”).',
          url: FACEBOOK_PAGES,
          link: 'Open your Pages'
        },
        { text: 'Then connect its channel on the Channels screen: the address of the Page, like https://www.facebook.com/yourpage.' },
        {
          text: 'A Page can also be worked with no browser, through Meta’s own API: posts go out by themselves at their time, and comments and the numbers under posts are read from Facebook. That is an account of its own: add an account, and under “How the app works with it” choose “Through a Page (Facebook\'s own API)”.'
        }
      ],
      profile: [
        SIGN_IN('Facebook'),
        { text: 'A personal profile posts to its own timeline and to the groups it has joined. To post in a group, join it first.', url: 'https://www.facebook.com/groups/discover/', link: 'Open Facebook groups' },
        { text: 'Then connect its channel on the Channels screen: the address of the group, like https://www.facebook.com/groups/yourgroup.' }
      ]
    },
    note: 'Groups have their own rules and often need approval of posts. The platform restricts automation.'
  },
  {
    platform: 'tiktok',
    label: 'TikTok',
    loginUrl: 'https://www.tiktok.com/login',
    browseUrl: 'https://www.tiktok.com/explore',
    signupUrl: 'https://www.tiktok.com/signup',
    hosts: ['tiktok.com'],
    handleUrl: 'https://www.tiktok.com/@{handle}',
    example: '@yourbrand',
    accepts: ['video'],
    hint: 'The address of the profile, e.g. https://www.tiktok.com/@yourbrand or @yourbrand.',
    note: 'A post is a video that you make: the application does not make video. The platform restricts automation.'
  },
  {
    platform: 'x',
    label: 'X (Twitter)',
    loginUrl: 'https://x.com/i/flow/login',
    browseUrl: 'https://x.com/explore',
    signupUrl: 'https://x.com/i/flow/signup',
    hosts: ['x.com', 'twitter.com'],
    handleUrl: 'https://x.com/{handle}',
    searchUrl: 'https://x.com/search?q={q}&f=live',
    example: '@yourbrand',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of the profile, e.g. https://x.com/yourbrand or @yourbrand.',
    note: 'Posts are short. The platform restricts automation and sets limits on what an account may do.'
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    loginUrl: 'https://www.linkedin.com/login',
    browseUrl: 'https://www.linkedin.com/groups/',
    signupUrl: 'https://www.linkedin.com/signup',
    hosts: ['linkedin.com'],
    handleUrl: 'https://www.linkedin.com/company/{handle}/',
    searchUrl: 'https://www.linkedin.com/search/results/content/?keywords={q}',
    example: 'https://www.linkedin.com/company/yourbrand/',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of a company page or a group, e.g. https://www.linkedin.com/company/yourbrand/.',
    note: 'The tone is professional. The platform restricts automation.'
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    loginUrl: 'https://www.youtube.com/',
    browseUrl: 'https://www.youtube.com/',
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
    browseUrl: 'https://web.telegram.org/',
    signupUrl: '',
    signupNote: 'Telegram accounts are made in the Telegram app on your phone, with your phone number. Then sign in here with the QR code.',
    hosts: ['t.me', 'telegram.me', 'web.telegram.org'],
    handleUrl: 'https://t.me/{handle}',
    example: '@yourchannel',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of a channel or a group, e.g. https://t.me/yourchannel or @yourchannel.',
    guides: {
      '': [
        { text: 'A Telegram account is made in the Telegram app on your phone, with your phone number.' },
        { text: 'Sign in here with the code on the screen: in the phone app open Settings, Devices, Link Desktop Device, and scan it.', url: 'https://web.telegram.org/', link: 'Open Telegram Web' },
        { text: 'Then connect its channel on the Channels screen: a channel or a group, like @yourchannel. To post on a schedule and read comments with no browser, add one more account and choose “Through a bot”.' }
      ]
    },
    note: 'Groups and channels set their own rules on who may post.'
  },
  {
    platform: 'threads',
    label: 'Threads',
    loginUrl: 'https://www.threads.net/login',
    browseUrl: 'https://www.threads.net/',
    signupUrl: '',
    signupNote: 'Threads has no sign-up of its own: it uses an Instagram account. Add an Instagram account first, then sign in to Threads with it.',
    signsInWith: 'instagram',
    hosts: ['threads.net', 'threads.com'],
    handleUrl: 'https://www.threads.net/@{handle}',
    searchUrl: 'https://www.threads.net/search?q={q}',
    example: '@yourbrand',
    accepts: ['text', 'image', 'video', 'link'],
    hint: 'The address of the profile, e.g. https://www.threads.net/@yourbrand or @yourbrand.',
    guides: {
      '': [
        { text: 'Threads has no login of its own: this account signs in with its Instagram account (the step below). Its kind is the kind of that Instagram account.' },
        { text: 'Sign in (the Sign-in step below). The first time, Threads asks to make the Threads profile from the Instagram one: confirm it.' },
        { text: 'Then connect its channel on the Channels screen: the address is the profile, like @yourbrand.' }
      ]
    },
    note: 'Short text posts. The platform restricts automation.'
  },
  {
    platform: 'pinterest',
    label: 'Pinterest',
    loginUrl: 'https://www.pinterest.com/login/',
    browseUrl: 'https://www.pinterest.com/',
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

/** The address of the platform's own search for `query`, or null when the platform has none (or the address is not on its domains). */
export function searchAddress(preset: PlatformPreset, query: string): string | null {
  const text = query.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!preset.searchUrl || !text) return null
  const url = preset.searchUrl.replace('{q}', encodeURIComponent(text))
  return addressOnPlatform(preset, url) ? url : null
}

/** "@brand" becomes the address of that handle on the platform; anything else is left as it was typed. */
export function expandHandle(preset: PlatformPreset, input: string): string {
  const text = input.trim()
  const handle = /^@([A-Za-z0-9_.]{1,60})$/.exec(text)?.[1]
  return handle ? preset.handleUrl.replace('{handle}', handle) : text
}

/**
 * First words of an address that are pages of the platform itself ("instagram.com/explore", "x.com/home", the web app of Telegram), not the page of one
 * handle. Such an address keeps the name made from it.
 */
const NOT_HANDLES = new Set(['explore', 'home', 'search', 'marketplace', 'ideas', 'reels', 'reel', 'stories', 'direct', 'accounts', 'settings', 'notifications', 'messages', 'watch', 'groups', 'pages', 'hashtag', 'login', 'signup', 'about', 'help', 'share', 'events', 'friends', 'compose', 'i', 'k', 'a', 'z'])

/**
 * The handle an address of the platform stands for, written the way an owner writes it ("@yourbrand"), or null when the address is not the page
 * of one handle on this platform (a group, a search, the home page). Only a single name after the platform's own host counts.
 */
export function handleOf(preset: PlatformPreset, url: string): string | null {
  const template = preset.handleUrl
  const at = template.indexOf('{handle}')
  // The handle must be the last part of the address (a closing slash is allowed): a template with more after it is not a page of one handle.
  if (at < 0 || !['', '/'].includes(template.slice(at + '{handle}'.length))) return null
  try {
    const page = new URL(url)
    const base = new URL(template.slice(0, at))
    if (!hostMatches(page.hostname, preset.hosts) || page.protocol !== base.protocol) return null
    const prefix = base.pathname
    if (!page.pathname.startsWith(prefix)) return null
    const name = page.pathname.slice(prefix.length).replace(/\/+$/, '')
    // A page such as profile.php?id=1 is a script, not a name, and "explore" is a page of the platform: they stay named by their address.
    if (NOT_HANDLES.has(name.toLowerCase().replace(/^@/, ''))) return null
    return /^@?[A-Za-z0-9_.]{1,60}$/.test(name) && !/\.php$/i.test(name) ? `@${name.replace(/^@/, '')}` : null
  } catch {
    return null
  }
}

/** Whether a (normalized) address is on the platform's own domains. */
export function addressOnPlatform(preset: PlatformPreset, url: string): boolean {
  try {
    return hostMatches(new URL(url).hostname, preset.hosts)
  } catch {
    return false
  }
}
