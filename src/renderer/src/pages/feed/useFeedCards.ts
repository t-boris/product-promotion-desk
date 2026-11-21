import { useMemo } from 'react'
import type { Id, OpportunityCard } from '../../../../shared/types'
import { useQuery } from '../../hooks'
import { isCapped, mergeCards, statesOf } from './feed-filter'

// The core returns at most 300 items for one question, the most recently changed first. One question for the three lists would let a long
// history of sent replies, or of new posts the AI skipped, push out an item that still waits; each list has its own.
const DECIDE = statesOf('decide')
const SENT = statesOf('sent')
const SKIPPED = statesOf('skipped')

export interface FeedCards {
  cards: OpportunityCard[]
  /** The first load of any of the three lists has not come back yet. */
  loading: boolean
  error: string | null
  /** A list is as long as the core returns: older items of that state are not shown. */
  capped: boolean
}

/** The reply opportunities of one product, every source and every state, as the Feed lists them (DEC-039). The lists follow every change of the opportunities. */
export function useFeedCards(productId: Id): FeedCards {
  // The answers the owner made from a post are not listed here, whatever their state: they are decided, planned and told as sent in the reply window of their post.
  const decide = useQuery('opportunities.list', { productId, kind: 'reply', states: DECIDE, withoutFeedAnswers: true }, ['opportunities'])
  const sent = useQuery('opportunities.list', { productId, kind: 'reply', states: SENT, withoutFeedAnswers: true }, ['opportunities'])
  const skipped = useQuery('opportunities.list', { productId, kind: 'reply', states: SKIPPED, withoutFeedAnswers: true }, ['opportunities'])
  const cards = useMemo(() => mergeCards([decide.data ?? [], sent.data ?? [], skipped.data ?? []]), [decide.data, sent.data, skipped.data])
  return {
    cards,
    loading: [decide, sent, skipped].some((query) => query.loading && query.data === undefined),
    error: decide.error ?? sent.error ?? skipped.error,
    capped: isCapped([decide.data, sent.data, skipped.data])
  }
}
