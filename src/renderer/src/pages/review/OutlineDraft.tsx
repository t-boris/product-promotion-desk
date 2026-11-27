import { useState } from 'react'
import { call, useAction } from '../../hooks'
import { Button, ErrorNote, Hint } from '../../ui'

type Kind = 'carousel' | 'video'
const HEAD: Record<Kind, { title: string; show: string; say: string; part: string }> = {
  carousel: { title: 'As a carousel', show: 'Headline', say: 'Text', part: 'Slide' },
  video: { title: 'As a short video', show: 'Show', say: 'Say', part: 'Shot' }
}

/** The plan as plain text, for the clipboard. */
export function outlineText(kind: Kind, parts: readonly { show: string; say: string }[]): string {
  return parts.map((p, i) => `${HEAD[kind].part} ${i + 1}: ${p.show}${p.say ? `\n${p.say}` : ''}`).join('\n\n')
}

/**
 * The draft in the editor as the slides of a carousel or the shots of a process video (DEC-069), cut by the AI from the post's own text. A plan
 * in words: the application makes no slide and no video, keeps nothing, and the draft stays as it is.
 */
export function OutlineDraft({ title, text, disabled }: { title: string; text: string; disabled: boolean }) {
  const [plan, setPlan] = useState<{ kind: Kind; parts: { show: string; say: string }[]; of: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [cut, cutting] = useAction(async (kind: Kind) => {
    const result = await call('drafts.outline', { form: { title, text }, kind })
    setPlan({ ...result, of: text })
    setCopied(false)
  })
  const off = disabled || cutting.busy || text.trim() === ''
  return (
    <div className="draft-outline" data-testid="draft-outline">
      <div className="draft-translate">
        <span>Plan this post</span>
        <Button variant="secondary" onClick={() => void cut('carousel')} disabled={off} data-testid="draft-outline-carousel">
          {cutting.busy ? 'Working…' : 'As a carousel'}
        </Button>
        <Button variant="secondary" onClick={() => void cut('video')} disabled={off} data-testid="draft-outline-video">
          As a short video
        </Button>
      </div>
      <ErrorNote error={cutting.error} />
      {plan && (
        <div className="stack" data-testid="draft-outline-plan">
          <strong>{HEAD[plan.kind].title}</strong>
          {plan.of !== text && <Hint>The post changed since this plan was cut.</Hint>}
          <ol className="draft-outline-parts">
            {plan.parts.map((part, index) => (
              <li key={index}>
                <strong>{part.show}</strong>
                {part.say && <span>{part.say}</span>}
              </li>
            ))}
          </ol>
          <Hint>Cut by the AI from this post’s text; check it. It is a plan for you to make: nothing is kept and the post is not changed.</Hint>
          <div className="row">
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(outlineText(plan.kind, plan.parts)).then(() => setCopied(true))
              }}
              data-testid="draft-outline-copy"
            >
              {copied ? 'Copied' : 'Copy the plan'}
            </Button>
            <Button variant="quiet" onClick={() => setPlan(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
