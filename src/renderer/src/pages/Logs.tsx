import { useState } from 'react'
import { Page } from '../ui'
import { EventsTab } from './logs/EventsTab'
import { HistoryTab } from './logs/HistoryTab'
import { RunsTab } from './logs/RunsTab'

type TabId = 'runs' | 'history' | 'events'

const TABS: { id: TabId; label: string }[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'history', label: 'Action history' },
  { id: 'events', label: 'Events' }
]

export function LogsPage() {
  const [tab, setTab] = useState<TabId>('runs')
  return (
    <Page title="Log" subtitle="Runs, actions, errors and the basis for every send">
      <div className="tabs" role="tablist" aria-label="Log sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'runs' && <RunsTab />}
      {tab === 'history' && <HistoryTab />}
      {tab === 'events' && <EventsTab />}
    </Page>
  )
}
