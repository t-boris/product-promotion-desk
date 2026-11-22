import { useEffect, useRef, useState } from 'react'
import type { Id } from '../../../../shared/types'
import { flairChoices, offeredFlair } from '../../../../shared/flair'
import type { Blocked } from '../../assist/block'
import { call, useAction, useQuery } from '../../hooks'
import { Badge, Button, ErrorNote, Hint } from '../../ui'

/**
 * The Flair line of a post for a community that has flairs (Reddit): a list filled from the community's own flairs, never typed. The AI proposes the flair
 * from the post (once, when the line first shows for a community that requires one and the post has none; and when the owner presses), the owner may change
 * it, and the flair that stands here is the one the application chooses on the site and the approval covers. A platform that has no such form shows nothing.
 */
export function PostFlair({
  channelId,
  value,
  onChange,
  title,
  text,
  disabled,
  blocked
}: {
  channelId: Id
  value: string | null
  onChange: (flair: string | null) => void
  title: string
  text: string
  disabled: boolean
  blocked: Blocked | null
}) {
  const form = useQuery('channels.postForm', { channelId }, [])
  const [proposed, setProposed] = useState<string | null>(null)
  const [none, setNone] = useState(false)
  const latest = useRef({ value, title, text, disabled, blocked })
  latest.current = { value, title, text, disabled, blocked }
  const data = form.data

  const [propose, state] = useAction(async () => {
    const before = latest.current.value
    setNone(false)
    const answer = await call('drafts.suggestFlair', { channelId, title: latest.current.title, text: latest.current.text })
    // The owner chose one meanwhile: their choice stands, the AI's answer is not put over it.
    if (latest.current.value !== before) return
    if (answer.flair === null) setNone(true)
    else {
      setProposed(answer.flair)
      onChange(answer.flair)
    }
  })

  // The first time the line shows for a community that requires a flair and the post has none: the AI proposes, like everything else in the editor. Once; a
  // post the owner is still writing is not read half-written.
  const decided = useRef(false)
  useEffect(() => {
    if (!data || decided.current) return
    decided.current = true
    const now = latest.current
    if (data.supported && data.problem === null && data.flairRequired && data.flairs.length > 0 && now.value === null && !now.disabled && now.blocked === null && now.title.trim() !== '' && now.text.trim() !== '') void propose()
  }, [data])

  if (!data || !data.supported) return null
  const required = data.flairRequired
  const held = value !== null ? offeredFlair(data.flairs, value) ?? value : null
  const choices = flairChoices(data.flairs, held)
  const canAsk = !disabled && blocked === null && !state.busy && data.flairs.length > 0 && (title.trim() !== '' || text.trim() !== '')

  return (
    <div className="field flair-field" data-testid="draft-flair-field">
      <div className="field-head">
        <span className="flair-head-left">
          <label className="field-label" htmlFor={`flair-${channelId}`}>
            Flair
          </label>
          {required && <Badge>required by the community</Badge>}
        </span>
        <Button variant="secondary" onClick={() => void propose()} disabled={!canAsk} data-testid="draft-flair-ai" aria-label={`${state.busy ? 'Thinking…' : 'Choose with AI'}: Flair`}>
          {state.busy ? 'Thinking…' : 'Choose with AI'}
        </Button>
      </div>
      {data.problem !== null ? (
        <div className="flair-problem" data-testid="draft-flair-problem">
          <Hint tone="warn">
            The community's flairs could not be read now ({data.problem}).{required ? '' : ' The post can still be written.'}
          </Hint>
          <Button variant="quiet" onClick={form.reload} data-testid="draft-flair-retry">
            Try again
          </Button>
          {held !== null && <span className="small">Chosen: {held}</span>}
        </div>
      ) : (
        <select
          id={`flair-${channelId}`}
          className="input"
          value={held ?? ''}
          disabled={disabled}
          onChange={(e) => {
            setProposed(null)
            setNone(false)
            onChange(e.target.value === '' ? null : e.target.value)
          }}
          data-testid="draft-flair"
        >
          <option value="">{required ? 'Choose a flair…' : 'No flair'}</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      )}
      {held !== null && proposed !== null && held === proposed && (
        <span className="hint" data-testid="draft-flair-proposed">
          The AI chose this one from the community's list. Change it if it does not fit.
        </span>
      )}
      {none && (
        <span className="hint" role="status" data-testid="draft-flair-none">
          The AI found no flair that fits. Choose one yourself.
        </span>
      )}
      {required && held === null && data.problem === null && !state.busy && !none && <span className="hint">This community refuses a post without a flair.</span>}
      <ErrorNote error={state.error} />
    </div>
  )
}
