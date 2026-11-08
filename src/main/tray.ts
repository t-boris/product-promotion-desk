import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { Core } from '../core/core'
import { describeTray } from '../core/pipeline/lifecycle-status'
import type { AutomationState } from '../shared/types'

export interface TrayAutomation {
  state(): AutomationState
  attentionCount(): number
  setPaused(paused: boolean): AutomationState
}

export interface TrayOptions {
  core: Core
  automation: TrayAutomation
  showWindow: () => void
  /** Explicit Quit: stops all automation until the user launches the application again (DEC-003). */
  quit: () => void
}

/**
 * Menu-bar item (REQ-005): automation status, attention count, Pause/Resume and Quit stay reachable while every
 * window is closed. The text comes from the core (`describeTray`), so the wording is tested without Electron.
 * It shows a title instead of a drawn icon, which keeps it readable in light and dark menu bars.
 */
export function createTray({ core, automation, showWindow, quit }: TrayOptions): { destroy: () => void } {
  let tray: Tray
  try {
    tray = new Tray(nativeImage.createEmpty())
  } catch (error) {
    // Automation must keep working even if the menu-bar item cannot be created; the window still shows everything.
    core.log.error('tray', `Could not create the menu-bar item: ${error instanceof Error ? error.message : String(error)}`)
    return { destroy: () => undefined }
  }

  const render = (): void => {
    const model = describeTray(automation.state(), automation.attentionCount())
    const template: MenuItemConstructorOptions[] = [
      { label: model.statusLine, enabled: false },
      ...(model.attentionLine ? [{ label: model.attentionLine, enabled: false }] : []),
      { type: 'separator' },
      { label: model.openLabel, click: showWindow },
      { label: model.pauseLabel, click: () => automation.setPaused(!automation.state().paused) },
      { type: 'separator' },
      { label: model.quitLabel, click: quit }
    ]
    tray.setTitle(model.title)
    tray.setToolTip(model.tooltip)
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  render()
  const unsubscribe = core.events.subscribe((event) => {
    if (event.type === 'automation' || (event.type === 'changed' && event.scope === 'attention')) render()
  })

  const destroy = (): void => {
    unsubscribe()
    if (!tray.isDestroyed()) tray.destroy()
  }
  core.onShutdown(destroy)
  return { destroy }
}
