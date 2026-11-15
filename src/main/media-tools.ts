// What the post editor needs from the operating system (DEC-030): the file dialog for pictures, a small copy of a picture for the screen
// (the page may show only `data:` pictures) and the file manager. Electron's own image support is used; no extra library.

import { BrowserWindow, dialog, nativeImage, shell } from 'electron'
import type { MediaTools } from '../core/ports'

export class ElectronMediaTools implements MediaTools {
  async pick(): Promise<string[]> {
    const options = {
      title: 'Choose pictures',
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    }
    const window = BrowserWindow.getFocusedWindow()
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return result.canceled ? [] : result.filePaths
  }

  async thumbnail(path: string, side: number): Promise<string> {
    const image = nativeImage.createFromPath(path)
    if (image.isEmpty()) throw new Error('The picture could not be read.')
    const { width, height } = image.getSize()
    const scale = Math.min(1, side / Math.max(width, height))
    const shown = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), quality: 'good' }) : image
    return shown.toDataURL()
  }

  reveal(path: string): void {
    shell.showItemInFolder(path)
  }
}
