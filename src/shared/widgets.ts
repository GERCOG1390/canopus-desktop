// Overlay mini-windows: small always-on-top windows over the game, one view each.

export const WIDGET_VIEWS = ['timers', 'price', 'wallet', 'radar'] as const
export type WidgetView = (typeof WIDGET_VIEWS)[number]

export interface WidgetSettings {
  /** Each view: shown or not, and where it was left */
  views: Partial<Record<WidgetView, { enabled: boolean; bounds?: { x: number; y: number; width: number; height: number } }>>
  opacity: number
}

export const DEFAULT_WIDGETS: WidgetSettings = { views: {}, opacity: 0.9 }

export const WIDGET_SIZE: Record<WidgetView, { width: number; height: number }> = {
  timers: { width: 320, height: 260 },
  price: { width: 300, height: 200 },
  wallet: { width: 260, height: 200 },
  radar: { width: 380, height: 460 }
}
