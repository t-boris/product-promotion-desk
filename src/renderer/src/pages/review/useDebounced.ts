import { useEffect, useState } from 'react'

/** The value as it was `ms` after it last changed: typing in a field does not ask a question of the core at every key. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}
