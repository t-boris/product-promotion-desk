import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Id, SectionEditResult, SectionQuick } from '../../../../shared/types'
import { AiProgressPanel } from '../../AiProgress'
import type { Blocked } from '../../assist/block'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Hint } from '../../ui'
import type { DraftForm } from './DraftEditor'
import { FoundSources } from './FoundSources'
import type { PostEditorState } from './PostEditorParts'
import { applyProposal, changeReason, MAX_WISH, newPart, oldPart, QUICKS, selectedWord, type Asked, type Range } from './section-assist'
import './section-assist.css'

interface Proposal {
  asked: Asked
  result: SectionEditResult
}

/**
 * "Change a part" in the post editor: the owner selects some of the text, presses a quick word (shorter, longer, simpler, warmer, rewrite) or says in their own words what should
 * change, and the AI returns a new version of only that part. The old and the new are shown side by side; "Use this" puts the new part in place of the selected one, "Keep mine"
 * drops it. Nothing outside the selection can change, and nothing is saved: the owner saves the post. The AI controls are never the filled button (V-10).
 */
export function SectionAssist({
  form,
  onChange,
  ai,
  range,
  onPick,
  editor,
  blocked,
  disabled
}: {
  form: DraftForm
  /** A state setter: a change is applied to the form as it is then, never to the one a slow answer was asked from (lesson 84). */
  onChange: Dispatch<SetStateAction<DraftForm>>
  ai: { opportunityId?: Id; channelId?: Id }
  /** The part of the text that is selected now, or null. */
  range: Range | null
  /** Told which part is selected after the new part is in (the text box reports only what the owner selects by hand). */
  onPick: (range: Range) => void
  editor: PostEditorState
  blocked: Blocked | null
  disabled: boolean
}) {
  const id = useId()
  const [wish, setWish] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [skipped, setSkipped] = useState(false)
  const latest = useRef(form)
  latest.current = form
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // A proposal that no longer fits the text (the owner typed, a mark was applied, the text was undone) is gone: it would land in the wrong place.
  useEffect(() => {
    setProposal((current) => (current && current.asked.text !== form.text ? null : current))
  }, [form.text])

  const reason = changeReason(range)
  const [ask, state] = useAction(async (quick: SectionQuick | undefined) => {
    if (!range) return
    const asked: Asked = { text: form.text, title: form.title }
    setSkipped(false)
    setProposal(null)
    const result = await call('drafts.editSection', {
      opportunityId: ai.opportunityId,
      channelId: ai.channelId,
      form: { title: form.title, text: form.text },
      start: range.start,
      end: range.end,
      quick,
      instruction: wish.trim() || undefined
    })
    if (!mounted.current) return
    // Typing meanwhile wins: the answer was made for the text as it was.
    if (latest.current.text !== asked.text) {
      setSkipped(true)
      return
    }
    setProposal({ asked, result })
  })
  const busy = state.busy
  const off = disabled || blocked !== null || busy

  const use = (): void => {
    if (!proposal) return
    const done = applyProposal({ text: latest.current.text, title: latest.current.title }, proposal.asked, proposal.result)
    if (!done) {
      setProposal(null)
      setSkipped(true)
      return
    }
    // The new part is selected once it is in, so the owner sees where it landed and can change it again.
    editor.select(done.range)
    onPick(done.range)
    onChange((current) => ({ ...current, text: done.text, markup: 'markdown' }))
    setProposal(null)
    setWish('')
  }

  return (
    <div className="section-assist" data-testid="section-assist">
      <div className="section-assist-head">
        <span className="field-label">Change a part</span>
        <span className="muted small" data-testid="section-assist-state">
          {range ? selectedWord(range) : 'Select some of the text below, then say what should change.'}
        </span>
      </div>
      <div className="section-assist-row">
        <div className="section-assist-quick" role="group" aria-label="Quick changes">
          {QUICKS.map((q) => (
            <Button key={q.value} variant="ghost" title={q.title} disabled={off || reason !== null} onClick={() => void ask(q.value)} data-testid={`section-quick-${q.value}`}>
              {q.label}
            </Button>
          ))}
        </div>
        <input
          id={`${id}-wish`}
          className="input section-assist-wish"
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && wish.trim() !== '' && !off && reason === null) {
              e.preventDefault()
              void ask(undefined)
            }
          }}
          disabled={disabled || busy}
          maxLength={MAX_WISH}
          placeholder="…or say what to change, for example: add an example"
          aria-label="What should change in the selected part"
          data-testid="section-assist-wish"
        />
        <Button variant="secondary" icon="sparkles" onClick={() => void ask(undefined)} disabled={off || reason !== null || wish.trim() === ''} data-testid="section-assist-ask">
          {busy ? 'Thinking…' : 'Change with AI'}
        </Button>
      </div>
      {blocked && (
        <Hint tone="warn" data-testid="section-assist-blocked">
          {blocked.text} <a href={blocked.fix.href}>{blocked.fix.label}</a>
        </Hint>
      )}
      {busy && <AiProgressPanel subject={ai.opportunityId ?? ai.channelId} />}
      <ErrorNote error={state.error} />
      {skipped && (
        <p className="hint" role="status" data-testid="section-assist-skipped">
          The text changed while the AI was working, so its new part was not used. Select the part again and ask again.
        </p>
      )}
      {proposal && (
        <div className="section-proposal" data-testid="section-proposal">
          <div className="section-proposal-pair">
            <div className="section-proposal-side">
              <span className="field-label">Now</span>
              <div className="section-proposal-text" data-testid="section-proposal-old">
                {oldPart(proposal.asked.text, proposal.result)}
              </div>
            </div>
            <div className="section-proposal-side section-proposal-new">
              <span className="field-label">The AI&rsquo;s version</span>
              <div className="section-proposal-text" data-testid="section-proposal-new">
                {newPart(proposal.result)}
              </div>
            </div>
          </div>
          {proposal.result.notes.length > 0 && (
            <ul className="material-notes">
              {proposal.result.notes.map((note) => (
                <li key={note} className="muted small">
                  {note}
                </li>
              ))}
            </ul>
          )}
          <FoundSources sources={proposal.result.sources ?? []} />
          <div className="section-proposal-actions">
            <Button variant="secondary" onClick={use} disabled={disabled} data-testid="section-use">
              Use this
            </Button>
            <Button variant="ghost" onClick={() => setProposal(null)} data-testid="section-keep">
              Keep mine
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
