import { useState } from 'react'
import { AgentQuestionDialog } from './AgentQuestionDialog'
import { AiPill } from './AiProgress'
import { FeedCount } from './FeedCount'
import { attentionCountTone } from './pages/attention-tone'
import { useAutomation, useEvents, useQuery } from './hooks'
import { Icon, type IconName } from './icons'
import { readMenuOpen, saveMenuOpen, type MenuStorage } from './menu-state'
import { PAGES } from './pages'
import { useCurrentProduct } from './product-context'
import { ProductSwitcher } from './ProductSwitcher'
import { navigateHashOf, type PageId } from './route'
import { NO_ACCOUNTS, NO_ENGINE, accountsGroupName, accountsSummary, automationText, engineGroupName } from './status-labels'
import { Badge, Button, IconButton } from './ui'
import type { Tone } from './tone'
import { useHashRoute } from './use-hash-route'

/** One glyph per main area; the ids are the ones of `PAGES`. */
const NAV_ICONS: Record<PageId, IconName> = {
  overview: 'overview',
  inbox: 'inbox',
  feed: 'feed',
  posts: 'posts',
  channels: 'channels',
  accounts: 'accounts',
  setup: 'setup',
  logs: 'logs',
  settings: 'settings'
}
/** Log and Settings are pinned to the bottom of the sidebar; the order of the others does not change. */
const FOOT_PAGES = new Set<PageId>(['logs', 'settings'])

/** The colour of a status dot for a tone: grey for neutral and informational. */
function dotTone(tone: Tone): string {
  return tone === 'good' || tone === 'warn' || tone === 'bad' ? tone : ''
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
  // The native menu's "Settings…" (BUG-048): the main process sends a navigate event to this window, and the hash route does the rest.
  useEvents((event) => {
    const hash = navigateHashOf(event)
    if (hash) window.location.hash = hash
  })
  const { current: currentProduct } = useCurrentProduct()
  // The number beside Inbox is the open product's, like the Inbox list: what waits for the owner in another product is not counted here.
  const attention = useQuery('attention.list', currentProduct ? { productId: currentProduct.id } : undefined, ['attention', 'opportunities', 'channels', 'accounts'], { skip: currentProduct === null })
  const accounts = useQuery('accounts.list', undefined, ['accounts'])
  const info = useQuery('app.info', undefined, [])
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const engines = useQuery('engines.list', undefined, ['settings'])
  const Current = (PAGES.find((p) => p.id === route) ?? PAGES[0]).component

  const engine = engines.data?.find((e) => e.id === settings.data?.engineId)
  const attentionCount = currentProduct ? (attention.data?.length ?? 0) : 0
  const accountsBadge = accountsSummary(accounts.data ?? [])
  const countTone = currentProduct ? attentionCountTone(attention.data?.map((item) => item.kind) ?? []) : null

  const navItem = (page: (typeof PAGES)[number]) => (
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
      <Icon name={NAV_ICONS[page.id]} />
      <span>{page.label}</span>
      {page.id === 'feed' && currentProduct && <FeedCount key={currentProduct.id} productId={currentProduct.id} />}
      {page.id === 'inbox' && countTone && (
        <span className={`count ${countTone}`} data-testid="attention-count">
          {attentionCount}
        </span>
      )}
    </a>
  )

  return (
    <div className={`shell ${menuOpen ? '' : 'menu-closed'}`} data-testid="shell">
      {menuOpen && (
        <aside className="sidebar" data-testid="sidebar">
          {/* The band is as high as the toolbar: the window buttons are drawn by macOS at its left, the toggle sits at its right. */}
          <div className="sidebar-band">
            <IconButton icon="sidebar" label="Hide menu" onClick={() => showMenu(false)} data-testid="menu-hide" />
          </div>
          <div className="brand">
            {/* The launch glyph: three rising bars in the accent tile, drawn in CSS (BUG-036). */}
            <span className="brand-mark" aria-hidden="true" data-testid="brand-mark">
              <span />
              <span />
              <span />
            </span>
            <span>Promotion Desk</span>
          </div>
          <ProductSwitcher />
          <nav aria-label="Work areas">
            <div className="nav-group">{PAGES.filter((page) => !FOOT_PAGES.has(page.id)).map(navItem)}</div>
            <div className="nav-group nav-foot">{PAGES.filter((page) => FOOT_PAGES.has(page.id)).map(navItem)}</div>
          </nav>
        </aside>
      )}
      <div className="main">
        <header className="topbar" data-testid="topbar">
          <div className="tb-lead">
            {!menuOpen && <IconButton icon="sidebar" label={`Menu${attentionCount > 0 ? ` · ${attentionCount}` : ''}`} title="Show the menu" count={attentionCount} countTone={countTone} onClick={() => showMenu(true)} data-testid="menu-show" />}
            <span title="Version of this application" data-testid="app-version-header">
              <Badge>{info.data ? `v${info.data.version}` : 'v…'}</Badge>
            </span>
            {/* Each label and its value are one named group, so a screen reader or a test tool reads "AI engine: Codex" and
                "Accounts: None connected", not two loose texts. */}
            <span className="status-group" role="group" aria-label={engineGroupName(engine)}>
              <span className="topbar-label">AI engine</span>
              {engine ? (
                <span className="tb-value">
                  <span className={`dot ${engine.ready ? 'good' : 'warn'}`} aria-hidden="true" />
                  {engine.label}
                </span>
              ) : (
                <a className="tb-value" href="#/settings" title="Choose an AI engine in Settings">
                  <span className="dot warn" aria-hidden="true" />
                  {NO_ENGINE}
                </a>
              )}
            </span>
            <span className="status-group" role="group" aria-label={accountsGroupName(accounts.data)}>
              <span className="topbar-label">Accounts</span>
              {accountsBadge ? (
                <a className="tb-value" href="#/accounts" title={accountsBadge.title} data-testid="accounts-summary">
                  <span className={`dot ${dotTone(accountsBadge.tone)}`} aria-hidden="true" />
                  {accountsBadge.text}
                </a>
              ) : (
                <a className="tb-value" href="#/accounts/new" title="Connect an account: nothing can run without one" data-testid="connect-account-link">
                  <span className="dot warn" aria-hidden="true" />
                  {NO_ACCOUNTS}
                </a>
              )}
            </span>
          </div>
          <div className="tb-trail">
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
            {/* Never the filled button: the page's own main action keeps that, and a paused app must stay resumable. */}
            <Button
              variant="ghost"
              className="btn-toolbar"
              icon={state?.paused ? 'play' : 'pause'}
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
