// Hash routes shared by the shell and the screens. Kept apart from the components so the rules (which hashes exist, where an old link
// goes, which product a link names) live in one place and are tested without the interface (DEC-037).

import type { ApiEvent } from '../../shared/api'

/** The screens of the main menu in the order of the sidebar; Log and Settings are pinned to its bottom. */
export const PAGE_IDS = ['overview', 'review', 'inbox', 'feed', 'posts', 'channels', 'accounts', 'setup', 'logs', 'settings'] as const
export type PageId = (typeof PAGE_IDS)[number]

export function isPageId(value: string | undefined): value is PageId {
  return PAGE_IDS.some((id) => id === value)
}

/** The tabs of Setup in display order: what is configured once for a product. */
export const SETUP_TABS = ['sources', 'passport', 'analysis', 'positioning', 'goal', 'words'] as const
export type SetupTab = (typeof SETUP_TABS)[number]

export const DEFAULT_SETUP_TAB: SetupTab = 'sources'

export function isSetupTab(value: string | undefined): value is SetupTab {
  return SETUP_TABS.some((tab) => tab === value)
}

/**
 * The places of a product that the launch path points at. The first four are the tabs of Setup that are stages of the path (Positioning and
 * the audience's words are steps of Setup too, but nothing waits for them, so the path never points at them), `channels` is the Channels screen and
 * `results` the Overview; the launch path (`TAB_STAGE`, `tabAccent`) keys on these names.
 */
export const PRODUCT_TABS = ['sources', 'passport', 'analysis', 'goal', 'channels', 'results'] as const
export type ProductTab = (typeof PRODUCT_TABS)[number]

export function isProductTab(value: string | undefined): value is ProductTab {
  return PRODUCT_TABS.some((tab) => tab === value)
}

/** The account library (DEC-015). */
export const ACCOUNTS_HREF = '#/accounts'
/** What waits for the owner. */
export const INBOX_HREF = '#/inbox'
/** What happens in the channels. */
export const FEED_HREF = '#/feed'
/** How the current product is doing: goals and the metrics of its channels. */
export const OVERVIEW_HREF = '#/overview'
/** The form that makes a product: Setup with the new-product form open. */
export const NEW_PRODUCT_HREF = '#/setup/new'

/** Link to Setup, or to one of its tabs, for the current product. */
export function setupHref(tab?: SetupTab): string {
  return tab ? `#/setup/${tab}` : '#/setup'
}

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The path segments of a hash (as written), and the query after them. */
function splitHash(hash: string): { segments: string[]; query: URLSearchParams } {
  const body = hash.replace(/^#\/?/, '')
  const at = body.indexOf('?')
  return { segments: (at < 0 ? body : body.slice(0, at)).split('/').filter((segment) => segment !== ''), query: new URLSearchParams(at < 0 ? '' : body.slice(at + 1)) }
}

/** A product id given as a path segment (still percent-encoded): decoded and trimmed, and null when nothing is left. */
const idOf = (segment: string | undefined): string | null => (segment === undefined ? null : safeDecode(segment).trim() || null)

export interface ResolvedRoute {
  /** The screen, or null for a hash that names none: the shell shows the first screen then. */
  page: PageId | null
  /** The same address in its current form: an old address is rewritten to the new one and the product it names is taken out of it. */
  hash: string
  /** The product the address names (an old address, or `?product=`), or null: the current product stays as it is. */
  productId: string | null
  /** `hash` differs from what was asked, so the shell replaces the address (no history entry). */
  moved: boolean
}

/**
 * What a hash asks for. The menu changed (DEC-037), and every address of the old menu still lands on the right new screen, setting the
 * current product where the old address carried one:
 *
 * | Old | New |
 * |---|---|
 * | `#/attention` | `#/inbox` |
 * | `#/opportunities` | `#/feed` |
 * | `#/publications[/<productId>]` | `#/posts` |
 * | `#/products[/<productId>]` | `#/setup` |
 * | `#/products/<productId>/{sources,passport,analysis,goal}` | `#/setup/<tab>` |
 * | `#/products/<productId>/channels[?account=<accountId>]` | `#/channels[?account=<accountId>]` |
 * | `#/products/<productId>/results`, `#/results` | `#/overview` |
 *
 * A new address may carry `?product=<productId>`: "open this screen for that product". The Accounts screen keeps its own addresses, and its
 * `?product=` (the product the new-account form was opened from) is not this one, so it is never touched.
 */
export function resolveRoute(hash: string): ResolvedRoute {
  const { segments, query } = splitHash(hash)
  const [first = '', second, third] = segments
  if (first === 'accounts') return { page: 'accounts', hash, productId: null, moved: false }

  let page: string = first
  let rest = segments.slice(1)
  let legacyProduct: string | null = null
  let keepQuery: URLSearchParams | null = null
  switch (first) {
    case 'attention':
      page = 'inbox'
      rest = []
      break
    case 'opportunities':
      page = 'feed'
      rest = []
      break
    case 'results':
      page = 'overview'
      rest = []
      break
    case 'publications':
      page = 'posts'
      legacyProduct = idOf(second)
      rest = []
      break
    case 'products':
      legacyProduct = idOf(second)
      if (third === 'channels') {
        const account = query.get('account')?.trim()
        page = 'channels'
        rest = []
        keepQuery = new URLSearchParams(account ? { account } : {})
      } else if (third === 'results') {
        page = 'overview'
        rest = []
      } else {
        page = 'setup'
        rest = isSetupTab(third) ? [third] : []
      }
      break
    default:
  }
  if (!isPageId(page)) return { page: null, hash, productId: null, moved: false }

  const rewritten = keepQuery ?? new URLSearchParams(query)
  const asked = rewritten.get('product')?.trim() || null
  rewritten.delete('product')
  const text = rewritten.toString()
  const canonical = `#/${[page, ...rest].join('/')}${text ? `?${text}` : ''}`
  return { page, hash: canonical, productId: asked ?? legacyProduct, moved: canonical !== hash }
}

/**
 * Link to a place of a product: a tab of Setup, the Channels screen (`accountId` is the account "Connect a channel" chooses first: the one
 * just added from there, BUG-063) or the Overview. Without a tab it is Setup. Without a product it is that place for the current product.
 */
export function productHref(productId: string | null | undefined, tab?: ProductTab, accountId?: string): string {
  const place = tab === 'channels' ? '#/channels' : tab === 'results' ? OVERVIEW_HREF : setupHref(tab)
  const query = new URLSearchParams()
  if (productId) query.set('product', productId)
  if (tab === 'channels' && accountId) query.set('account', accountId)
  const text = query.toString()
  return `${place}${text ? `?${text}` : ''}`
}

/** Link to Posts for one product (the last stage of a product's launch path), or for the current one. */
export function postsHref(productId?: string | null): string {
  return productId ? `#/posts?${new URLSearchParams({ product: productId }).toString()}` : '#/posts'
}

/** Whether a link to Posts asks for the calendar (the Inbox item about dates ahead does). */
export function postsCalendarAsked(hash: string): boolean {
  return splitHash(hash).query.get('view') === 'calendar'
}

/** The account a link to the Channels screen asks "Connect a channel" to choose first, or null. */
export function channelsAccountOf(hash: string): string | null {
  const route = resolveRoute(hash)
  return route.page === 'channels' ? splitHash(route.hash).query.get('account')?.trim() || null : null
}

/** The pages of one channel (DEC-037): where it stands, what the AI plans for it, how often it prepares own posts, and how it is run. */
export const CHANNEL_TABS = ['status', 'results', 'plan', 'mix', 'settings'] as const
export type ChannelTab = (typeof CHANNEL_TABS)[number]

export const DEFAULT_CHANNEL_TAB: ChannelTab = 'status'

export function isChannelTab(value: string | undefined): value is ChannelTab {
  return CHANNEL_TABS.some((tab) => tab === value)
}

/** Link to one channel's page, on one of its tabs (the first one without a tab). */
export function channelHref(channelId: string, tab?: ChannelTab): string {
  return `#/channels/${encodeURIComponent(channelId)}${tab && tab !== DEFAULT_CHANNEL_TAB ? `/${tab}` : ''}`
}

export interface ChannelRoute {
  /** The channel whose page is asked for, or null for the list of channels. */
  channelId: string | null
  tab: ChannelTab
  /** The add-a-channel flow is open: `#/channels/new`, or the list asked for with an account just made for it (`?account=`, BUG-063). */
  adding: boolean
  /** `#/channels/new?platform=reddit`: the platform the flow starts on, or null. */
  platform: string | null
  /** `?account=`: the account the flow chooses first, or null. */
  accountId: string | null
}

/** Link to the add-a-channel flow, on a platform when one is already chosen. */
export function channelsNewHref(platform?: string): string {
  return platform ? `#/channels/new?${new URLSearchParams({ platform }).toString()}` : '#/channels/new'
}

/** What the Channels screen was asked to show: the list, or one channel on one of its tabs (an unknown tab is the first one). */
export function parseChannelHash(hash: string): ChannelRoute {
  const route = resolveRoute(hash)
  if (route.page !== 'channels') return { channelId: null, tab: DEFAULT_CHANNEL_TAB, adding: false, platform: null, accountId: null }
  const { segments, query } = splitHash(route.hash)
  const [, id, tab] = segments
  const accountId = query.get('account')?.trim() || null
  // A channel's id is never "new", so the word cannot hide a channel. An account asked for beside the list is the one just made for the flow.
  const adding = id === 'new' || (id === undefined && accountId !== null)
  return { channelId: adding ? null : idOf(id), tab: isChannelTab(tab) ? tab : DEFAULT_CHANNEL_TAB, adding, platform: query.get('platform')?.trim() || null, accountId }
}

/** What Setup was asked to show: one of its tabs, or the new-product form. */
export interface SetupRoute {
  tab: SetupTab
  /** `#/setup/new`: the form that makes a product is open. */
  creating: boolean
}

export function parseSetupHash(hash: string): SetupRoute {
  const route = resolveRoute(hash)
  if (route.page !== 'setup') return { tab: DEFAULT_SETUP_TAB, creating: false }
  const [, second] = splitHash(route.hash).segments
  return { tab: isSetupTab(second) ? second : DEFAULT_SETUP_TAB, creating: second === 'new' }
}

/** What the Accounts section was asked to show: the new-account form (possibly with a role already filled in, or the product it was opened from), or one account. */
export interface AccountsRoute {
  adding: boolean
  /** `#/accounts/<accountId>`: the account to select. Null for the bare list and for the new-account form. */
  accountId: string | null
  /** `#/accounts/new?product=<productId>`: the product the form was opened from, which the app returns to afterwards. Only the form carries one. */
  productId: string | null
  role: { name: string; voice: string } | null
  /** `#/accounts/new?platform=reddit`: the platform the form starts on (the owner chose it in the add-a-channel flow); absent otherwise. */
  platform?: string
}

/** Link to one account of the Accounts section (the account an Inbox item is about). */
export function accountHref(accountId: string): string {
  return `${ACCOUNTS_HREF}/${encodeURIComponent(accountId)}`
}

/**
 * Link to the new-account form of the Accounts section. "Use this role" on the Channels screen passes the role along; the Channels screen
 * passes the product, so that the new account is made for it and the app returns to that screen afterwards.
 */
export function accountsNewHref(role?: { name: string; voice: string }, productId?: string, platform?: string): string {
  const params = new URLSearchParams()
  if (role) {
    params.set('name', role.name)
    params.set('voice', role.voice)
  }
  if (productId) params.set('product', productId)
  if (platform) params.set('platform', platform)
  const query = params.toString()
  return query ? `#/accounts/new?${query}` : '#/accounts/new'
}

/** Reads `#/accounts`, `#/accounts/<accountId>` and `#/accounts/new?name=…&voice=…&product=…`. */
export function parseAccountsHash(hash: string): AccountsRoute {
  const body = hash.replace(/^#\/?/, '')
  const at = body.indexOf('?')
  const segments = (at < 0 ? body : body.slice(0, at)).split('/').filter((segment) => segment !== '')
  const onAccounts = segments[0] === 'accounts'
  const adding = onAccounts && segments[1] === 'new'
  const params = new URLSearchParams(at < 0 ? '' : body.slice(at + 1))
  const name = params.get('name')?.trim() ?? ''
  return {
    adding,
    accountId: onAccounts && !adding && segments[1] ? safeDecode(segments[1]) : null,
    productId: adding ? params.get('product')?.trim() || null : null,
    role: adding && name ? { name, voice: params.get('voice')?.trim() ?? '' } : null,
    ...(adding && params.get('platform')?.trim() ? { platform: params.get('platform')!.trim() } : {})
  }
}

/** The hash a `navigate` event from the main process asks the window to show (the "Settings…" menu item), or null for any other event or a malformed hash. */
export function navigateHashOf(event: ApiEvent): string | null {
  return event.type === 'navigate' && /^#\/\S*$/.test(event.hash) ? event.hash : null
}
