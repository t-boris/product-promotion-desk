import { useEffect, useId, useRef, useState } from 'react'
import type { Id } from '../../../../shared/types'
import { useAssistBlock } from '../../assist/useAssistBlock'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Hint } from '../../ui'
import type { DraftForm } from './DraftEditor'
import { canApplyPost, postUndoable, showPostHelper, type PostText } from './post-draft'
import '../../assist/assist.css'

const post = (form: DraftForm): PostText => ({ title: form.title, text: form.text })

/**
 * "Draft with AI" for a new publication: the owner says in a few words what it is about (or nothing), and the AI writes the title and
 * the text from the approved product knowledge and the channel's rules. Both go into the form, never into storage: the owner reads
 * them, changes them and saves the draft. "Undo" empties them again while the owner has not typed over them. The AI control is never
 * the filled button (V-10).
 */
export function PostDrafter({ productId, channelId, form, onChange }: { productId: Id; channelId: Id; form: DraftForm; onChange: (form: DraftForm) => void }) {
  const id = useId()
  const [about, setAbout] = useState('')
  const [applied, setApplied] = useState<PostText | null>(null)
  const [skipped, setSkipped] = useState(false)
  const { blocked } = useAssistBlock({ productId, needsPassport: true })
  // The form as it is when the answer arrives: the owner may type while the AI works, and the form may be closed meanwhile.
  const latest = useRef(form)
  latest.current = form
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A button that is disabled while the AI works loses the focus to the page (lesson 138): give it back when the work ends.
  const root = useRef<HTMLDivElement>(null)
  const hadFocus = useRef(false)

  const [run, state] = useAction(async () => {
    const asked = post(form)
    hadFocus.current = root.current?.contains(document.activeElement) ?? false
    setSkipped(false)
    const result = await call('drafts.refine', { field: 'post', channelId, form: asked, about: about.trim() || undefined })
    if (!mounted.current) return
    if (!canApplyPost(asked, post(latest.current)) || result.title === undefined || result.text === undefined) {
      setSkipped(true) // typing meanwhile wins; the AI's post is dropped, not merged
      return
    }
    onChange({ ...latest.current, title: result.title, text: result.text })
    setApplied({ title: result.title, text: result.text })
  })

  useEffect(() => {
    if (state.busy || !hadFocus.current) return
    hadFocus.current = false
    if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('.field-head button, .ai-undo button')?.focus()
  }, [state.busy])

  if (!showPostHelper(post(form), applied)) return null
  const undoable = postUndoable(post(form), applied)

  return (
    <div className="field ai-field" ref={root} data-testid="post-drafter">
      <div className="field-head">
        <label className="field-label" htmlFor={id}>
          What is it about?
        </label>
        <Button
          variant="secondary"
          icon="sparkles"
          onClick={() => void run()}
          disabled={blocked !== null || state.busy || undoable}
          aria-describedby={blocked ? `${id}-blocked` : undefined}
          data-testid="post-drafter-ai"
        >
          {state.busy ? 'Thinking…' : 'Draft with AI'}
        </Button>
      </div>
      <input
        id={id}
        className="input"
        value={about}
        onChange={(e) => setAbout(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (!blocked && !state.busy && !undoable) void run()
          }
        }}
        disabled={state.busy}
        placeholder="Optional: for example, how the chart is built"
        data-testid="post-drafter-about"
      />
      <span className="hint">The AI writes the title and the text from your approved product knowledge and the channel's rules. You read and change them before you save.</span>
      {blocked && (
        <Hint tone="warn" id={`${id}-blocked`} data-testid="post-drafter-blocked">
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      <ErrorNote error={state.error} />
      {skipped && (
        <p className="hint" role="status" data-testid="post-drafter-skipped">
          You typed while the AI was working, so its post was not used. Ask again to get it.
        </p>
      )}
      {undoable && (
        <div className="ai-undo" role="status" data-testid="post-drafter-undo-note">
          <span className="hint">The AI wrote this title and text. Check them before you save.</span>
          <Button
            variant="quiet"
            onClick={() => {
              onChange({ ...form, title: '', text: '' })
              setApplied(null)
            }}
            data-testid="post-drafter-undo"
          >
            Undo
          </Button>
        </div>
      )}
    </div>
  )
}
