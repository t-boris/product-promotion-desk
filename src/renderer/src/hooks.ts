import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiArgs, ApiEvent, ApiMethod, ApiResult, ChangeScope } from '../../shared/api'
import type { AutomationState } from '../../shared/types'
import { transport } from './transport'

export function call<M extends ApiMethod>(method: M, args: ApiArgs<M>): Promise<ApiResult<M>> {
  return transport.invoke(method, args)
}

export function useEvents(handler: (event: ApiEvent) => void): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => transport.subscribe((e) => ref.current(e)), [])
}

export interface Query<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Loads data and reloads it whenever the core reports a change in one of `scopes`. With `skip` it asks for nothing (a screen that does not
 * need the answer must not pay for it, for example a process spawned to check an engine) and reports `loading: false`.
 */
export function useQuery<M extends ApiMethod>(method: M, args: ApiArgs<M>, scopes: ChangeScope[] = [], options: { skip?: boolean } = {}): Query<ApiResult<M>> {
  const skip = options.skip ?? false
  const [data, setData] = useState<ApiResult<M>>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!skip)
  const key = JSON.stringify(args ?? null)
  const argsRef = useRef(args)
  argsRef.current = args

  const load = useCallback(() => {
    setLoading(true)
    call(method, argsRef.current)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [method])

  useEffect(() => {
    if (!skip) load()
  }, [load, key, skip])
  useEvents((event) => {
    if (!skip && event.type === 'changed' && scopes.includes(event.scope)) load()
  })
  return { data, error, loading, reload: load }
}

/** Runs a user action (mutation) with busy and error state. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>): [(...args: A) => Promise<R | undefined>, { busy: boolean; error: string | null }] {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async (...args: A) => {
      setBusy(true)
      setError(null)
      try {
        return await fn(...args)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [fn]
  )
  return [run, { busy, error }]
}

export function useAutomation(): { state: AutomationState | undefined; setPaused: (paused: boolean) => Promise<void> } {
  const [state, setState] = useState<AutomationState>()
  useEffect(() => {
    void call('automation.get', undefined).then(setState)
  }, [])
  useEvents((event) => {
    if (event.type === 'automation') setState(event.state)
    if (event.type === 'changed' && event.scope === 'settings') void call('automation.get', undefined).then(setState)
  })
  return {
    state,
    setPaused: async (paused) => {
      setState(await call('automation.setPaused', { paused }))
    }
  }
}
