import { useEffect, useMemo, useState } from 'react'
import { useAutomation } from '../../hooks'
import type { WatchingContext } from './watching-line'

/**
 * What the watching line (watching-line.ts) needs from the application: the moment, and whether the owner paused all automation. Null until
 * the application has said whether it is paused: a line that guessed "watching" and then took it back would say something untrue for a moment.
 */
export function useWatchingContext(): WatchingContext | null {
  const { state } = useAutomation()
  // The moment moves on by itself: a quiet screen would keep saying "next ≈14:12" after 14:12 (it says "soon" from then on).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  const paused = state?.paused
  return useMemo(() => (paused === undefined ? null : { now, automationPaused: paused }), [now, paused])
}

const CLOCK_TICK_MS = 30_000
