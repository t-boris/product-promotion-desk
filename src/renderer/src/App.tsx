import { useEffect, useState } from 'react'
import { useAutomation, useQuery } from './hooks'
import { PAGES } from './pages'
import { Badge, Button } from './ui'

function useHashRoute(): [string, (id: string) => void] {
  const read = (): string => {
    const id = window.location.hash.replace(/^#\/?/, '')
    return PAGES.some((p) => p.id === id) ? id : PAGES[0].id
  }
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = (): void => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return [route, (id) => (window.location.hash = `/${id}`)]
}

export function App() {
  const [route, go] = useHashRoute()
  const { state, setPaused } = useAutomation()
  const attention = useQuery('attention.list', undefined, ['attention', 'opportunities', 'channels', 'accounts'])
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const Current = (PAGES.find((p) => p.id === route) ?? PAGES[0]).component

  const engine = engines.data?.find((e) => e.id === settings.data?.engineId)
  const attentionCount = attention.data?.length ?? 0

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Promotion Desk</div>
        <nav aria-label="Work areas">
          {PAGES.map((page) => (
            <a key={page.id} href={`#/${page.id}`} className={`nav-item ${page.id === route ? 'active' : ''}`} onClick={() => go(page.id)} data-testid={`nav-${page.id}`}>
              <span>{page.label}</span>
              {page.id === 'attention' && attentionCount > 0 && <span className="count">{attentionCount}</span>}
            </a>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar" data-testid="topbar">
          <div className="row">
            <span className="muted small">AI engine</span>
            {engine ? <Badge tone={engine.ready ? 'good' : 'warn'}>{engine.label}</Badge> : <Badge tone="warn">None selected</Badge>}
            <span className="muted small sep">Accounts</span>
            {accounts.data && accounts.data.length > 0 ? (
              accounts.data.map((a) => (
                <Badge key={a.id} tone={a.status === 'ready' ? 'good' : 'warn'}>
                  {a.label}
                  {a.identity ? ` · ${a.identity}` : ''}
                </Badge>
              ))
            ) : (
              <Badge>None connected</Badge>
            )}
          </div>
          <div className="row">
            {state?.background && <Badge tone="info">Background</Badge>}
            <span className="muted small" data-testid="automation-state">
              Automation {state ? (state.paused ? 'paused' : 'running') : '…'}
            </span>
            <Button variant={state?.paused ? 'primary' : 'ghost'} onClick={() => void setPaused(!state?.paused)} disabled={!state} data-testid="pause-toggle">
              {state?.paused ? 'Resume automation' : 'Pause automation'}
            </Button>
          </div>
        </header>
        <main className="content">
          <Current />
        </main>
      </div>
    </div>
  )
}
