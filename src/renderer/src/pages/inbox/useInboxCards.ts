import { useCallback, useEffect, useRef, useState } from 'react'
import type { Id, OpportunityCard } from '../../../../shared/types'
import { call, useEvents } from '../../hooks'

const NO_CARDS: ReadonlyMap<Id, OpportunityCard> = new Map()

/**
 * The cards of the given items, loaded together and reloaded whenever the core reports a change in opportunities. A card that cannot
 * be loaded now keeps the last one that could, so a row never vanishes for one failed call; one that never loaded is simply not listed.
 * The Inbox needs every card at once (to group the rows and to tell the products apart), so the cards are not loaded one by one by the rows.
 */
export function useInboxCards(ids: readonly Id[]): { cards: ReadonlyMap<Id, OpportunityCard>; error: string | null; loaded: boolean } {
  const [cards, setCards] = useState<ReadonlyMap<Id, OpportunityCard>>(NO_CARDS)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const wanted = useRef(ids)
  wanted.current = ids
  // An answer that arrives after a newer question was asked is about an older list and is dropped.
  const asked = useRef(0)

  const load = useCallback(() => {
    const list = wanted.current
    const turn = ++asked.current
    void Promise.allSettled(list.map((id) => call('opportunities.get', { id }))).then((results) => {
      if (turn !== asked.current) return
      setCards((previous) => {
        const next = new Map<Id, OpportunityCard>()
        list.forEach((id, at) => {
          const result = results[at]
          const card = result.status === 'fulfilled' ? result.value : previous.get(id)
          if (card) next.set(id, card)
        })
        return next
      })
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      setError(failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null)
      setLoaded(true)
    })
  }, [])

  const key = ids.join(',')
  useEffect(() => {
    load()
  }, [load, key])
  useEvents((event) => {
    if (event.type === 'changed' && event.scope === 'opportunities') load()
  })
  return { cards, error, loaded }
}
