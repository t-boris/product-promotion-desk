import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC_EVENT, IPC_INVOKE, type ApiEvent } from '../shared/api'

// The only bridge between the sandboxed UI and the core: one invoke channel, one event channel and the path of a dropped file.
contextBridge.exposeInMainWorld('ppd', {
  invoke: (method: string, args: unknown) => ipcRenderer.invoke(IPC_INVOKE, { method, args }),
  // The path of a file or folder that was dropped on the window: a sandboxed page cannot read it from the File itself.
  pathOf: (file: File): string => webUtils.getPathForFile(file),
  onEvent: (handler: (event: ApiEvent) => void) => {
    const listener = (_e: unknown, event: ApiEvent): void => handler(event)
    ipcRenderer.on(IPC_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC_EVENT, listener)
  }
})
