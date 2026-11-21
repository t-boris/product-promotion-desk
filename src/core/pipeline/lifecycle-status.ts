// What the menu-bar item shows while every window is closed (REQ-005: status and pause stay reachable).
// Kept free of Electron so the wording and the rules are testable; src/main/tray.ts only renders this model.

import { APP_NAME } from '../../shared/app-name'
import type { AutomationState } from '../../shared/types'

export interface TrayModel {
  /**
   * Text next to the menu-bar icon: only what the icon cannot say, the pause and the attention count. Without an icon (it could not be loaded) it starts
   * with the application's one name (BUG-051), so the item is never an empty gap in the menu bar.
   */
  title: string
  tooltip: string
  /** Disabled first line of the menu. */
  statusLine: string
  attentionLine: string | null
  pauseLabel: string
  openLabel: string
  quitLabel: string
}

export function describeTray(state: AutomationState, attentionCount: number, hasIcon = true): TrayModel {
  let statusLine: string
  if (state.paused) statusLine = 'Automation paused'
  else if (!state.running) statusLine = 'Automation starting'
  else if (state.activeRuns > 0) statusLine = `Automation running (${state.activeRuns} active)`
  else statusLine = 'Automation running'

  const attentionLine = attentionCount > 0 ? `${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} attention` : null
  const title = hasIcon
    ? [state.paused ? 'paused' : '', attentionCount > 0 ? String(attentionCount) : ''].filter(Boolean).join(' ')
    : [APP_NAME, state.paused ? '(paused)' : '', attentionCount > 0 ? `· ${attentionCount}` : ''].filter(Boolean).join(' ')

  return {
    title,
    tooltip: [APP_NAME, statusLine, attentionLine].filter(Boolean).join(' - '),
    statusLine,
    attentionLine,
    pauseLabel: state.paused ? 'Resume automation' : 'Pause automation',
    openLabel: `Open ${APP_NAME}`,
    quitLabel: `Quit ${APP_NAME}`
  }
}
