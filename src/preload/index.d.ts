import type { CanopusApi } from '../shared/types'

declare global {
  interface Window {
    api: CanopusApi
  }
}
