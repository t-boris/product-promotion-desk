import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ComposeResult, DraftSource, Id, PostLength } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { FileLoader } from '../../FileLoader'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Hint, IconButton, SegmentedControl } from '../../ui'
import type { DraftForm } from './DraftEditor'
import { FoundSources } from './FoundSources'
import { addPaths, kindRole, kindWord, leaveOut, LENGTHS, lengthNote, MAX_BRIEF, removePath, shownFiles, sizeWord, writeReason } from './material-post'
import { postAnswerFate, postUndoable, showPostHelper, type PostText } from './post-draft'
import '../../assist/assist.css'
import './material-post.css'

const post = (form: DraftForm): PostText => ({ title: form.title, text: form.text })
/** Files listed at once in the box; the rest is counted. */
const LISTED = 40

/**
 * "Make it from your material" for a new publication: the owner gives files or a folder (documents, pictures, videos), says in their own words what the post should be like and how
 * long, and the AI writes the title and the text from what the application read of the material, placing the pictures where they belong. The post goes into the form, never into
 * storage: the owner reads it, changes it and saves it like any other. "Undo" empties the form again while the owner has not typed over it. Like the other helper, it is offered while
 * the form is empty (or holds only what the AI wrote), so it never writes over the owner's own words. The AI control is never the filled button (V-10).
 */
export function PostFromMaterial({ productId, channelId, form, onChange }: { productId: Id; channelId: Id; form: DraftForm; onChange: Dispatch<SetStateAction<DraftForm>> }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [paths, setPaths] = useState<string[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [brief, setBrief] = useState('')
  const [length, setLength] = useState<PostLength>('medium')
  const [applied, setApplied] = useState<PostText | null>(null)
  const [skipped, setSkipped] = useState<'typed' | 'channel' | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [found, setFound] = useState<DraftSource[]>([])
  const { blocked } = useAssistBlock({ productId, needsPassport: false })
  const latest = useRef({ form, channelId })
  latest.current = { form, channelId }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // What is in the material, read by the application (no AI): shown before anything is written.
  const preview = useQuery('material.preview', { paths, exclude: excluded }, [], { skip: paths.length === 0 })
  const files = paths.length === 0 ? [] : (preview.data?.files ?? [])
  const reason = writeReason({ files, brief, loading: paths.length > 0 && preview.loading && !preview.data, busy: false, blocked: blocked !== null })

  const [run, state] = useAction(async () => {
    const asked = post(form)
    setSkipped(null)
    setNotes([])
    setFound([])
    const result: ComposeResult = await call('drafts.compose', { channelId, material: paths, exclude: excluded, brief: brief.trim() || undefined, length, form: asked })
    if (!mounted.current) return
    // Typing meanwhile wins, and a post made for one channel is not put into a form that now points at another (its checks were that product's).
    const fate = postAnswerFate({ ...asked, channelId }, { ...post(latest.current.form), channelId: latest.current.channelId })
    if (fate !== 'apply') {
      setSkipped(fate === 'channel' ? 'channel' : 'typed')
      return
    }
    onChange((current) => ({ ...current, title: result.title, text: result.text, attachments: result.attachments, markup: 'markdown' }))
    setApplied({ title: result.title, text: result.text })
    setNotes(result.notes)
    setFound(result.sources ?? [])
  })

  if (!showPostHelper(post(form), applied)) {
    // The owner has written something of their own: the helper steps aside (its button would write over it), but what it told them and what it found stay on the screen.
    return (
      <>
        {skipped && (
          <p className="hint" role="status" data-testid="post-material-skipped">
            {skipped === 'channel' ? 'You changed the channel while the AI was working, so its post was not used. Ask again to get it.' : 'You typed while the AI was working, so its post was not used. Clear the title and the text, then ask again.'}
          </p>
        )}
        {notes.length > 0 && (
          <ul className="material-notes" data-testid="post-material-notes">
            {notes.map((note) => (
              <li key={note} className="muted small">
                {note}
              </li>
            ))}
          </ul>
        )}
        <FoundSources sources={found} />
      </>
    )
  }
  const undoable = postUndoable(post(form), applied)
  const { shown, more } = shownFiles(files, LISTED)

  if (!open) {
    return (
      <div className="material-closed" data-testid="post-material-closed">
        <Button variant="secondary" icon="sparkles" onClick={() => setOpen(true)} data-testid="post-material-open">
          Make it from my material
        </Button>
        <span className="hint">Give files or a folder: documents, pictures, videos. The AI writes the post from them the way you ask.</span>
      </div>
    )
  }

  // The post is on the screen: the panel steps back to the one line that says where it came from, "Undo", and what the owner should know. The files, the wish and the length stay
  // as they were for another try after "Undo".
  if (undoable) {
    return (
      <div className="field material" data-testid="post-material">
        <div className="ai-undo" role="status" data-testid="post-material-undo-note">
          <span className="hint">
            The AI wrote this title and text from your material{preview.data ? ` (${preview.data.summary})` : ''}. Check them before you save.
          </span>
          <Button
            variant="quiet"
            onClick={() => {
              onChange((current) => ({ ...current, title: '', text: '', attachments: [] }))
              setApplied(null)
              setNotes([])
              setFound([])
            }}
            data-testid="post-material-undo"
          >
            Undo
          </Button>
        </div>
        {notes.length > 0 && (
          <ul className="material-notes" data-testid="post-material-notes">
            {notes.map((note) => (
              <li key={note} className="muted small">
                {note}
              </li>
            ))}
          </ul>
        )}
        <FoundSources sources={found} />
      </div>
    )
  }

  return (
    <div className="field material" data-testid="post-material">
      <div className="field-head">
        <span className="field-label">Make it from your material</span>
        <Button variant="quiet" onClick={() => setOpen(false)} disabled={state.busy} data-testid="post-material-close">
          Close
        </Button>
      </div>

      <FileLoader
        purpose="material"
        label="Your files or folder"
        hint="Documents are read by the AI. Pictures can be placed in the post. Videos are only listed for now. Nothing is copied or changed until a picture goes into the post."
        onChoose={(chosen) => setPaths((current) => addPaths(current, chosen))}
        disabled={state.busy}
        testId="post-material-loader"
      />

      {paths.length > 0 && (
        <div className="material-list" data-testid="post-material-list">
          <div className="material-summary">
            <strong data-testid="post-material-summary">{preview.data ? preview.data.summary : 'Reading your files…'}</strong>
            <Button
              variant="quiet"
              onClick={() => {
                setPaths([])
                setExcluded([])
              }}
              disabled={state.busy}
              data-testid="post-material-clear"
            >
              Clear all
            </Button>
          </div>
          <ErrorNote error={preview.error} />
          {preview.data && shown.length > 0 && (
            <ul className="material-files" aria-label="The files the post is made from">
              {shown.map((file) => (
                <li key={file.path} className="material-file" data-testid="post-material-file">
                  <Badge>{kindWord(file.kind)}</Badge>
                  <span className="material-file-name" title={file.path}>
                    {file.relative}
                  </span>
                  <span className="muted small material-file-note">{kindRole(file.kind)}</span>
                  <span className="muted small">{sizeWord(file.size)}</span>
                  <IconButton icon="xmark" label={`Leave out ${file.relative}`} onClick={() => setExcluded((current) => leaveOut(current, file.path))} disabled={state.busy} />
                </li>
              ))}
            </ul>
          )}
          {more > 0 && <span className="muted small">…and {more} more files.</span>}
          {preview.data && preview.data.skipped.length > 0 && (
            <details className="more">
              <summary>
                {preview.data.skipped.length === 1 ? 'One item will not be used' : `${preview.data.skipped.length} items will not be used`}
              </summary>
              <ul className="material-skipped">
                {preview.data.skipped.slice(0, 20).map((item) => (
                  <li key={item.relative}>
                    <code>{item.relative}</code> <span className="muted small">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.data?.cut && <span className="hint">The folder holds more than is read: the first files, a few levels deep.</span>}
          {paths.length > 1 && (
            <div className="material-roots">
              {paths.map((path) => (
                <Button key={path} variant="quiet" onClick={() => setPaths((current) => removePath(current, path))} disabled={state.busy} title={path}>
                  Remove {path.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor={`${id}-brief`}>
          What should the post be like?
        </label>
        <textarea
          id={`${id}-brief`}
          className="input"
          rows={4}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={MAX_BRIEF}
          disabled={state.busy}
          placeholder="For example: a friendly story for people who are new to astrology, using the three best pictures, ending with a question."
          data-testid="post-material-brief"
        />
        <span className="hint">Say the angle, the readers, the tone, what to stress or leave out. The more you say, the closer the first try is.</span>
      </div>

      <div className="field">
        <span className="field-label">How long?</span>
        <SegmentedControl<PostLength> label="How long the post is" name={`${id}-length`} options={LENGTHS.map((l) => ({ value: l.value, label: l.label }))} value={length} onChange={setLength} disabled={state.busy} testIdPrefix="post-material-length-" />
        <span className="hint">{lengthNote(length)}</span>
      </div>

      <div className="material-actions">
        <Button variant="secondary" icon="sparkles" onClick={() => void run()} disabled={blocked !== null || state.busy || reason !== null} data-testid="post-material-write">
          {state.busy ? 'Thinking…' : 'Write the post'}
        </Button>
        {reason && <span className="muted small">{reason}</span>}
      </div>
      {blocked && (
        <Hint tone="warn" data-testid="post-material-blocked">
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      {state.busy && <AiProgressPanel subject={channelId} />}
      <ErrorNote error={state.error} />
      {skipped && (
        <p className="hint" role="status" data-testid="post-material-skipped">
          {skipped === 'channel' ? 'You changed the channel while the AI was working, so its post was not used. Ask again to get it.' : "You typed while the AI was working, so its post was not used. Clear the title and the text, then ask again."}
        </p>
      )}
    </div>
  )
}
