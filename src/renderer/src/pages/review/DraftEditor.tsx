import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { Attachment, Draft, Id, PostMarkup } from '../../../../shared/types'
import { AiTextField } from '../../assist/AiField'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call } from '../../hooks'
import { Badge, Button, Field } from '../../ui'
import { fileName } from './labels'
import { PostPictures, PostTextBox, usePostEditor } from './PostEditorParts'
import { PostPreview, type PostAuthor } from './PostPreview'

export interface DraftForm {
  title: string
  text: string
  link: string
  attachments: Attachment[]
  /** `markdown` once the owner has worked on a post in the editor; an older draft stays `legacy` until then (DEC-030). */
  markup: PostMarkup
}

/** A new post is written in the post editor, so it is Markdown from the start; a reply is plain text. */
export const emptyForm = (withTitle: boolean): DraftForm => ({ title: '', text: '', link: '', attachments: [], markup: withTitle ? 'markdown' : 'legacy' })

function fromDraft(draft: Draft | null, withTitle: boolean): DraftForm {
  if (!draft) return emptyForm(withTitle)
  return { title: draft.title ?? '', text: draft.text, link: draft.link ?? '', attachments: draft.attachments, markup: draft.markup ?? 'legacy' }
}

/** What the core will store for this form: surrounding whitespace is trimmed there too. */
export function toInput(form: DraftForm, withTitle: boolean): DraftInput {
  return { title: withTitle ? form.title.trim() || null : null, text: form.text.trim(), link: form.link.trim() || null, attachments: form.attachments, markup: form.markup }
}

const signature = (form: DraftForm, withTitle: boolean): string => {
  const input = toInput(form, withTitle)
  return JSON.stringify([input.title, input.text, input.link, form.attachments.map((a) => a.mediaId ?? a.path), form.markup])
}

/** Form state for one draft: resets when a different (newly saved) draft arrives and says whether it was edited. */
export function useDraftForm(draft: Draft | null, withTitle: boolean): { form: DraftForm; setForm: Dispatch<SetStateAction<DraftForm>>; dirty: boolean; input: DraftInput } {
  const [form, setForm] = useState<DraftForm>(() => fromDraft(draft, withTitle))
  const draftId = draft?.id ?? null
  // Only a different draft row (a new save, or an AI re-draft) replaces what the owner is typing.
  useEffect(() => {
    setForm(fromDraft(draft, withTitle))
  }, [draftId])
  const dirty = signature(form, withTitle) !== signature(fromDraft(draft, withTitle), withTitle)
  return { form, setForm, dirty, input: toInput(form, withTitle) }
}

interface Props {
  form: DraftForm
  /** A state setter: a change is applied to the form as it is then, never to the one a slow answer was asked from (lesson 84). */
  onChange: Dispatch<SetStateAction<DraftForm>>
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
  /** A post is written in the post editor (DEC-030): the product whose library holds its pictures, and the platform the preview shows it as. */
  post?: { productId: Id; platform: string; author: PostAuthor }
}

/** Editor for a reply or a publication. Editing never changes what was approved: saving creates a new draft. */
export function DraftEditor({ form, onChange, withTitle, disabled, draft, autoFocus = false, ai, post }: Props) {
  const [path, setPath] = useState('')
  const editor = usePostEditor(form, onChange, post?.productId ?? '')
  const inEditor = withTitle && post !== undefined
  // One editor per open card, so only "is an engine chosen" is asked here; the refusal after a press says why an engine cannot work.
  const { blocked } = useAssistBlock({ engineReady: false })
  // The AI is asked for one field of the draft as the editor holds it now; nothing is stored, the owner saves the draft.
  const askFor = (field: 'title' | 'text') => async ({ instruction }: { current: string; instruction: string | undefined }): Promise<string> => {
    const result = await call('drafts.refine', { field, opportunityId: ai?.opportunityId, channelId: ai?.channelId, form: { title: form.title, text: form.text }, instruction })
    const text = result[field]
    if (text === undefined) throw new Error('The AI did not return a text. Try again.')
    return text
  }
  // An answer is checked against the other field and the target it was asked for; if either moved on meanwhile, it is dropped (AiTextField).
  const target = ai?.opportunityId ?? ai?.channelId ?? ''
  const aroundTitle = JSON.stringify([target, form.text])
  const aroundText = JSON.stringify([target, form.title])
  // Anything done to a post in the editor makes it a Markdown post (DEC-030); a reply stays as it was.
  const set = (patch: Partial<DraftForm>): void => onChange((current) => ({ ...current, ...patch, ...(inEditor ? { markup: 'markdown' as const } : {}) }))
  const addAttachment = (): void => {
    const trimmed = path.trim()
    if (!trimmed || form.attachments.some((a) => a.path === trimmed)) return
    set({ attachments: [...form.attachments, { name: fileName(trimmed), path: trimmed, mime: '', sha256: '' }] })
    setPath('')
  }

  const textField = (
    ai ? (
        <AiTextField key={`text-${draft?.id ?? 'new'}`} label={withTitle ? 'Text' : 'Reply'} value={form.text} onChange={(text) => set({ text })} ask={askFor('text')} blocked={blocked} disabled={disabled} around={aroundText} testId="draft-text-help">
          {(id) =>
            inEditor ? (
              <PostTextBox id={id} value={form.text} onChange={(text) => set({ text })} disabled={disabled} autoFocus={autoFocus && !withTitle} editor={editor} />
            ) : (
              <textarea id={id} className="input draft-text" value={form.text} disabled={disabled} onChange={(e) => set({ text: e.target.value })} autoFocus={autoFocus && !withTitle} data-testid="draft-text" rows={4} />
            )
          }
        </AiTextField>
      ) : (
        <Field label={withTitle ? 'Text' : 'Reply'}>
          {inEditor ? (
            <PostTextBox id="draft-text-box" value={form.text} onChange={(text) => set({ text })} disabled={disabled} autoFocus={autoFocus && !withTitle} editor={editor} />
          ) : (
            <textarea className="input draft-text" value={form.text} disabled={disabled} onChange={(e) => set({ text: e.target.value })} autoFocus={autoFocus && !withTitle} data-testid="draft-text" rows={4} />
          )}
        </Field>
      )
  )
  const previewContent = { title: form.title.trim() || null, text: form.text.trim(), link: form.link.trim() || null, attachments: form.attachments, markup: form.markup }

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
          <AiTextField key={`title-${draft?.id ?? 'new'}`} label="Title" value={form.title} onChange={(title) => set({ title })} ask={askFor('title')} blocked={blocked} disabled={disabled} around={aroundTitle} testId="draft-title-help">
            {(id) => <input id={id} className="input" value={form.title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} autoFocus={autoFocus} data-testid="draft-title" />}
          </AiTextField>
        ) : (
          <Field label="Title">
            <input className="input" value={form.title} disabled={disabled} onChange={(e) => set({ title: e.target.value })} autoFocus={autoFocus} data-testid="draft-title" />
          </Field>
        ))}
      {inEditor && post ? (
        <div className="post-pair">
          {textField}
          <PostPreview content={previewContent} channelPlatform={post.platform} author={post.author} />
        </div>
      ) : (
        textField
      )}
      <div className="form-row">
        <Field label="Link (optional)" hint="Links are checked against the product's own website.">
          <input className="input" value={form.link} disabled={disabled} onChange={(e) => set({ link: e.target.value })} placeholder="https://" data-testid="draft-link" />
        </Field>
        {!disabled && !inEditor && (
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
      {inEditor && post && (
        <>
          <PostPictures form={form} productId={post.productId} disabled={disabled} editor={editor} />
        </>
      )}
      {!inEditor && form.attachments.length > 0 && (
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
