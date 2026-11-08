import type { ComponentType } from 'react'
import { AttentionPage } from './Attention'
import { ChannelsPage } from './Channels'
import { LogsPage } from './Logs'
import { OpportunitiesPage } from './Opportunities'
import { ProductsPage } from './Products'
import { PublicationsPage } from './Publications'
import { ResultsPage } from './Results'
import { SettingsPage } from './Settings'

export interface PageDef {
  id: string
  label: string
  component: ComponentType
}

/** The eight work areas of version 1, in navigation order. */
export const PAGES: PageDef[] = [
  { id: 'attention', label: 'Attention', component: AttentionPage },
  { id: 'products', label: 'Products', component: ProductsPage },
  { id: 'channels', label: 'Channels', component: ChannelsPage },
  { id: 'opportunities', label: 'Opportunities', component: OpportunitiesPage },
  { id: 'publications', label: 'Publications', component: PublicationsPage },
  { id: 'results', label: 'Results', component: ResultsPage },
  { id: 'logs', label: 'Log', component: LogsPage },
  { id: 'settings', label: 'Settings', component: SettingsPage }
]
