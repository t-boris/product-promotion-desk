import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { Core } from '../core/core'
import { describeTray } from '../core/pipeline/lifecycle-status'
import type { AutomationState } from '../shared/types'
import { TRAY_ICON_1X, TRAY_ICON_2X } from './tray-icon'

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
 * It shows the application's icon (a template image, so macOS draws it in the right colour on a light or a dark menu bar) with the attention
 * count beside it. Only when the icon cannot be made does it show the application's name instead, so the item never disappears.
 */
export function trayIcon(): Electron.NativeImage {
  const image = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_2X, 'base64'), { scaleFactor: 2 })
  if (image.isEmpty()) return image
  image.addRepresentation({ scaleFactor: 1, buffer: Buffer.from(TRAY_ICON_1X, 'base64') })
  image.setTemplateImage(true)
  return image
}

export function createTray({ core, automation, showWindow, quit }: TrayOptions): { destroy: () => void } {
  let tray: Tray
  const icon = trayIcon()
  const hasIcon = !icon.isEmpty()
  try {
    tray = new Tray(icon)
  } catch (error) {
    // Automation must keep working even if the menu-bar item cannot be created; the window still shows everything.
    core.log.error('tray', `Could not create the menu-bar item: ${error instanceof Error ? error.message : String(error)}`)
    return { destroy: () => undefined }
  }

  const render = (): void => {
    const model = describeTray(automation.state(), automation.attentionCount(), hasIcon)
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
