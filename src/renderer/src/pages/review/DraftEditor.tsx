import { useEffect, useState } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { Attachment, Draft, Id } from '../../../../shared/types'
import { AiTextField } from '../../assist/AiField'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call } from '../../hooks'
import { Badge, Button, Field } from '../../ui'
import { fileName } from './labels'

export interface DraftForm {
  title: string
  text: string
  link: string
  attachments: Attachment[]
}

const EMPTY: DraftForm = { title: '', text: '', link: '', attachments: [] }

function fromDraft(draft: Draft | null): DraftForm {
  if (!draft) return EMPTY
  return { title: draft.title ?? '', text: draft.text, link: draft.link ?? '', attachments: draft.attachments }
}

/** What the core will store for this form: surrounding whitespace is trimmed there too. */
export function toInput(form: DraftForm, withTitle: boolean): DraftInput {
  return { title: withTitle ? form.title.trim() || null : null, text: form.text.trim(), link: form.link.trim() || null, attachments: form.attachments }
}

const signature = (form: DraftForm, withTitle: boolean): string => {
  const input = toInput(form, withTitle)
  return JSON.stringify([input.title, input.text, input.link, form.attachments.map((a) => a.path)])
}

/** Form state for one draft: resets when a different (newly saved) draft arrives and says whether it was edited. */
export function useDraftForm(draft: Draft | null, withTitle: boolean): { form: DraftForm; setForm: (form: DraftForm) => void; dirty: boolean; input: DraftInput } {
  const [form, setForm] = useState<DraftForm>(() => fromDraft(draft))
  const draftId = draft?.id ?? null
  // Only a different draft row (a new save, or an AI re-draft) replaces what the owner is typing.
  useEffect(() => {
    setForm(fromDraft(draft))
  }, [draftId])
  const dirty = signature(form, withTitle) !== signature(fromDraft(draft), withTitle)
  return { form, setForm, dirty, input: toInput(form, withTitle) }
}

interface Props {
  form: DraftForm
  onChange: (form: DraftForm) => void
  withTitle: boolean
  disabled: boolean
  /** Who wrote the saved draft and what it was based on, shown above the text. */
  draft: Draft | null
  /** Put the cursor in the first field when the editor appears (a form opened on demand: the button that opened it is gone). */
  autoFocus?: boolean
  /**
   * The AI beside the title and the text: it writes an empty one and improves a filled one. Name the item the text is for (a reply or a post
   * that has a card) or the channel (a new publication). Left out, the editor has no AI control (a draft that can no longer change).
   */
  ai?: { opportunityId?: Id; channelId?: Id }
}

/** Editor for a reply or a publication. Editing never changes what was approved: saving creates a new draft. */
export function DraftEditor({ form, onChange, withTitle, disabled, draft, autoFocus = false, ai }: Props) {
  const [path, setPath] = useState('')
  const { blocked } = useAssistBlock()
  // The AI is asked for one field of the draft as the editor holds it now; nothing is stored, the owner saves the draft.
  const askFor = (field: 'title' | 'text') => async ({ instruction }: { current: string; instruction: string | undefined }): Promise<string> => {
    const result = await call('drafts.refine', { field, opportunityId: ai?.opportunityId, channelId: ai?.channelId, form: { title: form.title, text: form.text }, instruction })
    const text = result[field]
    if (text === undefined) throw new Error('The AI did not return a text. Try again.')
    return text
  }
  const set = (patch: Partial<DraftForm>): void => onChange({ ...form, ...patch })
  const addAttachment = (): void => {
    const trimmed = path.trim()
    if (!trimmed || form.attachments.some((a) => a.path === trimmed)) return
    set({ attachments: [...form.attachments, { name: fileName(trimmed), path: trimmed, mime: '', sha256: '' }] })
    setPath('')
  }

  return (
    <div className="draft-form" data-testid="draft-editor">
      {draft && (
        <div className="draft-meta">
          <Badge>{draft.author === 'ai' ? 'Prepared by the AI' : 'Written by you'}</Badge>
          {draft.rationale && <span data-testid="draft-rationale">Why: {draft.rationale}</span>}
        </div>
      )}
      {withTitle &&
        (ai ? (
          <AiTextField key={`title-${draft?.id ?? 'new'}`} label="Title" value={form.title} onChange={(title) => set({ title })} ask={askFor('title')} blocked={blocked} disabled={disabled} testId="draft-title-help">
            {(id) => <input id={id} className="input" value={form.title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} autoFocus={autoFocus} data-testid="draft-title" />}
          </AiTextField>
        ) : (
          <Field label="Title">
            <input className="input" value={form.title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} autoFocus={autoFocus} data-testid="draft-title" />
          </Field>
        ))}
      {ai ? (
        <AiTextField key={`text-${draft?.id ?? 'new'}`} label={withTitle ? 'Text' : 'Reply'} value={form.text} onChange={(text) => set({ text })} ask={askFor('text')} blocked={blocked} disabled={disabled} testId="draft-text-help">
          {(id) => <textarea id={id} className="input draft-text" value={form.text} disabled={disabled} onChange={(e) => set({ text: e.target.value })} autoFocus={autoFocus && !withTitle} data-testid="draft-text" rows={4} />}
        </AiTextField>
      ) : (
        <Field label={withTitle ? 'Text' : 'Reply'}>
          <textarea className="input draft-text" value={form.text} disabled={disabled} onChange={(e) => set({ text: e.target.value })} autoFocus={autoFocus && !withTitle} data-testid="draft-text" rows={4} />
        </Field>
      )}
      <div className="form-row">
        <Field label="Link (optional)" hint="Links are checked against the product's own website.">
          <input className="input" value={form.link} disabled={disabled} onChange={(e) => set({ link: e.target.value })} placeholder="https://" data-testid="draft-link" />
        </Field>
        {!disabled && (
          <Field label="Add an image" hint="Full path of a PNG, JPEG, GIF or WebP file on this Mac (up to 10 MB). The file is checked when you save, and re-checked before sending.">
            <div className="draft-image-row">
              <input className="input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Pictures/screenshot.png" data-testid="attachment-path" />
              <Button onClick={addAttachment} disabled={!path.trim()} data-testid="attachment-add">
                Add
              </Button>
            </div>
          </Field>
        )}
      </div>
      {form.attachments.length > 0 && (
        <div className="rows draft-attachments" data-testid="draft-attachments">
          {form.attachments.map((a) => (
            <div key={a.path} className="draft-attachment">
              <Badge>{a.mime || 'image'}</Badge>
              <code>{a.name}</code>
              <span className="draft-attachment-path">{a.path}</span>
              {!disabled && (
                <Button variant="quiet" className="danger" onClick={() => set({ attachments: form.attachments.filter((x) => x.path !== a.path) })}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
