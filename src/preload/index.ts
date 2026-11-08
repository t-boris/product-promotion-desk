import { contextBridge, ipcRenderer } from 'electron'
import { IPC_EVENT, IPC_INVOKE, type ApiEvent } from '../shared/api'

// The only bridge between the sandboxed UI and the core: one invoke channel and one event channel.
contextBridge.exposeInMainWorld('ppd', {
  invoke: (method: string, args: unknown) => ipcRenderer.invoke(IPC_INVOKE, { method, args }),
  onEvent: (handler: (event: ApiEvent) => void) => {
    const listener = (_e: unknown, event: ApiEvent): void => handler(event)
    ipcRenderer.on(IPC_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC_EVENT, listener)
  }
})
