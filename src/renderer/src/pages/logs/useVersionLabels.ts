import { useEffect, useState } from 'react'
import { call } from '../../hooks'

/**
 * Maps passport (knowledge) version ids to "v3"-style labels for the products involved, so the history can say
 * which knowledge a message was based on. A failed lookup only means the short id is shown instead.
 */
export function useVersionLabels(productIds: string[]): Map<string, string> {
  const [labels, setLabels] = useState(new Map<string, string>())
  const key = [...new Set(productIds)].sort().join(',')

  useEffect(() => {
    let cancelled = false
    const ids = key ? key.split(',') : []
    void Promise.all(ids.map((productId) => call('passport.versions', { productId }).catch(() => [])))
      .then((lists) => {
        if (cancelled) return
        const next = new Map<string, string>()
        for (const version of lists.flat()) next.set(version.id, `v${version.version}`)
        setLabels(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [key])

  return labels
}
