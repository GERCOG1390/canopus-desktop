import { contextBridge, ipcRenderer } from 'electron'
import type { CanopusApi } from '../shared/types'

// ipcRenderer.invoke wraps thrown errors as "Error invoking remote method '...': Error: msg".
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (err) {
    const message = String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    throw new Error(message)
  }
}

const api: CanopusApi = {
  request: (url, options) => invoke('http:request', url, options),
  auth: {
    login: () => invoke('auth:login'),
    characters: () => invoke('auth:characters'),
    logout: (characterId) => invoke('auth:logout', characterId),
    callbackUrl: () => invoke('auth:callbackUrl')
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch)
  },
  openExternal: (url) => invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('api', api)
