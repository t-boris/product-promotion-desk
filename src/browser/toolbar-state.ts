// State machine and static markup of the toolbar shown above the account's browser window when the user has
// control. Pure: the Electron glue only feeds events in and renders the view out.

export type ToolbarPhase = 'user_control' | 'released'

export interface ToolbarState {
  phase: ToolbarPhase
  accountLabel: string
  /** Platform identity confirmed after login; null until confirmed. */
  identity: string | null
  url: string
  canGoBack: boolean
  loading: boolean
}

export type ToolbarEvent =
  | { type: 'navigated'; url: string; canGoBack: boolean }
  | { type: 'loading'; loading: boolean }
  | { type: 'release' }

export function initialToolbar(account: { label: string; identity: string | null }, url: string): ToolbarState {
  return { phase: 'user_control', accountLabel: account.label, identity: account.identity, url, canGoBack: false, loading: true }
}

export function reduceToolbar(state: ToolbarState, event: ToolbarEvent): ToolbarState {
  // Once control is handed back the toolbar is frozen: nothing may re-enable the user-control state.
  if (state.phase === 'released') return state
  switch (event.type) {
    case 'navigated':
      return { ...state, url: event.url, canGoBack: event.canGoBack }
    case 'loading':
      return { ...state, loading: event.loading }
    case 'release':
      return { ...state, phase: 'released', loading: false }
  }
}

/** What the static toolbar page renders. All fields are plain strings/booleans, set through textContent. */
export interface ToolbarView {
  account: string
  identity: string
  url: string
  canGoBack: boolean
  loading: boolean
  releaseEnabled: boolean
}

export function toolbarView(state: ToolbarState): ToolbarView {
  return {
    account: state.accountLabel,
    identity: state.identity ? `signed in as ${state.identity}` : 'identity not confirmed yet',
    url: state.url,
    canGoBack: state.canGoBack,
    loading: state.loading,
    releaseEnabled: state.phase === 'user_control'
  }
}

export type ToolbarCommand = 'back' | 'reload' | 'release'

/** Toolbar buttons are links to this reserved host; the main process intercepts them and never navigates. */
export const TOOLBAR_COMMAND_ORIGIN = 'https://ppd-toolbar.invalid'

export function parseToolbarCommand(url: string): ToolbarCommand | null {
  if (!url.startsWith(`${TOOLBAR_COMMAND_ORIGIN}/`)) return null
  const command = url.slice(TOOLBAR_COMMAND_ORIGIN.length + 1).replace(/[/?#].*$/, '')
  return command === 'back' || command === 'reload' || command === 'release' ? command : null
}

export const RELEASE_LABEL = 'Give control back to the app'

/** Static markup: no dynamic data is interpolated; the view is pushed in through window.ppdUpdate(). */
export function toolbarHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; font: 13px -apple-system, BlinkMacSystemFont, sans-serif; background: #1d2026; color: #e6e8ec; overflow: hidden; }
  .bar { display: flex; align-items: center; gap: 8px; height: 100%; padding: 0 10px 0 78px; box-sizing: border-box; -webkit-app-region: drag; }
  .bar a, .bar .who, .bar .url { -webkit-app-region: no-drag; }
  .who { white-space: nowrap; }
  .who b { font-weight: 600; }
  .who span { color: #9aa3b2; }
  .btn { color: #e6e8ec; text-decoration: none; border: 1px solid #3a404c; border-radius: 6px; padding: 4px 10px; white-space: nowrap; }
  .btn:hover { background: #2a2f38; }
  .btn.disabled { opacity: .4; pointer-events: none; }
  .btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; font-weight: 600; }
  .url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa3b2; background: #14161a; border-radius: 6px; padding: 5px 10px; }
</style></head>
<body><div class="bar">
  <div class="who" id="who"><b id="account"></b> <span id="identity"></span></div>
  <a class="btn" id="back" href="${TOOLBAR_COMMAND_ORIGIN}/back" target="_blank" rel="noopener">Back</a>
  <a class="btn" id="reload" href="${TOOLBAR_COMMAND_ORIGIN}/reload" target="_blank" rel="noopener">Reload</a>
  <div class="url" id="url"></div>
  <a class="btn primary" id="release" href="${TOOLBAR_COMMAND_ORIGIN}/release" target="_blank" rel="noopener">${RELEASE_LABEL}</a>
</div>
<script>
  window.ppdUpdate = function (view) {
    document.getElementById('account').textContent = view.account;
    document.getElementById('identity').textContent = '· ' + view.identity;
    document.getElementById('url').textContent = view.url;
    document.getElementById('back').classList.toggle('disabled', !view.canGoBack);
    document.getElementById('reload').textContent = view.loading ? 'Loading…' : 'Reload';
    document.getElementById('release').classList.toggle('disabled', !view.releaseEnabled);
  };
</script></body></html>`
}

/**
 * Ties the toolbar to the session: the user takes control exactly once and gives it back exactly once, however
 * many times the button and the window-closed event fire. A late close of an old window therefore can never
 * release the control of a newer one.
 */
export class UserControl {
  private active = false

  constructor(private readonly session: { takeControl(): void; releaseControl(): void }) {}

  begin(): void {
    if (this.active) return
    this.active = true
    this.session.takeControl()
  }

  /** Returns true only for the call that actually released control. */
  release(): boolean {
    if (!this.active) return false
    this.active = false
    this.session.releaseControl()
    return true
  }

  get holdsControl(): boolean {
    return this.active
  }
}
