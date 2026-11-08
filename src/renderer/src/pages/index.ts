import type { ComponentType } from 'react'
import { AccountsPage } from './Accounts'
import { AttentionPage } from './Attention'
import { LogsPage } from './Logs'
import { OpportunitiesPage } from './Opportunities'
import { ProductsPage } from './Products'
import { PublicationsPage } from './Publications'
import { SettingsPage } from './Settings'

export interface PageDef {
  id: string
  label: string
  component: ComponentType
}

/** The main-menu areas (DEC-009, DEC-015). Channels and Results are tabs of the product page, not entries here; accounts are one library of their own. */
export const PAGES: PageDef[] = [
  { id: 'attention', label: 'Attention', component: AttentionPage },
  { id: 'products', label: 'Products', component: ProductsPage },
  { id: 'accounts', label: 'Accounts', component: AccountsPage },
  { id: 'opportunities', label: 'Opportunities', component: OpportunitiesPage },
  { id: 'publications', label: 'Publications', component: PublicationsPage },
  { id: 'logs', label: 'Log', component: LogsPage },
  { id: 'settings', label: 'Settings', component: SettingsPage }
]
