import { useEffect, useState } from 'react'
import { AgentQuestionDialog } from './AgentQuestionDialog'
import { AiPill } from './AiProgress'
import { useAutomation, useQuery } from './hooks'
import { readMenuOpen, saveMenuOpen, type MenuStorage } from './menu-state'
import { PAGES } from './pages'
import { MOVED_PAGES, parseHash } from './route'
import { Badge, Button } from './ui'

/**
 * The page is the first segment of the hash; `#/products/<productId>/<tab>` is still the Products page, which reads
 * the rest itself. Old Channels and Results links are redirected (without a history entry) to the product list.
 */
function useHashRoute(): string {
  const read = (): string => {
    const { page } = parseHash(window.location.hash)
    const moved = MOVED_PAGES[page]
    if (moved) {
      window.history.replaceState(null, '', `#/${moved}`)
      return moved
    }
    return PAGES.some((p) => p.id === page) ? page : PAGES[0].id
  }
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onChange = (): void => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** The browser's storage, or undefined where the browser refuses even to hand it out. */
function browserStorage(): MenuStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

export function App() {
  const route = useHashRoute()
  const [menuOpen, setMenuOpen] = useState(() => readMenuOpen(browserStorage()))
  const showMenu = (open: boolean): void => {
    setMenuOpen(open)
    saveMenuOpen(browserStorage(), open)
  }
  const { state, setPaused } = useAutomation()
  const attention = useQuery('attention.list', undefined, ['attention', 'opportunities', 'channels', 'accounts'])
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const Current = (PAGES.find((p) => p.id === route) ?? PAGES[0]).component

  const engine = engines.data?.find((e) => e.id === settings.data?.engineId)
  const attentionCount = attention.data?.length ?? 0

  return (
    <div className={`shell ${menuOpen ? '' : 'menu-closed'}`} data-testid="shell">
      {menuOpen && (
        <aside className="sidebar" data-testid="sidebar">
          <div className="brand">Promotion Desk</div>
          <nav aria-label="Work areas">
            {PAGES.map((page) => (
              <a
                key={page.id}
                href={`#/${page.id}`}
                className={`nav-item ${page.id === route ? 'active' : ''}`}
                onClick={(e) => {
                  // Already here: keep the open product and tab instead of resetting the hash to the bare page.
                  if (page.id === route) e.preventDefault()
                }}
                data-testid={`nav-${page.id}`}
              >
                <span>{page.label}</span>
                {page.id === 'attention' && attentionCount > 0 && <span className="count">{attentionCount}</span>}
              </a>
            ))}
          </nav>
          <div className="sidebar-foot">
            <Button onClick={() => showMenu(false)} title="Hide the menu to give the page the whole window" data-testid="menu-hide">
              Hide menu
            </Button>
          </div>
        </aside>
      )}
      <div className="main">
        <header className="topbar" data-testid="topbar">
          <div className="row">
            {!menuOpen && (
              <Button onClick={() => showMenu(true)} title="Show the menu" data-testid="menu-show">
                Menu{attentionCount > 0 ? ` · ${attentionCount}` : ''}
              </Button>
            )}
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
            <AiPill />
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
      <AgentQuestionDialog />
    </div>
  )
}
