import { useEffect, useState } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { Attachment, Draft } from '../../../../shared/types'
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
}

/** Editor for a reply or a publication. Editing never changes what was approved: saving creates a new draft. */
export function DraftEditor({ form, onChange, withTitle, disabled, draft }: Props) {
  const [path, setPath] = useState('')
  const set = (patch: Partial<DraftForm>): void => onChange({ ...form, ...patch })
  const addAttachment = (): void => {
    const trimmed = path.trim()
    if (!trimmed || form.attachments.some((a) => a.path === trimmed)) return
    set({ attachments: [...form.attachments, { name: fileName(trimmed), path: trimmed, mime: '', sha256: '' }] })
    setPath('')
  }

  return (
    <div data-testid="draft-editor">
      {draft && (
        <div className="row small muted">
          <Badge tone={draft.author === 'ai' ? 'info' : 'neutral'}>{draft.author === 'ai' ? 'Prepared by the AI' : 'Written by you'}</Badge>
          {draft.rationale && <span data-testid="draft-rationale">Why: {draft.rationale}</span>}
        </div>
      )}
      {withTitle && (
        <Field label="Title">
          <input className="input" value={form.title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} data-testid="draft-title" />
        </Field>
      )}
      <Field label={withTitle ? 'Text' : 'Reply'}>
        <textarea className="input" value={form.text} disabled={disabled} onChange={(e) => set({ text: e.target.value })} data-testid="draft-text" rows={withTitle ? 8 : 5} />
      </Field>
      <Field label="Link (optional)" hint="Links are checked against the product's own website.">
        <input className="input" value={form.link} disabled={disabled} onChange={(e) => set({ link: e.target.value })} placeholder="https://" data-testid="draft-link" />
      </Field>
      {form.attachments.length > 0 && (
        <div className="stack" data-testid="draft-attachments">
          {form.attachments.map((a) => (
            <div key={a.path} className="row small">
              <Badge>{a.mime || 'image'}</Badge>
              <code>{a.name}</code>
              <span className="muted">{a.path}</span>
              {!disabled && <Button onClick={() => set({ attachments: form.attachments.filter((x) => x.path !== a.path) })}>Remove</Button>}
            </div>
          ))}
        </div>
      )}
      {!disabled && (
        <Field label="Add an image" hint="Full path of a PNG, JPEG, GIF or WebP file on this Mac (up to 10 MB). The file is checked when you save, and re-checked before sending.">
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Pictures/screenshot.png" data-testid="attachment-path" />
            <Button onClick={addAttachment} disabled={!path.trim()} data-testid="attachment-add">
              Add
            </Button>
          </div>
        </Field>
      )}
    </div>
  )
}
