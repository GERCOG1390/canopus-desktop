// Update status from the main process (checks GitHub Releases).

import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/update'

export function useUpdate(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.api.update.status().then(setStatus)
    return window.api.update.onStatus(setStatus)
  }, [])
  return status
}
