import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeScope } from '../../../../shared/api'
import type { FindingCard, FindingCounts, FindingLabel, Id } from '../../../../shared/types'
import { call, useQuery } from '../../hooks'
import { FEED_LIMIT } from './feed-filter'
import { buildFindingRows, unseenToMark, type FindingRow } from './finding-rows'

// There is no change scope of its own for findings: a check that judged posts ends by changing its channel (and the opportunities it opened),
// so the lists follow those; what the owner does here (marking seen) reloads them directly.
const SCOPES: ChangeScope[] = ['channels', 'opportunities']
const NOTICE: FindingLabel[] = ['notice']
const SKIP: FindingLabel[] = ['skip']

export interface Findings {
  /** The notices of the product, newest first: the Noted list. */
  notices: FindingRow[]
  /** What was judged not relevant, newest first; empty until `skipped` is asked for. */
  skipped: FindingRow[]
  counts: FindingCounts | undefined
  /** The first load of the notices or the counts has not come back yet. */
  loading: boolean
  /** The skipped list was asked for and has not come back yet. */
  loadingSkipped: boolean
  error: string | null
  /** A list is as long as the core returns: older findings exist and are not listed. */
  capped: boolean
  /** Marks the findings seen, then reloads what counts them. Never throws: a failure is `error`. */
  markSeen: (ids: Id[]) => Promise<void>
}

const NO_CARDS: FindingCard[] = []

/**
 * What the AI judged of the product's posts (DEC-040): the notices (the Noted list), the counts (the badge of the tab, the quiet "judged not
 * relevant" line) and, only once the owner asks to look at them, the posts judged not relevant. Read-only except `markSeen`.
 */
export function useFindings(productId: Id, options: { skipped: boolean; channelId: Id | null }): Findings {
  const notices = useQuery('findings.list', { productId, labels: NOTICE, limit: FEED_LIMIT }, SCOPES)
  // The counts follow the channel the Feed is on, so "judged not relevant" and "waiting" say the same thing as the list beside them.
  const counts = useQuery('findings.counts', { productId, ...(options.channelId ? { channelId: options.channelId } : {}) }, SCOPES)
  const skipped = useQuery('findings.list', { productId, labels: SKIP, limit: FEED_LIMIT }, SCOPES, { skip: !options.skipped })
  const [markError, setMarkError] = useState<string | null>(null)

  const noticeRows = useMemo(() => buildFindingRows(notices.data ?? NO_CARDS, 'notice'), [notices.data])
  const skippedRows = useMemo(() => buildFindingRows(skipped.data ?? NO_CARDS, 'skip'), [skipped.data])

  const reloadNotices = notices.reload
  const reloadCounts = counts.reload
  const markSeen = useCallback(
    async (ids: Id[]): Promise<void> => {
      try {
        await call('findings.markSeen', { ids })
        setMarkError(null)
        reloadNotices()
        reloadCounts()
      } catch (e) {
        setMarkError(e instanceof Error ? e.message : String(e))
      }
    },
    [reloadNotices, reloadCounts]
  )

  return {
    notices: noticeRows,
    skipped: skippedRows,
    counts: counts.data,
    loading: (notices.loading && notices.data === undefined) || (counts.loading && counts.data === undefined),
    loadingSkipped: options.skipped && skipped.loading && skipped.data === undefined,
    error: notices.error ?? counts.error ?? skipped.error ?? markError,
    capped: (notices.data?.length ?? 0) >= FEED_LIMIT || (skipped.data?.length ?? 0) >= FEED_LIMIT,
    markSeen
  }
}

/**
 * Marks the notice on show as seen, once: when the owner selects it (or it is the first row of the list) and it has not been seen. The
 * ids already asked for are kept, so a render, a reload or the arrow keys going back to the row never ask the core again. A refusal is
 * shown (`Findings.error`) and not retried on its own; the next visit to the screen asks again.
 */
export function useMarkSeenOnShow(shown: FindingRow | undefined, markSeen: (ids: Id[]) => Promise<void>): void {
  const asked = useRef(new Set<Id>())
  const latest = useRef(markSeen)
  latest.current = markSeen
  const id = shown?.id
  const wanted = shown !== undefined && unseenToMark(shown, asked.current).length > 0
  useEffect(() => {
    if (!shown || !wanted) return
    const ids = unseenToMark(shown, asked.current)
    for (const found of ids) asked.current.add(found)
    void latest.current(ids)
    // Only the row on show and whether it is still to be marked decide when the core is asked.
  }, [id, wanted])
}
