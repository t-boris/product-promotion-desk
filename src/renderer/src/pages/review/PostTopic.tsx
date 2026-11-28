import { useId, useRef, useState } from 'react'
import { TOPIC_TAG_LIMIT, cleanTopicTag, topicTagProblem } from '../../../../shared/topic-tag'
import type { Blocked } from '../../assist/block'
import { call, useAction } from '../../hooks'
import { Badge, Button, ErrorNote, Hint } from '../../ui'

/** What the line says under the field: the topic is part of the post, and who types it on the site. */
export const TOPIC_HINT = 'Threads files the post under this one topic. The application types it into Threads’ topic field when the post is published, and it is part of what you approve. Empty: no topic.'

/**
 * The Topic line of a post for a platform whose composer has a field for one topic (Threads). The owner types it or the AI names it from the post's
 * text (on the owner's press); the topic that stands here is the one the application types on the site and the approval covers.
 */
export function PostTopic({ value, onChange, title, text, disabled, blocked }: { value: string; onChange: (topic: string) => void; title: string; text: string; disabled: boolean; blocked: Blocked | null }) {
  const id = useId()
  const [proposed, setProposed] = useState<string | null>(null)
  const latest = useRef({ value, title, text })
  latest.current = { value, title, text }
  const [propose, state] = useAction(async () => {
    const before = latest.current.value
    const answer = await call('drafts.words', { form: { title: latest.current.title, text: latest.current.text } })
    // The owner typed one meanwhile: their words stand, the AI's answer is not put over them.
    if (latest.current.value !== before) return
    setProposed(answer.topic)
    onChange(answer.topic)
  })
  const clean = cleanTopicTag(value)
  const problem = clean === '' ? null : topicTagProblem(clean)
  const canAsk = !disabled && blocked === null && !state.busy && text.trim() !== ''
  return (
    <div className="field flair-field" data-testid="draft-topic-field">
      <div className="field-head">
        <span className="flair-head-left">
          <label className="field-label" htmlFor={id}>
            Topic (optional)
          </label>
          {proposed !== null && clean === proposed && <Badge>proposed by the AI</Badge>}
        </span>
        <Button variant="secondary" onClick={() => void propose()} disabled={!canAsk} data-testid="draft-topic-ai" aria-label={`${state.busy ? 'Thinking…' : 'Propose with AI'}: Topic`}>
          {state.busy ? 'Thinking…' : 'Propose with AI'}
        </Button>
      </div>
      <input id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} placeholder="One topic, like Astrology" aria-describedby={`${id}-hint`} aria-invalid={problem !== null} data-testid="draft-topic" />
      {problem !== null ? (
        <Hint className="bad" id={`${id}-hint`} data-testid="draft-topic-problem">
          {problem}
        </Hint>
      ) : (
        <Hint id={`${id}-hint`}>
          {TOPIC_HINT} At most {TOPIC_TAG_LIMIT} characters.
        </Hint>
      )}
      <ErrorNote error={state.error} />
    </div>
  )
}
