// State and static markup of the toolbar shown above one of the owner's windows on an account's browser (DEC-038, DEC-099).
// The window is an additional window of the account's own session: it takes the browser from nobody, so the toolbar has no hand-back;
// it shows a slim tab strip (multiple tabs inside the same session, `+` to open a tab, `×` to close one), whose session this is,
// and Back, Reload, address display, and Close window. Pure: the Electron glue only feeds events in and renders the view out.

export interface ToolbarTab {
  id: string
  title: string
  url: string
  loading: boolean
}

export interface ToolbarState {
  accountLabel: string
  /** Platform identity confirmed after login; null until confirmed. */
  identity: string | null
  url: string
  canGoBack: boolean
  loading: boolean
  tabs: ToolbarTab[]
  activeTabId: string
}

export type ToolbarEvent =
  | { type: 'navigated'; url: string; canGoBack: boolean; tabId?: string }
  | { type: 'loading'; loading: boolean; tabId?: string }
  | { type: 'title'; title: string; tabId?: string }
  | { type: 'tabs'; tabs: ToolbarTab[]; activeTabId: string; url: string; canGoBack: boolean; loading: boolean }

/** Short fallback label for a tab before its page announces a title: host name, or the address itself. */
export function tabTitleFallback(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host.replace(/^www\./i, '') || url
  } catch {
    return url || 'New tab'
  }
}

export function initialToolbar(account: { label: string; identity: string | null }, url: string, tabId = 't1'): ToolbarState {
  return {
    accountLabel: account.label,
    identity: account.identity,
    url,
    canGoBack: false,
    loading: true,
    tabs: [{ id: tabId, title: tabTitleFallback(url), url, loading: true }],
    activeTabId: tabId
  }
}

export function reduceToolbar(state: ToolbarState, event: ToolbarEvent): ToolbarState {
  switch (event.type) {
    case 'navigated': {
      const target = event.tabId ?? state.activeTabId
      const tabs = state.tabs.map((tab) => (tab.id === target ? { ...tab, url: event.url, title: tab.title || tabTitleFallback(event.url) } : tab))
      return target === state.activeTabId ? { ...state, url: event.url, canGoBack: event.canGoBack, tabs } : { ...state, tabs }
    }
    case 'loading': {
      const target = event.tabId ?? state.activeTabId
      const tabs = state.tabs.map((tab) => (tab.id === target ? { ...tab, loading: event.loading } : tab))
      return target === state.activeTabId ? { ...state, loading: event.loading, tabs } : { ...state, tabs }
    }
    case 'title': {
      const target = event.tabId ?? state.activeTabId
      const clean = event.title.trim()
      if (!clean) return state
      const tabs = state.tabs.map((tab) => (tab.id === target ? { ...tab, title: clean } : tab))
      return { ...state, tabs }
    }
    case 'tabs':
      return {
        ...state,
        tabs: event.tabs,
        activeTabId: event.activeTabId,
        url: event.url,
        canGoBack: event.canGoBack,
        loading: event.loading
      }
  }
}

/** What the static toolbar page renders. All fields are plain strings/booleans, set through textContent. */
export interface ToolbarView {
  account: string
  identity: string
  url: string
  canGoBack: boolean
  loading: boolean
  tabs: { id: string; title: string; active: boolean; loading: boolean }[]
}

export function toolbarView(state: ToolbarState): ToolbarView {
  return {
    account: state.accountLabel,
    identity: state.identity ? `signed in as ${state.identity}` : 'identity not confirmed yet',
    url: state.url,
    canGoBack: state.canGoBack,
    loading: state.loading,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || tabTitleFallback(tab.url),
      active: tab.id === state.activeTabId,
      loading: tab.loading
    }))
  }
}

export type ToolbarCommand = 'back' | 'reload' | 'close' | 'new-tab' | { type: 'select-tab'; id: string } | { type: 'close-tab'; id: string }

/** Toolbar buttons are links to this reserved host; the main process intercepts them and never navigates. */
export const TOOLBAR_COMMAND_ORIGIN = 'https://ppd-toolbar.invalid'

const TAB_ID_PATTERN = /^[a-z0-9-]+$/

export function parseToolbarCommand(url: string): ToolbarCommand | null {
  if (!url.startsWith(`${TOOLBAR_COMMAND_ORIGIN}/`)) return null
  const path = url.slice(TOOLBAR_COMMAND_ORIGIN.length + 1).replace(/[?#].*$/, '')
  const [command, arg, extra] = path.split('/')
  if (extra !== undefined) return null
  if (arg === undefined) {
    return command === 'back' || command === 'reload' || command === 'close' || command === 'new-tab' ? command : null
  }
  if (!TAB_ID_PATTERN.test(arg)) return null
  if (command === 'tab') return { type: 'select-tab', id: arg }
  if (command === 'close-tab') return { type: 'close-tab', id: arg }
  return null
}

/** The window is the owner's own; this button closes it. Nothing else is handed back, because nothing was taken. */
export const CLOSE_LABEL = 'Close window'

/** Static markup: no dynamic data is interpolated; the view is pushed in through window.ppdUpdate(). */
export function toolbarHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; font: 13px -apple-system, BlinkMacSystemFont, sans-serif; background: #1d2026; color: #e6e8ec; overflow: hidden; }
  .shell { display: flex; flex-direction: column; height: 100%; }
  .tabstrip { display: flex; align-items: center; gap: 4px; height: 34px; padding: 4px 10px 0 78px; box-sizing: border-box; background: #14161a; -webkit-app-region: drag; }
  .tabs { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { display: inline-flex; align-items: center; gap: 6px; max-width: 210px; min-width: 84px; height: 28px; padding: 0 6px 0 10px; border-radius: 6px 6px 0 0; background: #1b1e24; color: #9aa3b2; -webkit-app-region: no-drag; box-sizing: border-box; }
  .tab.active { background: #1d2026; color: #e6e8ec; }
  .tab-link { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: inherit; text-decoration: none; font-size: 12px; line-height: 28px; }
  .tab-close { color: #9aa3b2; text-decoration: none; font-size: 14px; line-height: 1; padding: 2px 4px; border-radius: 4px; }
  .tab-close:hover { background: #2a2f38; color: #e6e8ec; }
  .tab-new { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; color: #e6e8ec; text-decoration: none; font-size: 16px; line-height: 1; -webkit-app-region: no-drag; }
  .tab-new:hover { background: #2a2f38; }
  .bar { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 10px; box-sizing: border-box; }
  .bar a, .bar .who, .bar .url { -webkit-app-region: no-drag; }
  .who { white-space: nowrap; }
  .who b { font-weight: 600; }
  .who span { color: #9aa3b2; }
  .btn { color: #e6e8ec; text-decoration: none; border: 1px solid #3a404c; border-radius: 6px; padding: 4px 10px; white-space: nowrap; }
  .btn:hover { background: #2a2f38; }
  .btn.disabled { opacity: .4; pointer-events: none; }
  .url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa3b2; background: #14161a; border-radius: 6px; padding: 5px 10px; }
</style></head>
<body><div class="shell">
  <div class="tabstrip">
    <div class="tabs" id="tabs"></div>
    <a class="tab-new" id="new-tab" href="${TOOLBAR_COMMAND_ORIGIN}/new-tab" target="_blank" rel="noopener" title="New tab">+</a>
  </div>
  <div class="bar">
    <div class="who" id="who"><b id="account"></b> <span id="identity"></span></div>
    <a class="btn" id="back" href="${TOOLBAR_COMMAND_ORIGIN}/back" target="_blank" rel="noopener">Back</a>
    <a class="btn" id="reload" href="${TOOLBAR_COMMAND_ORIGIN}/reload" target="_blank" rel="noopener">Reload</a>
    <div class="url" id="url"></div>
    <a class="btn" id="close" href="${TOOLBAR_COMMAND_ORIGIN}/close" target="_blank" rel="noopener">${CLOSE_LABEL}</a>
  </div>
</div>
<script>
  window.ppdUpdate = function (view) {
    document.getElementById('account').textContent = view.account;
    document.getElementById('identity').textContent = '· ' + view.identity;
    document.getElementById('url').textContent = view.url;
    document.getElementById('back').classList.toggle('disabled', !view.canGoBack);
    document.getElementById('reload').textContent = view.loading ? 'Loading…' : 'Reload';
    var list = document.getElementById('tabs');
    list.textContent = '';
    (view.tabs || []).forEach(function (tab) {
      var item = document.createElement('div');
      item.className = 'tab' + (tab.active ? ' active' : '');
      var link = document.createElement('a');
      link.className = 'tab-link';
      link.href = '${TOOLBAR_COMMAND_ORIGIN}/tab/' + encodeURIComponent(tab.id);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = tab.title;
      link.title = tab.title;
      var close = document.createElement('a');
      close.className = 'tab-close';
      close.href = '${TOOLBAR_COMMAND_ORIGIN}/close-tab/' + encodeURIComponent(tab.id);
      close.target = '_blank';
      close.rel = 'noopener';
      close.textContent = '×';
      close.title = 'Close tab';
      item.appendChild(link);
      item.appendChild(close);
      list.appendChild(item);
    });
  };
</script></body></html>`
}
