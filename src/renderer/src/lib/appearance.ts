// Theme and density are attributes on <html>; styles.css switches the tokens on them.

import type { Settings, ThemeId } from '../../../shared/types'

export const THEMES: { id: ThemeId; label: string; color: string }[] = [
  { id: 'canopus', label: 'Canopus — графит', color: '#3dbf9c' },
  { id: 'photon', label: 'Photon', color: '#4cc3f0' },
  { id: 'amarr', label: 'Амарр', color: '#d9a84e' },
  { id: 'caldari', label: 'Калдари', color: '#5ba8e8' },
  { id: 'gallente', label: 'Галленте', color: '#7cc25f' },
  { id: 'minmatar', label: 'Минматар', color: '#e0703f' }
]

export function applyAppearance(settings: Pick<Settings, 'theme' | 'density'> | null | undefined): void {
  if (!settings) return
  const root = document.documentElement
  root.dataset.theme = settings.theme ?? 'canopus'
  root.dataset.density = settings.density ?? 'comfortable'
}
