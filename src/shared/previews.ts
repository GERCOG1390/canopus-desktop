// Multi-client previews: live thumbnails of every EVE client window, click or hotkey to switch.

export interface PreviewSettings {
  enabled: boolean
  /** Width of one tile, px */
  tile: number
  /** Frames per second of each live tile */
  fps: number
  /** Global keys to go to the next / previous client; '' = none */
  nextKey: string
  prevKey: string
  bounds?: { x: number; y: number; width: number; height: number }
}

export const DEFAULT_PREVIEWS: PreviewSettings = { enabled: false, tile: 240, fps: 5, nextKey: '', prevKey: '', bounds: undefined }

/** Key choices for switching clients (global shortcuts: pick keys the game doesn't need). */
export const PREVIEW_KEYS = ['', 'Alt+Q', 'Alt+Shift+Q', 'Control+`', 'Control+Shift+`', 'F13', 'F14', 'Alt+1', 'Alt+2'] as const

export interface ClientWindow {
  /** desktopCapturer source id ("window:<native id>:0") */
  id: string
  /** Window title, "EVE - Character Name" */
  title: string
  character: string
}

/** EVE client windows are titled "EVE - Character"; the bare "EVE" one is the launcher / character select. */
export const isClientTitle = (t: string): boolean => /^EVE - .+/.test(t)
