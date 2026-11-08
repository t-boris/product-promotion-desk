import { useState, type FormEvent } from 'react'
import type { Claim, ClaimKind, Id, PassportSection } from '../../../../shared/types'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Field } from '../../ui'
import { KIND_HELP, KIND_LABELS } from './labels'

type EditableKind = Exclude<ClaimKind, 'contradiction'>
const KINDS: EditableKind[] = ['fact', 'assumption', 'unknown']

/**
 * Adds a statement or edits an existing one. A fact needs a source: if none is typed, the core records
 * "entered by the user" with today's date. Assumptions and unknowns never carry sources.
 */
export function ClaimForm({ productId, section, claim, onDone }: { productId: Id; section: PassportSection; claim?: Claim; onDone: () => void }) {
  const [text, setText] = useState(claim?.text ?? '')
  // Editing a contradiction means settling it, so the result is a fact the user vouches for.
  const [kind, setKind] = useState<EditableKind>(claim && claim.kind !== 'contradiction' ? claim.kind : 'fact')
  const [source, setSource] = useState('')
  const [save, state] = useAction((input: Parameters<typeof call<'passport.claim.save'>>[1]) => call('passport.claim.save', input))

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (text.trim() === '') return
    const sources = kind === 'fact' && source.trim() !== '' ? [{ sourceId: null, ref: source.trim(), verifiedAt: new Date().toISOString() }] : undefined
    const saved = await save({ productId, claim: { id: claim?.id, section, text: text.trim(), kind, sources } })
    if (saved) onDone()
  }

  const id = claim?.id ?? `new-${section}`
  return (
    <form className="claim-form" onSubmit={(e) => void submit(e)} data-testid={`claim-form-${id}`}>
      <Field label="Statement">
        <textarea className="input short" value={text} onChange={(e) => setText(e.target.value)} autoFocus data-testid={`claim-text-${id}`} />
      </Field>
      <div className="form-row">
        <Field label="Type" hint={KIND_HELP[kind]}>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as EditableKind)} data-testid={`claim-kind-${id}`}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        {kind === 'fact' && (
          <Field label="Source (optional)" hint="A link, file or note that confirms it. Left empty: entered by you today.">
            <input className="input" value={source} onChange={(e) => setSource(e.target.value)} data-testid={`claim-source-${id}`} />
          </Field>
        )}
      </div>
      <ErrorNote error={state.error} />
      <div className="row">
        <Button variant="primary" type="submit" disabled={state.busy || text.trim() === ''} data-testid={`claim-save-${id}`}>
          {state.busy ? 'Saving…' : claim ? 'Save' : 'Add'}
        </Button>
        <Button type="button" onClick={onDone} data-testid={`claim-cancel-${id}`}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
