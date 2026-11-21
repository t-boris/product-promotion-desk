import { useState } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { DraftFinding, Id, IsoTime, OpportunityCard } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { checkForm } from './approve-check'

/** What reading the owner's text found; a check that could not be made says why instead (it never stops an approval by itself). */
export interface CheckOutcome {
  findings: DraftFinding[]
  error: string | null
}

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
  /** The owner checked the platform themselves and settles an unknown result. */
  resolveUnknown(id: Id, outcome: 'published' | 'not_published', url?: string): Promise<OpportunityCard | undefined>
  schedule(id: Id, at: IsoTime | null): Promise<OpportunityCard | undefined>
  /** Reads the text against the rules of an AI draft (`draft`: the editor as it stands; without it the saved draft). Busy while it runs, so the editor is locked. */
  check(id: Id, draft?: DraftInput): Promise<CheckOutcome>
}

/**
 * The owner's actions on one review card, with one shared busy/error state so the card can disable its buttons
 * while a call is running and show why a call failed. `onDone` is called after any successful action.
 *
 * `settle` finishes a draft before it is saved: a quick post whose card changed is drawn and stored first (REQ-003), and the draft that comes
 * back carries the new picture. It runs inside the busy step, so the buttons are off and the form cannot change while the card is drawn.
 */
export function useReviewActions(onDone?: (card: OpportunityCard) => void, settle?: (draft: DraftInput) => Promise<DraftInput>): ReviewActions {
  const [perform, state] = useAction(async (work: () => Promise<OpportunityCard>) => {
    const card = await work()
    onDone?.(card)
    return card
  })
  // The check has its own flag: it is not a change to the card, and a failed check is a result, not an error of the card.
  const [checking, setChecking] = useState(false)

  return {
    busy: state.busy || checking,
    error: state.error,
    prepare: (id) => perform(() => call('opportunities.prepareDraft', { id })),
    save: (id, draft) => perform(async () => call('opportunities.saveDraft', { id, draft: settle ? await settle(draft) : draft })),
    approve: (id, draft) =>
      perform(async () => {
        if (draft) await call('opportunities.saveDraft', { id, draft: settle ? await settle(draft) : draft })
        return call('opportunities.approve', { id })
      }),
    approveAndSend: (id, draft) =>
      perform(async () => {
        if (draft) await call('opportunities.saveDraft', { id, draft: settle ? await settle(draft) : draft })
        await call('opportunities.approve', { id })
        return call('opportunities.send', { id })
      }),
    reject: (id, reason) => perform(() => call('opportunities.reject', { id, reason })),
    defer: (id) => perform(() => call('opportunities.defer', { id })),
    send: (id) => perform(() => call('opportunities.send', { id })),
    reconcile: (id) => perform(() => call('opportunities.reconcile', { id })),
    resolveUnknown: (id, outcome, url) => perform(() => call('opportunities.resolveUnknown', { id, outcome, url: url || undefined })),
    schedule: (id, at) => perform(() => call('publications.schedule', { id, at })),
    check: async (id, draft) => {
      setChecking(true)
      try {
        const result = await call('drafts.check', { opportunityId: id, ...(draft ? { form: checkForm(draft) } : {}) })
        return { findings: result.findings, error: null }
      } catch (e) {
        return { findings: [], error: e instanceof Error ? e.message : String(e) }
      } finally {
        setChecking(false)
      }
    }
  }
}
