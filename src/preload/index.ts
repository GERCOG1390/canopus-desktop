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

/** Subscribes to a main → renderer channel; returns an unsubscribe function. */
function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: CanopusApi = {
  previews: {
    list: () => invoke('previews:list'),
    activate: (client) => invoke('previews:activate', client),
    set: (patch) => invoke('previews:set', patch),
    permissions: () => invoke('previews:permissions'),
    onActive: (listener) => on('previews:active', listener),
    onSettings: (listener) => on('previews:settings', listener)
  },
  widgets: {
    set: (view, enabled) => invoke('widgets:set', view, enabled),
    setOpacity: (opacity) => invoke('widgets:opacity', opacity)
  },
  stream: {
    status: () => invoke('stream:status'),
    state: () => invoke('stream:state'),
    resetSession: () => invoke('stream:reset'),
    onStatus: (listener) => on('stream:status', listener)
  },
  request: (url, options) => invoke('http:request', url, options),
  auth: {
    login: (extended, corp, mode) => invoke('auth:login', extended, corp, mode),
    cancelLogin: () => invoke('auth:cancel'),
    extraScopes: () => invoke('auth:extraScopes'),
    characters: () => invoke('auth:characters'),
    logout: (characterId) => invoke('auth:logout', characterId),
    callbackUrl: () => invoke('auth:callbackUrl'),
    scopes: () => invoke('auth:scopes'),
    scopeTiers: () => invoke('auth:scopeTiers')
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch)
  },
  openExternal: (url) => invoke('shell:openExternal', url),
  sde: {
    status: () => invoke('sde:status'),
    onStatus: (listener) => {
      const handler = (_e: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status)
      ipcRenderer.on('sde:status', handler)
      return () => ipcRenderer.removeListener('sde:status', handler)
    },
    update: () => invoke('sde:update'),
    basics: (ids) => invoke('sde:basics', ids),
    search: (q, opts) => invoke('sde:search', q, opts),
    searchSystems: (q, limit) => invoke('sde:searchSystems', q, limit),
    system: (id) => invoke('sde:system', id),
    wormholeTypes: () => invoke('sde:wormholeTypes'),
    jumpRoute: (from, to, range) => invoke('sde:jumpRoute', from, to, range),
    lightYears: (from, to) => invoke('sde:lightYears', from, to),
    galaxy: () => invoke('sde:galaxy'),
    campaigns: () => invoke('sde:campaigns'),
    jobTypes: () => invoke('sde:jobTypes'),
    blueprintProducts: (ids) => invoke('sde:blueprintProducts', ids),
    parseBridges: (text) => invoke('sde:parseBridges', text),
    routeLocal: (from, to, flag, bridges, avoid) => invoke('sde:routeLocal', from, to, flag, bridges, avoid),
    info: (id) => invoke('sde:info', id),
    skillCatalog: () => invoke('sde:skillCatalog'),
    attributeIcons: () => invoke('sde:attributeIcons'),
    groupNames: (ids) => invoke('sde:groupNames', ids),
    marketChildren: (parent, order, lang, filterKey) => invoke('sde:marketChildren', parent, order, lang, filterKey),
    setMarketFilter: (key, ids) => invoke('sde:setMarketFilter', key, ids),
    marketPath: (typeId) => invoke('sde:marketPath', typeId),
    marketTypesIn: (groupId) => invoke('sde:marketTypesIn', groupId),
    requiredSkills: (ids) => invoke('sde:requiredSkills', ids),
    skillPlan: (goals) => invoke('sde:skillPlan', goals),
    dogmaAttrs: (ids, attrIds) => invoke('sde:dogmaAttrs', ids, attrIds),
    blueprintForProduct: (id) => invoke('sde:blueprintForProduct', id)
  },
  intel: {
    onClipboard: (listener) => on('intel:clipboard', listener),
    onLog: (listener) => on('intel:log', listener),
    restartLog: () => invoke('intel:restartLog'),
    publish: (summary) => invoke('intel:publish', summary),
    onSummary: (listener) => on('intel:summary', listener),
    lastSummary: () => invoke('intel:lastSummary'),
    notify: (title, body, kind) => invoke('intel:notify', title, body, kind),
    testDiscord: (url) => invoke('intel:testDiscord', url),
    setOverlay: (patch) => invoke('intel:setOverlay', patch),
    resolveTypeNames: (names) => invoke('intel:resolveTypeNames', names),
    onReport: (listener) => on('intel:report', listener),
    onChannels: (listener) => on('intel:channels', listener),
    listChannels: () => invoke('intel:listChannels'),
    channelStatus: () => invoke('intel:channelStatus'),
    recentReports: () => invoke('intel:recentReports'),
    jumpsFrom: (fromId, ids) => invoke('intel:jumpsFrom', fromId, ids),
    systemId: (name) => invoke('intel:systemId', name)
  },
  onSettingsChanged: (listener) => on('intel:settingsChanged', listener),
  store: {
    get: (key) => invoke('store:get', key),
    set: (key, value) => invoke('store:set', key, value)
  },
  ratting: {
    events: () => invoke('ratting:events'),
    onEvents: (listener) => on('ratting:events', listener),
    onReset: (listener) => on('ratting:reset', listener)
  },
  update: {
    status: () => invoke('update:status'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    installAndRestart: () => invoke('update:install'),
    onStatus: (listener) => on('update:status', listener)
  },
  notify: {
    history: () => invoke('notify:history'),
    checkNow: () => invoke('notify:checkNow')
  },
  knowledge: {
    status: () => invoke('knowledge:status'),
    update: () => invoke('knowledge:update'),
    refreshIfStale: () => invoke('knowledge:refreshIfStale'),
    search: (query, limit, source) => invoke('knowledge:search', query, limit, source),
    onStatus: (listener) => on('knowledge:status', listener)
  },
  assistant: {
    account: () => invoke('assistant:account'),
    setKey: (key) => invoke('assistant:setKey', key),
    clearKey: () => invoke('assistant:clearKey'),
    chatgptLogin: () => invoke('assistant:chatgptLogin'),
    chatgptCancel: () => invoke('assistant:chatgptCancel'),
    chatgptLogout: () => invoke('assistant:chatgptLogout'),
    models: (mode) => invoke('assistant:models', mode),
    respond: (requestId, mode, model, instructions, input, tools, web) => invoke('assistant:respond', requestId, mode, model, instructions, input, tools, web),
    onDelta: (listener) => on<{ id: string; delta: string }>('assistant:delta', (p) => listener(p.id, p.delta))
  },
  fitShot: {
    open: (pilot) => invoke('fitshot:open', pilot),
    get: () => invoke('fitshot:get'),
    onFit: (listener) => on('fitshot:fit', listener),
    resize: (width, height) => invoke('fitshot:resize', width, height),
    capture: (rect, to, name) => invoke('fitshot:capture', rect, to, name)
  },
  combat: {
    open: (attacker) => invoke('combat:open', attacker),
    setAttacker: (attacker) => invoke('combat:setAttacker', attacker),
    isOpen: () => invoke('combat:isOpen'),
    getAttacker: () => invoke('combat:getAttacker'),
    onAttacker: (listener) => on('combat:attacker', listener),
    simulate: (a, b, scenario) => invoke('combat:simulate', a, b, scenario),
    defaults: (a, b) => invoke('combat:defaults', a, b)
  },
  fit: {
    calculate: (spec, skills) => invoke('fit:calculate', spec, skills),
    skillGains: (spec, levels) => invoke('fit:skillGains', spec, levels),
    variants: (spec, skills) => invoke('fit:variants', spec, skills),
    modes: (shipTypeId) => invoke('fit:modes', shipTypeId),
    npcDamage: (spec, skills, faction, distance) => invoke('fit:npcDamage', spec, skills, faction, distance),
    metrics: (spec, skills) => invoke('fit:metrics', spec, skills),
    catalog: () => invoke('fit:catalog'),
    fittableFor: (shipTypeId) => invoke('fit:fittableFor', shipTypeId),
    explain: (spec, skills, target, attr) => invoke('fit:explain', spec, skills, target, attr),
    charges: (id) => invoke('fit:charges', id),
    list: () => invoke('fit:list'),
    save: (fit) => invoke('fit:save', fit),
    delete: (id) => invoke('fit:delete', id)
  }
}

contextBridge.exposeInMainWorld('api', api)
