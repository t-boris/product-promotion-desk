import { useEffect, useState } from 'react'
import { AgentQuestionDialog } from './AgentQuestionDialog'
import { AiPill } from './AiProgress'
import { attentionCountTone } from './pages/attention-tone'
import { useAutomation, useQuery } from './hooks'
import { readMenuOpen, saveMenuOpen, type MenuStorage } from './menu-state'
import { PAGES } from './pages'
import { MOVED_PAGES, parseHash } from './route'
import { NO_ACCOUNTS, NO_ENGINE, accountsGroupName, accountsSummary, automationText, engineGroupName } from './status-labels'
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
  const info = useQuery('app.info', undefined, [])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const Current = (PAGES.find((p) => p.id === route) ?? PAGES[0]).component

  const engine = engines.data?.find((e) => e.id === settings.data?.engineId)
  const attentionCount = attention.data?.length ?? 0
  const accountsBadge = accountsSummary(accounts.data ?? [])
  const countTone = attentionCountTone(attention.data?.map((item) => item.kind) ?? [])

  return (
    <div className={`shell ${menuOpen ? '' : 'menu-closed'}`} data-testid="shell">
      {menuOpen && (
        <aside className="sidebar" data-testid="sidebar">
          <div className="brand">
            {/* The launch glyph: three rising bars in the accent tile, drawn in CSS (BUG-036). */}
            <span className="brand-mark" aria-hidden="true" data-testid="brand-mark">
              <span />
              <span />
              <span />
            </span>
            <span>Promotion Desk</span>
          </div>
          <nav aria-label="Work areas">
            {PAGES.map((page) => (
              <a
                key={page.id}
                href={`#/${page.id}`}
                className={`nav-item ${page.id === route ? 'active' : ''}`}
                aria-current={page.id === route ? 'page' : undefined}
                onClick={(e) => {
                  // Already here: keep the open product and tab instead of resetting the hash to the bare page.
                  if (page.id === route) e.preventDefault()
                }}
                data-testid={`nav-${page.id}`}
              >
                <span>{page.label}</span>
                {page.id === 'attention' && countTone && (
                  <span className={`count ${countTone}`} data-testid="attention-count">
                    {attentionCount}
                  </span>
                )}
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
            <span title="Version of this application" data-testid="app-version-header">
              <Badge tone="info">{info.data ? `v${info.data.version}` : 'v…'}</Badge>
            </span>
            {/* Each label and its value are one named group, so a screen reader or a test tool reads "AI engine: Codex" and
                "Accounts: None connected", not two loose texts. The groups add no box of their own (display: contents). */}
            <span className="status-group" role="group" aria-label={engineGroupName(engine)}>
              <span className="topbar-label">AI engine</span>
              {engine ? (
                <Badge tone={engine.ready ? 'good' : 'warn'}>{engine.label}</Badge>
              ) : (
                <a className="badge badge-warn" href="#/settings" title="Choose an AI engine in Settings">
                  {NO_ENGINE}
                </a>
              )}
            </span>
            <span className="status-group" role="group" aria-label={accountsGroupName(accounts.data)}>
              <span className="topbar-label">Accounts</span>
              {accountsBadge ? (
                <a className={`badge badge-${accountsBadge.tone}`} href="#/accounts" title={accountsBadge.title} data-testid="accounts-summary">
                  {accountsBadge.text}
                </a>
              ) : (
                <a className="badge badge-warn" href="#/accounts/new" title="Connect an account: nothing can run without one" data-testid="connect-account-link">
                  {NO_ACCOUNTS}
                </a>
              )}
            </span>
          </div>
          <div className="row">
            <AiPill />
            {state?.background && <Badge tone="info">Background</Badge>}
            {/* One text, not "Automation " and "running" as two nodes: the state reads as one statement in the accessibility tree.
                The dot gives the state a colour (amber while paused) so it does not read as a grey caption. */}
            <span className="status-pill" title={automationText(state)} data-testid="automation-state-pill">
              <span className={`dot ${state ? (state.paused ? 'warn' : 'good') : ''}`} aria-hidden="true" />
              <span className="status-words" data-testid="automation-state">
                {automationText(state)}
              </span>
            </span>
            {/* Never the filled button: the page's own main action ("New product") keeps that, and a paused app must stay resumable. */}
            <Button
              variant="ghost"
              onClick={() => void setPaused(!state?.paused)}
              disabled={!state}
              title={state?.paused && accounts.data?.length === 0 ? 'Nothing would run yet: no account is connected.' : undefined}
              data-testid="pause-toggle"
            >
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
