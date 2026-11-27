import type { ComponentType } from 'react'
import { PAGE_IDS, type PageId } from '../route'
import { AccountsPage } from './Accounts'
import { ChannelsPage } from './Channels'
import { FeedPage } from './Feed'
import { InboxPage } from './Inbox'
import { LogsPage } from './Logs'
import { OverviewPage } from './Overview'
import { PostsPage } from './Posts'
import { ReviewPage } from './Review'
import { SettingsPage } from './Settings'
import { PeoplePage } from './People'
import { SetupPage } from './Setup'

export interface PageDef {
  id: PageId
  label: string
  component: ComponentType
}

const SCREENS: Record<PageId, { label: string; component: ComponentType }> = {
  overview: { label: 'Overview', component: OverviewPage },
  review: { label: 'Review', component: ReviewPage },
  inbox: { label: 'Inbox', component: InboxPage },
  feed: { label: 'Feed', component: FeedPage },
  people: { label: 'People', component: PeoplePage },
  posts: { label: 'Posts', component: PostsPage },
  channels: { label: 'Channels', component: ChannelsPage },
  accounts: { label: 'Accounts', component: AccountsPage },
  setup: { label: 'Setup', component: SetupPage },
  logs: { label: 'Log', component: LogsPage },
  settings: { label: 'Settings', component: SettingsPage }
}

/**
 * The main-menu areas in the order of the sidebar, which `PAGE_IDS` of the route module sets (DEC-037, DEC-015). The product is the
 * context: every area but Accounts, Log and Settings shows the current product's work; accounts are one library of their own.
 */
export const PAGES: PageDef[] = PAGE_IDS.map((id) => ({ id, ...SCREENS[id] }))
