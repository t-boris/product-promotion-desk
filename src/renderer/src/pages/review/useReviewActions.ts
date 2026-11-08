import type { DraftInput } from '../../../../shared/api'
import type { Id, IsoTime, OpportunityCard } from '../../../../shared/types'
import { call, useAction } from '../../hooks'

export interface ReviewActions {
  busy: boolean
  /** The last failure, including the SendGate's reasons for a blocked send. */
  error: string | null
  prepare(id: Id): Promise<OpportunityCard | undefined>
  save(id: Id, draft: DraftInput): Promise<OpportunityCard | undefined>
  /** Approves exactly what is saved. With `draft`, saves it first so the approval covers what the owner sees. */
  approve(id: Id, draft?: DraftInput): Promise<OpportunityCard | undefined>
  approveAndSend(id: Id, draft?: DraftInput): Promise<OpportunityCard | undefined>
  reject(id: Id, reason?: string): Promise<OpportunityCard | undefined>
  defer(id: Id): Promise<OpportunityCard | undefined>
  send(id: Id): Promise<OpportunityCard | undefined>
  reconcile(id: Id): Promise<OpportunityCard | undefined>
  schedule(id: Id, at: IsoTime | null): Promise<OpportunityCard | undefined>
}

/**
 * The owner's actions on one review card, with one shared busy/error state so the card can disable its buttons
 * while a call is running and show why a call failed. `onDone` is called after any successful action.
 */
export function useReviewActions(onDone?: (card: OpportunityCard) => void): ReviewActions {
  const [perform, state] = useAction(async (work: () => Promise<OpportunityCard>) => {
    const card = await work()
    onDone?.(card)
    return card
  })

  return {
    busy: state.busy,
    error: state.error,
    prepare: (id) => perform(() => call('opportunities.prepareDraft', { id })),
    save: (id, draft) => perform(() => call('opportunities.saveDraft', { id, draft })),
    approve: (id, draft) =>
      perform(async () => {
        if (draft) await call('opportunities.saveDraft', { id, draft })
        return call('opportunities.approve', { id })
      }),
    approveAndSend: (id, draft) =>
      perform(async () => {
        if (draft) await call('opportunities.saveDraft', { id, draft })
        await call('opportunities.approve', { id })
        return call('opportunities.send', { id })
      }),
    reject: (id, reason) => perform(() => call('opportunities.reject', { id, reason })),
    defer: (id) => perform(() => call('opportunities.defer', { id })),
    send: (id) => perform(() => call('opportunities.send', { id })),
    reconcile: (id) => perform(() => call('opportunities.reconcile', { id })),
    schedule: (id, at) => perform(() => call('publications.schedule', { id, at }))
  }
}
