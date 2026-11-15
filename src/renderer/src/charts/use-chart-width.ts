import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

const MIN_WIDTH = 160

/** The width of the element the chart fills, kept up to date as the window changes; `initial` until it is first measured. */
export function useChartWidth(initial = 520): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initial)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = (): void => setWidth(Math.max(MIN_WIDTH, Math.floor(element.clientWidth)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}
