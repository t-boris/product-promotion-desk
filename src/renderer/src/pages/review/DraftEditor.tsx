import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { DraftInput } from '../../../../shared/api'
import type { Attachment, Draft, Id, PostMarkup } from '../../../../shared/types'
import { AiTextField } from '../../assist/AiField'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { FileLoader } from '../../FileLoader'
import { call, useQuery } from '../../hooks'
import { Badge, Button, Field } from '../../ui'
import { FoundSources } from './FoundSources'
import { foundForAnswer, keepFound, type FoundFor } from './found-sources'
import { fileName } from './labels'
import { PostPictures, PostTextBox, usePostEditor } from './PostEditorParts'
import { PostPreview, type PostAuthor } from './PostPreview'
import { SectionAssist } from './SectionAssist'
import { rangeOf, type Range } from './section-assist'

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
  post?: { productId: Id; platform: string; author: PostAuthor; /** The application does not read this channel: the AI browser is its only way, and needs no switch (DEC-035). */ reads: boolean }
}

/** Editor for a reply or a publication. Editing never changes what was approved: saving creates a new draft. */
export function DraftEditor({ form, onChange, withTitle, disabled, draft, autoFocus = false, ai, post }: Props) {
  const settings = useQuery('app.settings.get', undefined, ['settings'])
  const editor = usePostEditor(form, onChange, post?.productId ?? '')
  const inEditor = withTitle && post !== undefined
  // The part of the text that is selected, for "Change a part" (the AI changes only that part).
  const [picked, setPicked] = useState<Range | null>(null)
  // One editor per open card, so only "is an engine chosen" is asked here; the refusal after a press says why an engine cannot work.
  const { blocked } = useAssistBlock({ engineReady: false })
  const section = ai && inEditor ? <SectionAssist form={form} onChange={onChange} ai={ai} range={rangeOf(picked?.start, picked?.end, form.text)} onPick={setPicked} editor={editor} blocked={blocked} disabled={disabled} /> : null
  // What the AI found on the web for the last text it wrote (only when it searched): shown under the text while that text is the one in the field, and gone
  // when the text changes by any hand (the owner types, a tool of the toolbar, Undo): `keepFound` says what stays, and what went does not come back.
  const [found, setFound] = useState<FoundFor | null>(null)
  const foundNow = useRef<FoundFor | null>(null)
  const shownFound = keepFound(found, form.text)
  useEffect(() => {
    setFound((current) => keepFound(current, form.text))
  }, [form.text])
  // The AI is asked for one field of the draft as the editor holds it now; nothing is stored, the owner saves the draft.
  const askFor = (field: 'title' | 'text') => async ({ instruction }: { current: string; instruction: string | undefined }): Promise<string> => {
    if (field === 'text') {
      foundNow.current = null
      setFound(null)
    }
    const result = await call('drafts.refine', { field, opportunityId: ai?.opportunityId, channelId: ai?.channelId, form: { title: form.title, text: form.text }, instruction })
    const text = result[field]
    if (text === undefined) throw new Error('The AI did not return a text. Try again.')
    if (field === 'text') foundNow.current = foundForAnswer(text, result.sources)
    return text
  }
  // An answer is checked against the other field and the target it was asked for; if either moved on meanwhile, it is dropped (AiTextField).
  const target = ai?.opportunityId ?? ai?.channelId ?? ''
  const aroundTitle = JSON.stringify([target, form.text])
  const aroundText = JSON.stringify([target, form.title])
  // Anything done to a post in the editor makes it a Markdown post (DEC-030); a reply stays as it was.
  const set = (patch: Partial<DraftForm>): void => onChange((current) => ({ ...current, ...patch, ...(inEditor ? { markup: 'markdown' as const } : {}) }))
  const addAttachments = (paths: string[]): void => {
    const added = paths.map((path) => path.trim()).filter((path, index, all) => path !== '' && all.indexOf(path) === index && !form.attachments.some((a) => a.path === path))
    if (added.length === 0) return
    set({ attachments: [...form.attachments, ...added.map((path) => ({ name: fileName(path), path, mime: '', sha256: '' }))] })
  }

  const textField = (
    ai ? (
        <AiTextField key={`text-${draft?.id ?? 'new'}`} label={withTitle ? 'Text' : 'Reply'} value={form.text} onChange={(text) => set({ text })} ask={askFor('text')} blocked={blocked} disabled={disabled} around={aroundText} progressSubject={withTitle ? target || undefined : undefined} onSettled={(applied) => setFound(applied ? foundNow.current : null)} testId="draft-text-help">
          {(id) =>
            inEditor ? (
              <PostTextBox id={id} value={form.text} onChange={(text) => set({ text })} disabled={disabled} autoFocus={autoFocus && !withTitle} editor={editor} onSelection={(start, end) => setPicked({ start, end })} slot={section} />
            ) : (
              <textarea id={id} className="input draft-text" value={form.text} disabled={disabled} onChange={(e) => set({ text: e.target.value })} autoFocus={autoFocus && !withTitle} data-testid="draft-text" rows={4} />
            )
          }
        </AiTextField>
      ) : (
        <Field label={withTitle ? 'Text' : 'Reply'}>
          {inEditor ? (
            <PostTextBox id="draft-text-box" value={form.text} onChange={(text) => set({ text })} disabled={disabled} autoFocus={autoFocus && !withTitle} editor={editor} onSelection={(start, end) => setPicked({ start, end })} slot={section} />
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
          <div className="post-text-col">
            {textField}
            <FoundSources sources={shownFound?.sources ?? []} />
          </div>
          <PostPreview content={previewContent} channelPlatform={post.platform} author={post.author} aiBrowser={settings.data?.publishWith === 'ai_browser' || !post.reads} noConnector={!post.reads} />
        </div>
      ) : (
        <>
          {textField}
          <FoundSources sources={shownFound?.sources ?? []} />
        </>
      )}
      <div className="form-row">
        <Field label="Link (optional)" hint="Links are checked against the product's own website.">
          <input className="input" value={form.link} disabled={disabled} onChange={(e) => set({ link: e.target.value })} placeholder="https://" data-testid="draft-link" />
        </Field>
        {!disabled && !inEditor && (
          <FileLoader purpose="pictures" label="Add an image" hint="PNG, JPEG, GIF or WebP, up to 10 MB. The file is checked when you save, and re-checked before sending." onChoose={addAttachments} testId="attachment" />
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
