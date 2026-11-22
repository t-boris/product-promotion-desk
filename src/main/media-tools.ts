// What the screens need from the operating system (DEC-030): the file dialog (pictures, a source's file or folder) and the Save dialog, a small copy of a picture for the screen
// (the page may show only `data:` pictures) and the file manager. Electron's own image support is used; no extra library.

import { copyFile, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { app, BrowserWindow, dialog, nativeImage, shell } from 'electron'
import type { MediaTools } from '../core/ports'
import type { FilePurpose } from '../shared/types'
import { dialogShape } from './file-dialogs'

export class ElectronMediaTools implements MediaTools {
  async pick(): Promise<string[]> {
    return this.choose('pictures')
  }

  async choose(purpose: FilePurpose): Promise<string[]> {
    const options = dialogShape(purpose)
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

  /** The Save dialog, in the Downloads folder with the proposed name; the file (or the bytes) is written only after the owner pressed Save. */
  async save(source: { path: string } | { bytes: Buffer }, suggestedName: string): Promise<string | null> {
    const extension = extname(suggestedName).slice(1)
    const options = {
      title: 'Save the picture',
      defaultPath: join(app.getPath('downloads'), suggestedName),
      filters: extension ? [{ name: 'Picture', extensions: [extension] }] : undefined
    }
    const window = BrowserWindow.getFocusedWindow()
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    if ('path' in source) await copyFile(source.path, result.filePath)
    else await writeFile(result.filePath, source.bytes)
    return result.filePath
  }
}
